import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  NameConflictError,
  NotFoundError,
  RevisionConflictError,
  ValidationError,
  normalizePageQuery,
} from "../../../src/core/kernel/index.ts";
import {
  SkillNotFoundError,
  ToolNotFoundError,
} from "../../../src/components/expert/index.ts";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;
let harnessId: string;
let skillIds: string[];
let toolIds: string[];

function expertBody(name = "方案设计专家") {
  return {
    name,
    color: "#7c3aed",
    role: "在遗留方案基础上给出变更方案",
    persona: ["全局观", "谨慎"],
    duty: "输出技术方案与任务拆分",
    skillOrder: "先检索现状，再设计",
    verifyOrder: "完整性对照",
    notes: "优先复用公共能力",
    refs: [{ label: "架构设计红线的 Brief", refType: "经验" }],
  };
}

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await resetBusinessData();
  const harness = await ctx.harnessService.create({
    name: "build-01",
    kind: "container",
    address: "10.0.4.11:7801",
    accessMode: "container_registry",
    concurrencyMax: 20,
    queuePolicy: "fifo",
  });
  harnessId = harness.id;
  const skill1 = await ctx.skillService.create({
    name: "CRES 技能",
    categoryCode: "coding",
    summary: "s",
    sections: { overview: "o", steps: "s", examples: "e", scripts: "sc", verification: "v" },
  });
  const skill2 = await ctx.skillService.create({
    name: "调用链分析",
    categoryCode: "retrieval",
    summary: "s",
    sections: { overview: "o", steps: "s", examples: "e", scripts: "sc", verification: "v" },
  });
  skillIds = [skill1.id, skill2.id];
  const tool1 = await ctx.toolService.create({
    name: "trace",
    kind: "cli",
    invocation: "trace {p}",
    harnessId,
    timeoutMs: 30000,
  });
  const tool2 = await ctx.toolService.create({
    name: "dsl-search",
    kind: "mcp",
    invocation: "dsl.search",
    harnessId,
    timeoutMs: 60000,
  });
  toolIds = [tool1.id, tool2.id];
});

afterAll(async () => {
  await closeTestDb();
});

