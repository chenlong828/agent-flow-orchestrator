import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { NotFoundError, normalizePageQuery } from "../../../src/core/kernel/index.ts";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

const MISSING_ID = "0191f2f0-0000-7000-8000-000000000000";

function sections(content = "") {
  return {
    overview: `${content}概览`,
    steps: `${content}步骤`,
    examples: `${content}示例`,
    scripts: `${content}脚本`,
    verification: `${content}验证`,
  };
}

async function createHarness(name = "catalog-harness") {
  return ctx.harnessService.create({
    name,
    kind: "container",
    address: "10.0.4.11:7801",
    accessMode: "container_registry",
    concurrencyMax: 10,
    queuePolicy: "fifo",
  });
}

async function createTool(harnessId: string, name = "catalog-tool") {
  return ctx.toolService.create({
    name,
    kind: "cli",
    invocation: `${name} {input}`,
    harnessId,
    timeoutMs: 30000,
    params: [{ paramKey: "input", type: "string", description: "输入" }],
  });
}

async function createSkill(name = "catalog-skill", categoryCode = "coding") {
  return ctx.skillService.create({
    name,
    categoryCode,
    summary: `${name} 摘要`,
    tags: ["标签"],
    sections: sections(name),
  });
}

async function createExpert(name = "catalog-expert") {
  return ctx.expertService.create({
    name,
    color: "#2563eb",
    role: "目录专家",
    persona: ["全局观"],
  });
}

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await resetBusinessData();
});

afterAll(async () => {
  await closeTestDb();
});

