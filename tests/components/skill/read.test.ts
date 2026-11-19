import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeTestDb, getTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { createFileStore } from "../../../src/core/platform/index.ts";
import type { FileStore } from "../../../src/core/kernel/index.ts";
import { PackageUnavailableError } from "../../../src/core/kernel/index.ts";
import { createSkillRead } from "../../../src/components/skill/read.ts";
import { createSkillSlugReader } from "../../../src/components/skill/slug-reader.ts";
import { parseSkillMarkdown, readSkillPackage } from "../../../src/components/skill/package.ts";
import { seedAll } from "../../../scripts/seed.ts";

let db: Awaited<ReturnType<typeof getTestDb>>;
let store: FileStore;
const directories: string[] = [];

beforeAll(async () => {
  db = await getTestDb();
});

beforeEach(async () => {
  await resetBusinessData();
  const directory = await mkdtemp(join(tmpdir(), "agentflow-skill-read-"));
  directories.push(directory);
  store = createFileStore(join(directory, "skills"));
  await seedAll(db, store);
});

afterAll(async () => {
  await closeTestDb();
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Skill 读路径", () => {
  test("列表返回 brief、标签与分页，不读取 zip", async () => {
    const reader = createSkillRead(db, store);
    const packages = await store.list("packages/");
    for (const file of packages) await store.delete(file.key);

    const page = await reader.list({ page: { limit: 5, offset: 0 } });
    expect(page.total).toBe(15);
    expect(page.items).toHaveLength(5);
    expect(page.items[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      categoryCode: expect.any(String),
      tags: expect.any(Array),
      revision: 1,
    });

    const filtered = await reader.list({
      q: "架构",
      categoryCode: "process",
      tag: "契约",
      enabled: true,
      page: { limit: 50, offset: 0 },
    });
    expect(filtered.items.map((item) => item.name)).toEqual(["架构设计规格"]);
  });

  test("详情从包读取正文与文件清单，SKILL.md 首项且只读", async () => {
    const reader = createSkillRead(db, store);
    const row = await db.one<{ id: string; package_key: string }>(
      "select id, package_key from skill where name = '架构设计规格'",
    );
    expect(row).not.toBeNull();

    const detail = await reader.get(row!.id);
    expect(detail.body).toContain("## 三、工作流");
    expect(detail.body).not.toContain("name:");
    expect(detail.files[0]).toMatchObject({ path: "SKILL.md", readOnly: true });
    expect(detail.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "references/arch-design-workflow.md",
    ]);

    const document = await reader.getDocument(row!.id);
    expect(parseSkillMarkdown(document.markdown).name).toBe("arch-design-spec");
    expect(document.revision).toBe(detail.revision);
    expect(document.markdown.endsWith("\n")).toBe(true);

    const pkg = await reader.getPackage(row!.id);
    expect(pkg.fileName).toBe("arch-design-spec-v1.4.zip");
    expect(readSkillPackage(pkg.data)[0]!.path).toBe("SKILL.md");
  });

  test("包缺失时详情与下载报 package_unavailable，summary/list 仍可用", async () => {
    const reader = createSkillRead(db, store);
    const row = await db.one<{ id: string; package_key: string }>(
      "select id, package_key from skill where name = '架构设计规格'",
    );
    await store.delete(`packages/${row!.package_key}`);

    expect((await reader.getSummary(row!.id)).name).toBe("架构设计规格");
    expect((await reader.list({ page: { limit: 50, offset: 0 } })).total).toBe(15);
    for (const operation of [
      () => reader.get(row!.id),
      () => reader.getDocument(row!.id),
      () => reader.getPackage(row!.id),
    ]) {
      const error = await operation().catch((caught) => caught);
      expect(error).toBeInstanceOf(PackageUnavailableError);
      expect(error.details).toEqual({ skillId: row!.id });
    }
  });

  test("未知 Skill 返回 not_found，分类按 position 返回", async () => {
    const reader = createSkillRead(db, store);
    const missing = await reader.get("0191f2f0-aaaa-7000-8000-000000000000").catch(
      (caught) => caught,
    );
    expect(missing.code).toBe("not_found");
    expect(await reader.listCategories()).toEqual([
      { code: "coding", label: "编码", position: 0 },
      { code: "retrieval", label: "检索", position: 1 },
      { code: "review", label: "审视", position: 2 },
      { code: "testing", label: "测试", position: 3 },
      { code: "process", label: "流程", position: 4 },
      { code: "docs", label: "文档", position: 5 },
    ]);
  });

  test("系统标识读取：按 id 返回 slug，未知 id 与空输入不产生条目", async () => {
    const reader = createSkillSlugReader({ db });
    const row = await db.one<{ id: string; slug: string }>(
      "select id, slug from skill where name = '架构设计规格'",
    );
    expect(row).not.toBeNull();
    expect(await reader.slugsFor([])).toEqual({});
    expect(await reader.slugsFor([row!.id])).toEqual({ [row!.id]: "arch-design-spec" });
    expect(
      await reader.slugsFor([row!.id, "0191f2f0-bbbb-7000-8000-000000000000"]),
    ).toEqual({ [row!.id]: "arch-design-spec" });
  });
});