describe("专家写入规则", () => {
  test("创建后 revision=1，五区与人设/引用按序回读，装配为空", async () => {
    const created = await ctx.expertService.create(expertBody());
    expect(created.revision).toBe(1);
    const detail = await ctx.catalog.getExpert(created.id);
    expect(detail).toMatchObject({
      name: "方案设计专家",
      color: "#7c3aed",
      enabled: true,
      persona: ["全局观", "谨慎"],
      duty: "输出技术方案与任务拆分",
      skillOrder: "先检索现状，再设计",
      verifyOrder: "完整性对照",
      notes: "优先复用公共能力",
      skillCount: 0,
      toolCount: 0,
      refCount: 0,
    });
    expect(detail.skills).toEqual([]);
    expect(detail.tools).toEqual([]);
    expect(detail.refs).toEqual([{ label: "架构设计红线的 Brief", refType: "经验", path: null }]);
  });

  test("名称唯一、颜色格式、角色非空被校验", async () => {
    await ctx.expertService.create(expertBody());
    const duplicate = await ctx.expertService
      .create(expertBody("方案设计专家"))
      .catch((e) => e);
    expect(duplicate.code).toBe("name_conflict");

    const badColor = await ctx.expertService
      .create({ ...expertBody("e1"), color: "red" })
      .catch((e) => e);
    expect(badColor).toBeInstanceOf(ValidationError);
    expect(badColor.details.field).toBe("color");

    const emptyRole = await ctx.expertService
      .create({ ...expertBody("e2"), role: "  " })
      .catch((e) => e);
    expect(emptyRole).toBeInstanceOf(ValidationError);
    expect(emptyRole.details.field).toBe("role");

    const badRefPath = await ctx.expertService
      .create({
        ...expertBody("e3"),
        refs: [{ label: "参考", refType: "经验", path: 1 as never }],
      })
      .catch((e) => e);
    expect(badRefPath).toBeInstanceOf(ValidationError);
    expect(badRefPath.details.field).toBe("refs.0.path");

    const badRefs = await ctx.expertService
      .create({ ...expertBody("e4"), refs: "not-array" as never })
      .catch((e) => e);
    expect(badRefs).toBeInstanceOf(ValidationError);
    expect(badRefs.details.field).toBe("refs");
  });

  test("更新拒绝改名冲突，原名称与 revision 不变", async () => {
    const first = await ctx.expertService.create(expertBody("expert-a"));
    await ctx.expertService.create({ ...expertBody("expert-b"), color: "#dc2626" });
    const conflict = await ctx.expertService
      .update(first.id, 1, { ...expertBody("expert-b"), color: "#dc2626" })
      .catch((e) => e);
    expect(conflict).toBeInstanceOf(NameConflictError);
    expect(conflict.code).toBe("name_conflict");

    const after = await ctx.catalog.getExpert(first.id);
    expect(after.name).toBe("expert-a");
    expect(after.revision).toBe(1);
  });

  test("启停拒绝非布尔值，未知资源 404，旧 revision 409", async () => {
    const badValue = await ctx.expertService
      .setEnabled("0191f2f0-0000-7000-8000-000000000000", 1, "false" as never)
      .catch((e) => e);
    expect(badValue).toBeInstanceOf(ValidationError);
    expect(badValue.details.field).toBe("enabled");

    const missing = await ctx.expertService
      .setEnabled("0191f2f0-0000-7000-8000-000000000000", 1, false)
      .catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);

    const created = await ctx.expertService.create(expertBody("toggle-expert"));
    await ctx.expertService.setEnabled(created.id, 1, false);
    const stale = await ctx.expertService.setEnabled(created.id, 1, true).catch((e) => e);
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect(stale.details.currentRevision).toBe(2);
  });

  test("删除未知资源 404，旧 revision 409", async () => {
    const missing = await ctx.expertService
      .delete("0191f2f0-0000-7000-8000-000000000000", 1)
      .catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);

    const created = await ctx.expertService.create(expertBody("delete-stale"));
    const stale = await ctx.expertService.delete(created.id, 2).catch((e) => e);
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect(stale.details.currentRevision).toBe(1);
  });

  test("更新整体替换人设与引用并递增 revision，旧 revision 冲突", async () => {
    const created = await ctx.expertService.create(expertBody());
    const updated = await ctx.expertService.update(created.id, 1, {
      ...expertBody("方案设计专家 v2"),
      persona: ["独立"],
      refs: [],
    });
    expect(updated.revision).toBe(2);
    const detail = await ctx.catalog.getExpert(created.id);
    expect(detail.name).toBe("方案设计专家 v2");
    expect(detail.persona).toEqual(["独立"]);
    expect(detail.refs).toEqual([]);

    const stale = await ctx.expertService.update(created.id, 1, expertBody()).catch((e) => e);
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect(stale.details.currentRevision).toBe(2);
  });

  test("装配整体替换并保持顺序，重复目标被拒绝", async () => {
    const created = await ctx.expertService.create(expertBody());
    const first = await ctx.expertService.setSkills(created.id, 1, skillIds);
    expect(first.revision).toBe(2);
    const second = await ctx.expertService.setTools(created.id, 2, [...toolIds].reverse());
    expect(second.revision).toBe(3);

    const detail = await ctx.catalog.getExpert(created.id);
    expect(detail.skills.map((skill) => skill.id)).toEqual(skillIds);
    expect(detail.tools.map((tool) => tool.id)).toEqual([...toolIds].reverse());
    expect(detail.skillCount).toBe(2);
    expect(detail.toolCount).toBe(2);

    const duplicate = await ctx.expertService
      .setSkills(created.id, 3, [skillIds[0]!, skillIds[0]!])
      .catch((e) => e);
    expect(duplicate).toBeInstanceOf(ValidationError);
    expect(duplicate.details.field).toBe("items");

    const duplicateTool = await ctx.expertService
      .setTools(created.id, 3, [toolIds[0]!, toolIds[0]!])
      .catch((e) => e);
    expect(duplicateTool).toBeInstanceOf(ValidationError);
    expect(duplicateTool.details.field).toBe("items");
    expect((await ctx.catalog.getExpert(created.id)).revision).toBe(3);
  });

  test("目标不存在整批回滚，不留下半套装配且 revision 不变", async () => {
    const created = await ctx.expertService.create(expertBody());
    const missing = "0191f2f0-0000-7000-8000-000000000000";
    const error = await ctx.expertService
      .setSkills(created.id, 1, [skillIds[0]!, missing])
      .catch((e) => e);
    expect(error).toBeInstanceOf(SkillNotFoundError);
    expect(error.details.field).toBe("items");

    const after = await ctx.catalog.getExpert(created.id);
    expect(after.skillCount).toBe(0);
    expect(after.revision).toBe(1);

    const toolError = await ctx.expertService
      .setTools(created.id, 1, [missing])
      .catch((e) => e);
    expect(toolError).toBeInstanceOf(ToolNotFoundError);
    const afterToolError = await ctx.catalog.getExpert(created.id);
    expect(afterToolError.toolCount).toBe(0);
    expect(afterToolError.revision).toBe(1);
  });

  test("删除专家级联装配关系，删除后不可读", async () => {
    const created = await ctx.expertService.create(expertBody());
    await ctx.expertService.setSkills(created.id, 1, [skillIds[0]!]);
    await ctx.expertService.setTools(created.id, 2, [toolIds[0]!]);
    await ctx.expertService.delete(created.id, 3);

    const rows = await ctx.db.query("select 1 from expert_skill where expert_id = $1", [created.id]);
    expect(rows.length).toBe(0);
    const missing = await ctx.catalog.getExpert(created.id).catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);
  });
});

