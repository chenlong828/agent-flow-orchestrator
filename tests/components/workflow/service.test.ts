import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import type { WorkflowDsl, WorkflowGraph } from "../../../src/components/workflow/index.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

function graphFor(expertId: string): WorkflowGraph {
  return {
    stages: [{ id: "s1", name: "设计" }],
    nodes: [
      { id: "n1", type: "start", name: "开始", stageId: "s1", expertId },
      { id: "n2", type: "agent", name: "实现", stageId: "s1", expertId },
      { id: "n3", type: "confirm", name: "确认", stageId: "s1", expertId: null },
      { id: "n4", type: "end", name: "结束", stageId: "s1", expertId },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
      { id: "e3", from: "n3", to: "n4", kind: "seq" },
    ],
  };
}

async function makeExpert(name = "流程专家") {
  return ctx.expertService.create({ name, color: "#336699", role: "执行" });
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

describe("工作流定义写入", () => {
  test("创建空图、详情回读与名称大小写唯一", async () => {
    const created = await ctx.workflowService.create({
      name: "需求到实现",
      type: "研发",
      description: "主流程",
    });
    expect(created.revision).toBe(1);
    const detail = await ctx.workflowRead.get(created.id);
    expect(detail.name).toBe("需求到实现");
    expect(detail.type).toBe("研发");
    expect(detail.nodeCount).toBe(0);
    expect(detail.stageCount).toBe(0);
    expect(detail.graph).toEqual({ stages: [], nodes: [], edges: [] });

    await expect(
      ctx.workflowService.create({ name: "需求到实现", type: "研发" }),
    ).rejects.toMatchObject({ code: "name_conflict" });
  });

  test("保存合法图：refs 重建、revision 递增、详情一致", async () => {
    const expert = await makeExpert();
    const workflow = await ctx.workflowService.create({ name: "保存流程", type: "研发" });
    const saved = await ctx.workflowService.saveDefinition(workflow.id, 1, {
      graph: graphFor(expert.id),
    });
    expect(saved.revision).toBe(2);
    expect(saved.warnings).toEqual([]);
    const detail = await ctx.workflowRead.get(workflow.id);
    expect(detail.nodeCount).toBe(4);
    expect(detail.stageCount).toBe(1);
    expect(detail.graph.nodes.find((node) => node.id === "n4")?.expertId).toBe(expert.id);
    expect(await ctx.workflowRead.countByExperts([expert.id])).toEqual({ [expert.id]: 1 });
  });

  test("视口随定义保存/回读；DSL 往返与复制保留", async () => {
    const expert = await makeExpert();
    const workflow = await ctx.workflowService.create({ name: "视口流程", type: "研发" });
    const viewport = { x: 140, y: 90, zoom: 0.8 };
    await ctx.workflowService.saveDefinition(workflow.id, 1, {
      graph: { ...graphFor(expert.id), viewport },
    });
    const detail = await ctx.workflowRead.get(workflow.id);
    expect(detail.graph.viewport).toEqual(viewport);

    const dsl = await ctx.workflowService.exportDsl(workflow.id);
    expect(dsl.layout).toEqual({ viewport });
    const imported = await ctx.workflowService.importDsl({
      ...dsl,
      metadata: { name: "视口导入", type: "外部", description: "" },
    });
    expect((await ctx.workflowRead.get(imported.id)).graph.viewport).toEqual(viewport);

    const copied = await ctx.workflowService.copy(workflow.id, {});
    expect((await ctx.workflowRead.get(copied.id)).graph.viewport).toEqual(viewport);

    await ctx.workflowService.saveDefinition(workflow.id, 2, { graph: graphFor(expert.id) });
    expect((await ctx.workflowRead.get(workflow.id)).graph.viewport).toBeUndefined();
  });

  test("形状错误阻断保存；语义问题保存为 warning", async () => {
    const expert = await makeExpert();
    const workflow = await ctx.workflowService.create({ name: "校验流程", type: "研发" });
    const invalid = graphFor(expert.id);
    (invalid.edges[0] as { from: string }).from = "missing";
    await expect(
      ctx.workflowService.saveDefinition(workflow.id, 1, { graph: invalid }),
    ).rejects.toMatchObject({ code: "validation_error" });

    const semantic = graphFor(expert.id);
    semantic.nodes.splice(3, 1);
    semantic.edges.splice(2, 1);
    const saved = await ctx.workflowService.saveDefinition(workflow.id, 1, { graph: semantic });
    expect(saved.revision).toBe(2);
    expect(saved.warnings.some((item) => item.code === "missing_end")).toBe(true);
  });

  test("保存缺失专家 400 且整批回滚；停用专家保留绑定并 warning", async () => {
    const expert = await makeExpert();
    const workflow = await ctx.workflowService.create({ name: "专家校验", type: "研发" });
    const graph = graphFor(expert.id);
    await expect(
      ctx.workflowService.saveDefinition(workflow.id, 1, {
        graph: graphFor("0192f0c4-7a1e-7d3b-9c2a-1f5e6d7c8b9a"),
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect((await ctx.workflowRead.get(workflow.id)).nodeCount).toBe(0);

    await ctx.expertService.setEnabled(expert.id, 1, false);
    const saved = await ctx.workflowService.saveDefinition(workflow.id, 1, { graph });
    expect(saved.revision).toBe(2);
    expect(saved.warnings.some((item) => item.code === "expert_disabled")).toBe(true);
  });

  test("旧 revision 冲突；更新与删除按 If-Match 语义", async () => {
    const workflow = await ctx.workflowService.create({ name: "版本流程", type: "研发" });
    await ctx.workflowService.update(workflow.id, 1, {
      name: "版本流程 v2",
      type: "研发",
      description: "更新",
    });
    await expect(
      ctx.workflowService.update(workflow.id, 1, {
        name: "旧版本",
        type: "研发",
        description: "",
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    await ctx.workflowService.delete(workflow.id, 2);
    await expect(ctx.workflowRead.get(workflow.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("复制、导入与读模型", () => {
  test("复制默认名自动后缀，节点 ID 保留且 refs 重建", async () => {
    const expert = await makeExpert();
    const source = await ctx.workflowService.create({ name: "Alpha", type: "研发" });
    await ctx.workflowService.saveDefinition(source.id, 1, { graph: graphFor(expert.id) });
    const first = await ctx.workflowService.copy(source.id, {});
    const second = await ctx.workflowService.copy(source.id, {});
    const firstDetail = await ctx.workflowRead.get(first.id);
    const secondDetail = await ctx.workflowRead.get(second.id);
    expect(firstDetail.name).toBe("Alpha 副本");
    expect(secondDetail.name).toBe("Alpha 副本 (2)");
    expect(firstDetail.graph.nodes.map((node) => node.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(await ctx.workflowRead.countByExperts([expert.id])).toEqual({ [expert.id]: 3 });
  });

  test("DSL 导出/导入：JSON 元数据、缺失专家清空并 warning", async () => {
    const expert = await makeExpert();
    const source = await ctx.workflowService.create({ name: "导出流程", type: "外部" });
    await ctx.workflowService.saveDefinition(source.id, 1, { graph: graphFor(expert.id) });
    const dsl = await ctx.workflowService.exportDsl(source.id);
    expect(dsl.dslVersion).toBe(1);
    expect(dsl.metadata).toEqual({ name: "导出流程", type: "外部", description: "" });
    expect(dsl.nodes).toHaveLength(4);

    const imported = await ctx.workflowService.importDsl({
      ...dsl,
      metadata: { name: "导入流程", type: "外部", description: "导入" },
      nodes: dsl.nodes.map((node) =>
        node.id === "n2" ? { ...node, expertId: "0192f0c4-7a1e-7d3b-9c2a-1f5e6d7c8b9a" } : node,
      ),
    });
    expect(imported.revision).toBe(1);
    expect(imported.warnings.some((item) => item.code === "expert_missing")).toBe(true);
    const detail = await ctx.workflowRead.get(imported.id);
    expect(detail.graph.nodes.find((node) => node.id === "n2")?.expertId).toBeNull();
    expect(imported.idMap.n1).toBe("n1");
  });

  test("导入语义错误 400；同名 409", async () => {
    const dsl: WorkflowDsl = {
      dslVersion: 1,
      metadata: { name: "导入流程", type: "外部", description: "" },
      stages: [],
      nodes: [{ id: "n1", type: "start" as const, name: "开始", stageId: null, expertId: null }],
      edges: [],
    };
    await expect(ctx.workflowService.importDsl(dsl)).rejects.toMatchObject({
      code: "validation_error",
    });
    const expert = await makeExpert();
    const valid: WorkflowDsl = {
      dslVersion: 1,
      metadata: { name: "重复导入", type: "外部", description: "" },
      ...graphFor(expert.id),
    };
    await expect(
      ctx.workflowService.importDsl({
        ...valid,
        metadata: { name: "非法视口", type: "外部", description: "" },
        layout: { viewport: { x: 0, y: 0, zoom: 0 } },
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await ctx.workflowService.importDsl(valid);
    await expect(ctx.workflowService.importDsl(valid)).rejects.toMatchObject({
      code: "name_conflict",
    });
  });

  test("列表按 q/type 过滤；校验返回形状与语义结果", async () => {
    await ctx.workflowService.create({ name: "需求流程", type: "研发" });
    await ctx.workflowService.create({ name: "发布流程", type: "发布" });
    const page = await ctx.workflowRead.list({
      q: "需求",
      type: "研发",
      page: { limit: 50, offset: 0 },
      sort: "-updatedAt",
    });
    expect(page.total).toBe(1);
    expect(page.items[0]?.name).toBe("需求流程");

    const report = await ctx.workflowService.validate({
      stages: [],
      nodes: [],
      edges: [],
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((item) => item.code)).toContain("missing_start");
    expect(report.warnings.map((item) => item.code)).toContain("missing_end");
  });

  test("专家删除受工作流引用保护", async () => {
    const expert = await makeExpert();
    const workflow = await ctx.workflowService.create({ name: "引用流程", type: "研发" });
    await ctx.workflowService.saveDefinition(workflow.id, 1, { graph: graphFor(expert.id) });
    await expect(ctx.expertService.delete(expert.id, 1)).rejects.toMatchObject({
      code: "referenced",
    });
    const refs = await ctx.workflowRead.listByExpert(expert.id);
    expect(refs).toEqual([{ id: workflow.id, name: "引用流程" }]);
  });
});
