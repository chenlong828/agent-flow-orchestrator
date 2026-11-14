import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeTestDb, getTestDb, resetBusinessData } from "../helpers/test-db.ts";
import { createFileStore } from "../../src/core/platform/index.ts";
import type { FileStore } from "../../src/core/kernel/index.ts";
import {
  parseSkillMarkdown,
  readSkillPackage,
} from "../../src/components/skill/package.ts";
import { seedAll } from "../../scripts/seed.ts";

let db: Awaited<ReturnType<typeof getTestDb>>;
let store: FileStore;
const directories: string[] = [];

beforeAll(async () => {
  db = await getTestDb();
});

beforeEach(async () => {
  await resetBusinessData();
  const directory = await mkdtemp(join(tmpdir(), "agentflow-seed-"));
  directories.push(directory);
  store = createFileStore(join(directory, "skills"));
});

afterAll(async () => {
  await closeTestDb();
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("演示种子", () => {
  test("首轮写入 11 个 Skill / 10 个专家 / 2 条流程与 21 条技能装配边，不预置 Harness 与工具", async () => {
    const result = await seedAll(db, store);
    expect(result).toEqual({
      skills: 11,
      experts: 10,
      workflows: 2,
      expertSkills: 21,
    });
    const counts = await db.one<{
      harnesses: number;
      tools: number;
      skills: number;
      experts: number;
      workflows: number;
      toolEdges: number;
      missingPackages: number;
    }>(
      `select
        (select count(*)::int from harness) as harnesses,
        (select count(*)::int from tool) as tools,
        (select count(*)::int from skill) as skills,
        (select count(*)::int from expert) as experts,
        (select count(*)::int from workflow) as workflows,
        (select count(*)::int from expert_tool) as "toolEdges",
        (select count(*)::int from skill where package_key is null or package_key = '') as "missingPackages"`,
    );
    expect(counts).toEqual({
      harnesses: 0,
      tools: 0,
      skills: 11,
      experts: 10,
      workflows: 2,
      toolEdges: 0,
      missingPackages: 0,
    });

    expect(await store.list("packages/")).toHaveLength(11);
    const arch = await db.one<{ package_key: string }>(
      "select package_key from skill where slug = 'arch-design-spec'",
    );
    expect(arch).not.toBeNull();
    const entries = readSkillPackage(
      await new Response(await store.get(`packages/${arch!.package_key}`)).bytes(),
    );
    expect(entries.map((entry) => entry.path)).toEqual([
      "SKILL.md",
      "references/arch-design-workflow.md",
    ]);
    const skillMd = new TextDecoder().decode(entries[0]!.data);
    expect(parseSkillMarkdown(skillMd)).toMatchObject({
      name: "arch-design-spec",
      version: "v1.1",
    });
    expect(new TextEncoder().encode(skillMd).byteLength).toBeLessThanOrEqual(16 * 1024);
  });

  test("重复执行幂等，不产生重复行与重复装配边，版本保持种子值", async () => {
    await seedAll(db, store);
    await seedAll(db, store);
    const counts = await db.one<{
      skills: number;
      experts: number;
      workflows: number;
      skillEdges: number;
    }>(
      `select
        (select count(*)::int from skill) as skills,
        (select count(*)::int from expert) as experts,
        (select count(*)::int from workflow) as workflows,
        (select count(*)::int from expert_skill) as "skillEdges"`,
    );
    expect(counts).toEqual({ skills: 11, experts: 10, workflows: 2, skillEdges: 21 });
    expect(await store.list("packages/")).toHaveLength(11);

    const requirements = await db.one<{ version: string; tags: number }>(
      `select s.version,
        (select count(*)::int from skill_tag t where t.skill_id = s.id) as tags
       from skill s where s.name = '需求到场景'`,
    );
    expect(requirements).toEqual({ version: "v2.0", tags: 3 });
  });

  test("已存在的流程不被种子覆盖，保留界面上的改名与改图", async () => {
    await seedAll(db, store);
    const row = await db.one<{ id: string }>("select id from workflow where name = 'TRUN-DEV-01'");
    await db.query("update workflow set name = '我的研发流程', updated_by = 'ui' where id = $1", [row!.id]);
    await db.query("update workflow_definition set updated_by = 'ui' where workflow_id = $1", [row!.id]);

    await seedAll(db, store);

    const after = await db.one<{
      name: string;
      updatedBy: string;
      definitionUpdatedBy: string;
      refs: number;
    }>(
      `select w.name, w.updated_by as "updatedBy", d.updated_by as "definitionUpdatedBy",
        (select count(*)::int from workflow_expert_ref r where r.workflow_id = w.id) as refs
       from workflow w join workflow_definition d on d.workflow_id = w.id
       where w.id = $1`,
      [row!.id],
    );
    expect(after).toEqual({
      name: "我的研发流程",
      updatedBy: "ui",
      definitionUpdatedBy: "ui",
      refs: 10,
    });
  });

  test("分类覆盖、装配引用完整，且研发流程含 10 个节点与三条回退边", async () => {
    await seedAll(db, store);
    const categories = await db.query<{ category_code: string; count: number }>(
      "select category_code, count(*)::int from skill group by category_code order by category_code",
    );
    expect(categories).toEqual([
      { category_code: "coding", count: 1 },
      { category_code: "docs", count: 1 },
      { category_code: "process", count: 5 },
      { category_code: "review", count: 2 },
      { category_code: "testing", count: 2 },
    ]);

    const danglingSkill = await db.query(
      `select 1 from expert_skill es
       left join skill s on s.id = es.skill_id
       where s.id is null`,
    );
    expect(danglingSkill.length).toBe(0);
    const unboundTools = await db.query("select 1 from expert_tool");
    expect(unboundTools.length).toBe(0);

    const row = await db.one<{
      graph: { nodes: { id: string; expertId: string | null }[]; edges: { kind: string }[] };
    }>(
      `select d.graph from workflow_definition d
       join workflow w on w.id = d.workflow_id
       where w.name = 'TRUN-DEV-01'`,
    );
    expect(row).not.toBeNull();
    expect(row!.graph.nodes).toHaveLength(10);
    expect(row!.graph.nodes.every((node) => node.expertId !== null)).toBe(true);
    expect(row!.graph.edges.filter((edge) => edge.kind === "rollback")).toHaveLength(3);

    const refs = await db.query(
      `select 1 from workflow_expert_ref r
       join workflow w on w.id = r.workflow_id
       where w.name = 'TRUN-DEV-01'`,
    );
    expect(refs).toHaveLength(10);

    const impl = await db.one<{
      graph: {
        nodes: { id: string; type: string; expertId: string | null }[];
        edges: { from: string; to: string; kind: string }[];
      };
    }>(
      `select d.graph from workflow_definition d
       join workflow w on w.id = d.workflow_id
       where w.name = 'TRUN-DEV-02'`,
    );
    expect(impl).not.toBeNull();
    expect(impl!.graph.nodes.map((node) => node.type)).toEqual([
      "start",
      "confirm",
      "agent",
      "review",
      "end",
    ]);
    const gate = impl!.graph.nodes.find((node) => node.type === "confirm");
    expect(gate?.expertId).toBeNull();
    expect(
      impl!.graph.edges.filter((edge) => edge.kind === "rollback").map((edge) => `${edge.from}->${edge.to}`),
    ).toEqual(["n4->n3"]);
  });
});