describe("catalog 只读组合", () => {
  test("Harness 投影组合工具计数，空集合返回数组", async () => {
    const harness = await createHarness();
    const empty = await ctx.catalog.listHarnesses({ page: normalizePageQuery() });
    expect(empty.total).toBe(1);
    expect(empty.items[0]).toMatchObject({ name: "catalog-harness", toolCount: 0, tags: [] });

    await createTool(harness.id, "tool-a");
    await createTool(harness.id, "tool-b");
    const withTools = await ctx.catalog.listHarnesses({ page: normalizePageQuery() });
    expect(withTools.items[0]?.toolCount).toBe(2);

    const detail = await ctx.catalog.getHarness(harness.id);
    expect(detail).toMatchObject({
      name: "catalog-harness",
      toolCount: 2,
      description: "",
      tags: [],
    });
  });

  test("工具投影补 harnessName/paramCount/usedByCount，详情保留参数顺序", async () => {
    const harness = await createHarness();
    const tool = await createTool(harness.id);
    const expert = await createExpert();
    await ctx.expertService.setTools(expert.id, 1, [tool.id]);

    const list = await ctx.catalog.listTools({ page: normalizePageQuery() });
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({
      name: "catalog-tool",
      harnessName: "catalog-harness",
      paramCount: 1,
      usedByCount: 1,
      status: "unverified",
      lastDebugAt: null,
    });
    expect("description" in (list.items[0] as object)).toBe(false);
    expect("params" in (list.items[0] as object)).toBe(false);

    const detail = await ctx.catalog.getTool(tool.id);
    expect(detail.description).toBe("");
    expect(detail.params).toEqual([{ key: "input", type: "string", description: "输入" }]);
    expect(detail.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("Skill 投影补 categoryLabel/usedByCount，详情保留五章与引用", async () => {
    const skill = await createSkill("skill-a", "coding");
    const expert = await createExpert();
    await ctx.expertService.setSkills(expert.id, 1, [skill.id]);

    const list = await ctx.catalog.listSkills({ page: normalizePageQuery() });
    expect(list.items[0]).toMatchObject({
      name: "skill-a",
      categoryCode: "coding",
      categoryLabel: "编码",
      version: "v1.0",
      usedByCount: 1,
    });

    const detail = await ctx.catalog.getSkill(skill.id);
    expect(detail).toMatchObject({
      categoryLabel: "编码",
      usedByCount: 1,
      triggers: [],
      pitfalls: [],
      refs: [],
    });
    expect(detail.sections).toEqual(sections("skill-a"));
  });

  test("专家投影组合 Skill/工具摘要、计数与 refCount=0", async () => {
    const harness = await createHarness();
    const skill = await createSkill("skill-a", "retrieval");
    const tool = await createTool(harness.id);
    const expert = await createExpert("expert-a");
    await ctx.expertService.setSkills(expert.id, 1, [skill.id]);
    await ctx.expertService.setTools(expert.id, 2, [tool.id]);

    const list = await ctx.catalog.listExperts({
      page: normalizePageQuery(),
      sort: "name",
    });
    expect(list.items[0]).toMatchObject({
      name: "expert-a",
      persona: ["全局观"],
      skillCount: 1,
      toolCount: 1,
      refCount: 0,
    });

    const detail = await ctx.catalog.getExpert(expert.id);
    expect(detail.skills).toEqual([
      {
        id: skill.id,
        name: "skill-a",
        categoryCode: "retrieval",
        categoryLabel: "检索",
        summary: "skill-a 摘要",
      },
    ]);
    expect(detail.tools).toEqual([
      { id: tool.id, name: "catalog-tool", kind: "cli", status: "unverified" },
    ]);
    expect(detail.refs).toEqual([]);
    expect(detail.refCount).toBe(0);
  });

  test("引用投影对三类资产返回同源摘要，无引用返回空数组", async () => {
    const harness = await createHarness();
    const tool = await createTool(harness.id);
    const skill = await createSkill();
    const expert = await createExpert();
    await ctx.expertService.setSkills(expert.id, 1, [skill.id]);
    await ctx.expertService.setTools(expert.id, 2, [tool.id]);

    const harnessRefs = await ctx.catalog.referencesForHarness(harness.id);
    expect(harnessRefs).toEqual({
      asset: { type: "harness", id: harness.id, name: "catalog-harness" },
      total: 1,
      items: [{ type: "tool", id: tool.id, name: "catalog-tool" }],
    });

    const toolRefs = await ctx.catalog.referencesForTool(tool.id);
    expect(toolRefs).toEqual({
      asset: { type: "tool", id: tool.id, name: "catalog-tool" },
      total: 1,
      items: [{ type: "expert", id: expert.id, name: "catalog-expert" }],
    });

    const skillRefs = await ctx.catalog.referencesForSkill(skill.id);
    expect(skillRefs).toEqual({
      asset: { type: "skill", id: skill.id, name: "catalog-skill" },
      total: 1,
      items: [{ type: "expert", id: expert.id, name: "catalog-expert" }],
    });

    await expect(ctx.catalog.referencesForTool(MISSING_ID)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ctx.catalog.referencesForHarness(MISSING_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(ctx.catalog.referencesForSkill(MISSING_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const emptyHarness = await createHarness("empty-harness");
    expect(await ctx.catalog.check("harness", emptyHarness.id)).toEqual([]);
    expect(await ctx.catalog.check("tool", tool.id)).toEqual([
      { type: "expert", id: expert.id, name: "catalog-expert" },
    ]);
    expect(await ctx.catalog.check("skill", skill.id)).toEqual([
      { type: "expert", id: expert.id, name: "catalog-expert" },
    ]);
  });

  test("listToolsByHarness 与 listExpertsUsing* 只返回引用摘要", async () => {
    const harness = await createHarness();
    const tool = await createTool(harness.id, "z-tool");
    const expert = await createExpert();
    await ctx.expertService.setTools(expert.id, 1, [tool.id]);

    expect(await ctx.catalog.listToolsByHarness(harness.id)).toEqual([
      { type: "tool", id: tool.id, name: "z-tool" },
    ]);
    expect(await ctx.catalog.listExpertsUsingTool(tool.id)).toEqual([
      { type: "expert", id: expert.id, name: "catalog-expert" },
    ]);

    const skill = await createSkill();
    await ctx.expertService.setSkills(expert.id, 2, [skill.id]);
    expect(await ctx.catalog.listExpertsUsingSkill(skill.id)).toEqual([
      { type: "expert", id: expert.id, name: "catalog-expert" },
    ]);
    expect(await ctx.catalog.listToolsByHarness(MISSING_ID)).toEqual([]);
  });
});
