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

let expertSequence = 0;

async function makeExpert(name = "流程专家") {
  return ctx.expertService.create({ name, color: "#336699", role: "执行" });
}

async function createWithGraph(
  name: string,
  type: string,
  description = "",
  expertId?: string,
  graph?: WorkflowGraph,
) {
  const owner = expertId ?? (await makeExpert(`流程专家${++expertSequence}`)).id;
  const created = await ctx.workflowService.create({
    name,
    type,
    description,
    graph: graph ?? graphFor(owner),
  });
  return { ...created, expertId: owner, graph: graph ?? graphFor(owner) };
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
  test("创建必须带合法图；详情回读、updatedBy 与名称大小写唯一", async () => {
    const expert = await makeExpert();
    await expect(
      ctx.workflowService.create({
        name: "空图",
        type: "研发",
        graph: { stages: [], nodes: [], edges: [] },
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      ctx.workflowService.create({ name: "缺图", type: "研发" } as never),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect((await ctx.workflowRead.list({ page: { limit: 50, offset: 0 } })).total).toBe(0);

    const created = await ctx.workflowService.create({
      name: "需求到实现",
      type: "研发",
      description: "主流程",
      graph: graphFor(expert.id),
    });
    expect(created.revision).toBe(1);
    expect(created.warnings).toEqual([]);
    const detail = await ctx.workflowRead.get(created.id);
    expect(detail.name).toBe("需求到实现");
    expect(detail.type).toBe("研发");
    expect(detail.nodeCount).toBe(4);
    expect(detail.stageCount).toBe(1);
    expect(detail.updatedBy).toBe("tester");

    await expect(
      ctx.workflowService.create({
        name: "需求到实现",
        type: "研发",
        graph: graphFor(expert.id),
      }),
    ).rejects.toMatchObject({ code: "name_conflict" });
  });

  test("保存合法图：refs 重建、revision 递增、详情一致", async () => {
    const { id, expertId } = await createWithGraph("保存流程", "研发");
    const saved = await ctx.workflowService.saveDefinition(id, 1, {
      graph: graphFor(expertId),
    });
    expect(saved.revision).toBe(2);
    expect(saved.warnings).toEqual([]);
    const detail = await ctx.workflowRead.get(id);
    expect(detail.nodeCount).toBe(4);
    expect(detail.stageCount).toBe(1);
    expect(detail.graph.nodes.find((node) => node.id === "n4")?.expertId).toBe(expertId);
    expect(await ctx.workflowRead.countByExperts([expertId])).toEqual({ [expertId]: 1 });
  });

  test("layout/viewport 透明：zoom=0 与任意字段保存/回读/DSL 往返/复制都保留", async () => {
    const { id, expertId } = await createWithGraph("视口流程", "研发");
    const viewport = { x: 140, y: 90, zoom: 0, extra: { minimap: true } };
    const graph = {
      ...graphFor(expertId),
      stages: [{ ...graphFor(expertId).stages[0]!, layout: { x: 1, y: 2, folded: true } }],
      nodes: [
        { ...graphFor(expertId).nodes[0]!, layout: { x: 3, y: 4, width: 300, pinned: true } },
        ...graphFor(expertId).nodes.slice(1),
      ],
      viewport,
    };
    await ctx.workflowService.saveDefinition(id, 1, { graph });
    const detail = await ctx.workflowRead.get(id);
    expect(detail.graph.viewport).toEqual(viewport);
    expect(detail.graph.stages[0]?.layout).toEqual({ x: 1, y: 2, folded: true });
    expect(detail.graph.nodes[0]?.layout).toEqual({ x: 3, y: 4, width: 300, pinned: true });

    const dsl = await ctx.workflowService.exportDsl(id);
    expect(dsl.layout).toEqual({ viewport });
    const imported = await ctx.workflowService.importDsl({
      ...dsl,
      metadata: { name: "视口导入", type: "外部", description: "" },
    });
    expect((await ctx.workflowRead.get(imported.id)).graph.viewport).toEqual(viewport);

    const copied = await ctx.workflowService.copy(id, {});
    expect((await ctx.workflowRead.get(copied.id)).graph.viewport).toEqual(viewport);

    await ctx.workflowService.saveDefinition(id, 2, { graph: graphFor(expertId) });
    expect((await ctx.workflowRead.get(id)).graph.viewport).toBeUndefined();
  });

  test("形状与拓扑问题阻断保存，不落库", async () => {
    const { id, expertId } = await createWithGraph("校验流程", "研发");
    const invalid = graphFor(expertId);
    (invalid.edges[0] as { from: string }).from = "missing";
    await expect(
      ctx.workflowService.saveDefinition(id, 1, { graph: invalid }),
    ).rejects.toMatchObject({ code: "validation_error" });

    const broken = graphFor(expertId);
    broken.nodes.splice(3, 1);
    broken.edges.splice(2, 1);
    await expect(
      ctx.workflowService.saveDefinition(id, 1, { graph: broken }),
    ).rejects.toMatchObject({
      code: "validation_error",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "missing_end", path: "graph.nodes" }),
        ]),
        fieldErrors: expect.any(Array),
      },
    });
    expect((await ctx.workflowRead.get(id)).nodeCount).toBe(4);
    expect((await ctx.workflowRead.get(id)).revision).toBe(1);
  });

  test("保存缺失专家 400 且整批回滚；停用专家保留绑定并 warning", async () => {
    const { id, expertId } = await createWithGraph("专家校验", "研发");
    await expect(
      ctx.workflowService.saveDefinition(id, 1, {
        graph: graphFor("0192f0c4-7a1e-7d3b-9c2a-1f5e6d7c8b9a"),
      }),
    ).rejects.toMatchObject({
      code: "validation_error",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "expert_missing", path: "graph.nodes[0].expertId" }),
        ]),
      },
    });
    expect((await ctx.workflowRead.get(id)).nodeCount).toBe(4);

    await ctx.expertService.setEnabled(expertId, 1, false);
    const saved = await ctx.workflowService.saveDefinition(id, 1, { graph: graphFor(expertId) });
    expect(saved.revision).toBe(2);
    expect(saved.warnings.some((item) => item.code === "expert_disabled")).toBe(true);
    expect(saved.warnings[0]?.path).toBe("graph.nodes[0].expertId");
  });

  test("创建遇到停用专家返回 warning；旧 revision 冲突；更新与删除按 If-Match 语义", async () => {
    const expert = await makeExpert();
    await ctx.expertService.setEnabled(expert.id, 1, false);
    const created = await ctx.workflowService.create({
      name: "停用专家流程",
      type: "研发",
      graph: graphFor(expert.id),
    });
    expect(created.warnings.some((item) => item.code === "expert_disabled")).toBe(true);

    await ctx.expertService.setEnabled(expert.id, 2, true);
    await ctx.workflowService.update(created.id, 1, {
      name: "版本流程 v2",
      type: "研发",
      description: "更新",
    });
    await expect(
      ctx.workflowService.update(created.id, 1, {
        name: "旧版本",
        type: "研发",
        description: "",
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    await ctx.workflowService.delete(created.id, 2);
    await expect(ctx.workflowRead.get(created.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("复制、导入与读模型", () => {
  test("复制默认名自动后缀，节点 ID 保留且 refs 重建", async () => {
    const { id, expertId } = await createWithGraph("Alpha", "研发");
    const first = await ctx.workflowService.copy(id, {});
    const second = await ctx.workflowService.copy(id, {});
    const firstDetail = await ctx.workflowRead.get(first.id);
    const secondDetail = await ctx.workflowRead.get(second.id);
    expect(first.warnings).toEqual([]);
    expect(firstDetail.name).toBe("Alpha 副本");
    expect(secondDetail.name).toBe("Alpha 副本 (2)");
    expect(firstDetail.graph.nodes.map((node) => node.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(await ctx.workflowRead.countByExperts([expertId])).toEqual({ [expertId]: 3 });
  });

  test("DSL 导出/导入：缺失专家清空并 warning，保存前必须重新绑定", async () => {
    const { id, expertId } = await createWithGraph("导出流程", "外部");
    const dsl = await ctx.workflowService.exportDsl(id);
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
    expect(imported.warnings.some((item) => item.path === "graph.nodes[1].expertId")).toBe(true);
    const detail = await ctx.workflowRead.get(imported.id);
    expect(detail.graph.nodes.find((node) => node.id === "n2")?.expertId).toBeNull();
    expect(imported.idMap.n1).toBe("n1");

    await expect(
      ctx.workflowService.saveDefinition(imported.id, 1, { graph: detail.graph }),
    ).rejects.toMatchObject({
      code: "validation_error",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "expert_required", path: "graph.nodes[1].expertId" }),
        ]),
      },
    });
    await expect(
      ctx.workflowService.saveDefinition(imported.id, 1, { graph: graphFor(expertId) }),
    ).resolves.toMatchObject({ revision: 2 });
    const rebound = await ctx.workflowRead.get(imported.id);
    expect(rebound.graph.nodes.find((node) => node.id === "n2")?.expertId).toBe(expertId);
  });

  test("导入拓扑错误 400；透明布局成功；同名 409", async () => {
    const empty: WorkflowDsl = {
      dslVersion: 1,
      metadata: { name: "空图导入", type: "外部", description: "" },
      stages: [],
      nodes: [],
      edges: [],
    };
    await expect(ctx.workflowService.importDsl(empty)).rejects.toMatchObject({
      code: "validation_error",
    });

    const expert = await makeExpert();
    const forbidden = graphFor(expert.id);
    forbidden.nodes[2] = { ...forbidden.nodes[2]!, expertId: expert.id };
    await expect(
      ctx.workflowService.importDsl({
        dslVersion: 1,
        metadata: { name: "禁止绑定", type: "外部", description: "" },
        ...forbidden,
      }),
    ).rejects.toMatchObject({
      code: "validation_error",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "expert_forbidden", path: "graph.nodes[2].expertId" }),
        ]),
      },
    });
    const valid: WorkflowDsl = {
      dslVersion: 1,
      metadata: { name: "透明布局导入", type: "外部", description: "" },
      ...graphFor(expert.id),
      layout: { viewport: { x: 0, y: 0, zoom: 0, extra: true } },
    };
    const imported = await ctx.workflowService.importDsl(valid);
    expect((await ctx.workflowRead.get(imported.id)).graph.viewport).toEqual({
      x: 0,
      y: 0,
      zoom: 0,
      extra: true,
    });

    await expect(ctx.workflowService.importDsl(valid)).rejects.toMatchObject({
      code: "name_conflict",
    });
  });

  test("列表按 q/type 过滤；校验返回拓扑 errors 与停用 warning", async () => {
    const first = await createWithGraph("需求流程", "研发");
    await createWithGraph("发布流程", "发布");
    const page = await ctx.workflowRead.list({
      q: "需求",
      type: "研发",
      page: { limit: 50, offset: 0 },
      sort: "-updatedAt",
    });
    expect(page.total).toBe(1);
    expect(page.items[0]?.name).toBe("需求流程");
    expect(page.items[0]?.updatedBy).toBe("tester");

    const empty = await ctx.workflowService.validate({ stages: [], nodes: [], edges: [] });
    expect(empty.errors.map((item) => item.code)).toContain("missing_start");
    expect(empty.errors.map((item) => item.code)).toContain("missing_end");
    expect(empty.warnings).toEqual([]);

    await ctx.expertService.setEnabled(first.expertId, 1, false);
    const report = await ctx.workflowService.validate(graphFor(first.expertId));
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((item) => item.code)).toContain("expert_disabled");
  });

  test("旧空图可读，但保存/复制/导出都被拒绝", async () => {
    const { id } = await createWithGraph("旧空图", "研发");
    await ctx.db.query(
      `update workflow_definition set graph = $1::text::jsonb where workflow_id = $2`,
      [JSON.stringify({ stages: [], nodes: [], edges: [] }), id],
    );

    expect((await ctx.workflowRead.get(id)).graph).toEqual({ stages: [], nodes: [], edges: [] });
    await expect(
      ctx.workflowService.saveDefinition(id, 1, { graph: { stages: [], nodes: [], edges: [] } }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(ctx.workflowService.copy(id, {})).rejects.toMatchObject({
      code: "validation_error",
    });
    await expect(ctx.workflowService.exportDsl(id)).rejects.toMatchObject({
      code: "validation_error",
    });
  });

  test("专家删除受工作流引用保护", async () => {
    const expert = await makeExpert();
    const workflow = await createWithGraph("引用流程", "研发", "", expert.id);
    await expect(ctx.expertService.delete(expert.id, 1)).rejects.toMatchObject({
      code: "referenced",
    });
    const refs = await ctx.workflowRead.listByExpert(expert.id);
    expect(refs).toEqual([{ id: workflow.id, name: "引用流程" }]);
  });
});