describe("专家读契约", () => {
  test("列表返回计数与人设，可按启停筛选", async () => {
    const created = await ctx.expertService.create(expertBody());
    await ctx.expertService.setSkills(created.id, 1, [skillIds[0]!]);
    await ctx.expertService.create({
      ...expertBody("评审专家"),
      color: "#dc2626",
      persona: ["独立"],
    });
    await ctx.expertService.setEnabled(created.id, 2, false);

    const disabled = await ctx.catalog.listExperts({
      enabled: false,
      page: normalizePageQuery(),
    });
    expect(disabled.total).toBe(1);
    expect(disabled.items[0]).toMatchObject({
      name: "方案设计专家",
      skillCount: 1,
      toolCount: 0,
      persona: ["全局观", "谨慎"],
    });

    const all = await ctx.catalog.listExperts({ page: normalizePageQuery(), sort: "name" });
    expect(all.total).toBe(2);
    expect(all.items.map((item) => item.name)).toEqual(["方案设计专家", "评审专家"]);
  });

  test("列表支持名称检索、分页与排序", async () => {
    await ctx.expertService.create({ ...expertBody("expert-a"), color: "#111111" });
    await ctx.expertService.create({ ...expertBody("expert-b"), color: "#222222" });
    await ctx.expertService.create({ ...expertBody("expert-c"), color: "#333333" });

    const searched = await ctx.expertRead.list({ q: "EXPERT-A", page: normalizePageQuery() });
    expect(searched.total).toBe(1);
    expect(searched.items[0]?.name).toBe("expert-a");

    const page = await ctx.expertRead.list({
      page: normalizePageQuery(1, 1),
      sort: "name",
    });
    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.name)).toEqual(["expert-b"]);
  });

  test("引用查询返回使用该 Skill/工具的专家", async () => {
    const created = await ctx.expertService.create(expertBody());
    await ctx.expertService.setSkills(created.id, 1, [skillIds[0]!]);
    await ctx.expertService.setTools(created.id, 2, [toolIds[0]!]);

    const bySkill = await ctx.expertRead.listExpertsUsingSkill(skillIds[0]!);
    expect(bySkill).toEqual([{ id: created.id, name: "方案设计专家" }]);
    const byTool = await ctx.expertRead.listExpertsUsingTool(toolIds[0]!);
    expect(byTool).toEqual([{ id: created.id, name: "方案设计专家" }]);
  });
});
