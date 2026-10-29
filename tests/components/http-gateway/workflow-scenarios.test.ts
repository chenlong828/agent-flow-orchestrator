import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

function graphFor(expertId: string) {
  return {
    stages: [{ id: "s1", name: "设计", layout: { x: 10, y: 20 } }],
    nodes: [
      { id: "n1", type: "start", name: "开始", stageId: "s1", expertId, layout: { x: 10, y: 20 } },
      { id: "n2", type: "confirm", name: "确认", stageId: "s1", expertId: null },
      { id: "n3", type: "end", name: "结束", stageId: "s1", expertId },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
    ],
  };
}

async function makeExpert(name = "场景专家") {
  return ctx.expertService.create({ name, color: "#123456", role: "执行" });
}

async function createWorkflow(name: string, type = "研发") {
  const created = await call(ctx.app, "POST", "/api/v1/workflows", {
    body: { name, type, description: `${name} 说明` },
  });
  expect(created.status).toBe(201);
  return created.body as { id: string; revision: number };
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

describe("SCN-0101 工作流组合管理", () => {
  test("TC-WFP-001 列表筛选与详情返回当前定义和节点/阶段计数", async () => {
    const expert = await makeExpert();
    const created = await createWorkflow("需求流程");
    await call(ctx.app, "PUT", `/api/v1/workflows/${created.id}/definition`, {
      body: { graph: graphFor(expert.id) },
      headers: withRevision(1),
    });

    const list = await call(ctx.app, "GET", "/api/v1/workflows?q=需求&type=研发");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({
      id: created.id,
      name: "需求流程",
      nodeCount: 3,
      stageCount: 1,
    });

    const detail = await call(ctx.app, "GET", `/api/v1/workflows/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.graph.nodes).toHaveLength(3);
    expect(detail.body.graph.stages).toHaveLength(1);
    expect(detail.body.graph.edges).toHaveLength(2);
    expect(detail.body.publishedAt).toBeUndefined();
    expect(detail.body.version).toBeUndefined();
  });

  test("TC-WFP-002 复制只复制图，节点/阶段/边 ID 保留且源不变", async () => {
    const expert = await makeExpert();
    const source = await createWorkflow("Alpha");
    await call(ctx.app, "PUT", `/api/v1/workflows/${source.id}/definition`, {
      body: { graph: graphFor(expert.id) },
      headers: withRevision(1),
    });

    const copied = await call(ctx.app, "POST", `/api/v1/workflows/${source.id}/copy`, {
      body: {},
    });
    expect(copied.status).toBe(201);
    expect(copied.body.name).toBe("Alpha 副本");
    expect(copied.body.revision).toBe(1);

    const sourceDetail = await call(ctx.app, "GET", `/api/v1/workflows/${source.id}`);
    const copiedDetail = await call(ctx.app, "GET", `/api/v1/workflows/${copied.body.id}`);
    expect(copiedDetail.body.graph).toEqual(sourceDetail.body.graph);
    expect(copiedDetail.body.graph.nodes.map((node: { id: string }) => node.id)).toEqual([
      "n1",
      "n2",
      "n3",
    ]);
    expect(sourceDetail.body.revision).toBe(2);
  });

  test("TC-WFP-003 更新元数据与删除按 revision 生效", async () => {
    const created = await createWorkflow("待整理");
    const updated = await call(ctx.app, "PUT", `/api/v1/workflows/${created.id}`, {
      body: { name: "已整理", type: "平台", description: "新说明" },
      headers: withRevision(1),
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: "已整理", type: "平台", revision: 2 });

    const deleted = await call(ctx.app, "DELETE", `/api/v1/workflows/${created.id}`, {
      headers: withRevision(2),
    });
    expect(deleted.status).toBe(204);
    const gone = await call(ctx.app, "GET", `/api/v1/workflows/${created.id}`);
    expect(gone.status).toBe(404);
  });

  test("TC-WFP-004 重名创建与缺失 If-Match 被拒绝", async () => {
    const first = await createWorkflow("Unique");
    const conflict = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "unique", type: "研发" },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("name_conflict");

    const missing = await call(ctx.app, "PUT", `/api/v1/workflows/${first.id}`, {
      body: { name: "改名", type: "研发", description: "" },
    });
    expect(missing.status).toBe(428);
    expect(missing.body.error.code).toBe("precondition_required");
  });
});

describe("SCN-0102 工作流编辑与校验", () => {
  test("TC-WFE-001 保存有效图递增 revision 并回读阶段/节点/边/布局/视口", async () => {
    const expert = await makeExpert();
    const created = await createWorkflow("编辑流程");
    const graph = { ...graphFor(expert.id), viewport: { x: 120, y: 80, zoom: 0.75 } };
    const saved = await call(ctx.app, "PUT", `/api/v1/workflows/${created.id}/definition`, {
      body: { graph },
      headers: withRevision(1),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.warnings).toEqual([]);
    expect(saved.body.workflow.revision).toBe(2);

    const detail = await call(ctx.app, "GET", `/api/v1/workflows/${created.id}`);
    expect(detail.body.graph).toEqual(graph);
    expect(detail.body.graph.stages[0].layout).toEqual({ x: 10, y: 20 });
    expect(detail.body.graph.nodes[0].layout).toEqual({ x: 10, y: 20 });
    expect(detail.body.graph.viewport).toEqual({ x: 120, y: 80, zoom: 0.75 });
  });

  test("TC-WFE-002 形状错误（含非法视口）返回 400 且不保存", async () => {
    const created = await createWorkflow("形状错误");
    const bad = await call(ctx.app, "PUT", `/api/v1/workflows/${created.id}/definition`, {
      body: {
        graph: {
          stages: [],
          nodes: [{ id: "n1", type: "start", name: "开始", stageId: null, expertId: null }],
          edges: [{ id: "e1", from: "n1", to: "missing", kind: "seq" }],
        },
      },
      headers: withRevision(1),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("validation_error");
    expect(bad.body.error.details.fieldErrors.length).toBeGreaterThan(0);

    const badViewport = await call(ctx.app, "PUT", `/api/v1/workflows/${created.id}/definition`, {
      body: {
        graph: {
          stages: [],
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 0 },
        },
      },
      headers: withRevision(1),
    });
    expect(badViewport.status).toBe(400);
    expect(badViewport.body.error.code).toBe("validation_error");

    const detail = await call(ctx.app, "GET", `/api/v1/workflows/${created.id}`);
    expect(detail.body.revision).toBe(1);
    expect(detail.body.graph).toEqual({ stages: [], nodes: [], edges: [] });
  });

  test("TC-WFE-003 语义问题保存成功并返回 warning，validate 统一 200", async () => {
    const expert = await makeExpert();
    const created = await createWorkflow("语义问题");
    const graph = graphFor(expert.id);
    graph.nodes.splice(2, 1);
    graph.edges.splice(1, 1);

    const saved = await call(ctx.app, "PUT", `/api/v1/workflows/${created.id}/definition`, {
      body: { graph },
      headers: withRevision(1),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.warnings.map((item: { code: string }) => item.code)).toContain("missing_end");

    const report = await call(ctx.app, "POST", `/api/v1/workflows/${created.id}/validate`, {
      body: { graph },
    });
    expect(report.status).toBe(200);
    expect(report.body.errors).toEqual([]);
    expect(report.body.warnings.map((item: { code: string }) => item.code)).toContain("missing_end");
  });

  test("TC-WFE-004 保存缺失专家返回 400 且整事务回滚", async () => {
    const created = await createWorkflow("缺失专家");
    const missingExpert = "0192f0c4-7a1e-7d3b-9c2a-1f5e6d7c8b9a";
    const saved = await call(ctx.app, "PUT", `/api/v1/workflows/${created.id}/definition`, {
      body: { graph: graphFor(missingExpert) },
      headers: withRevision(1),
    });
    expect(saved.status).toBe(400);
    expect(saved.body.error.code).toBe("validation_error");

    const badViewport = await call(ctx.app, "PUT", `/api/v1/workflows/${created.id}/definition`, {
      body: {
        graph: {
          stages: [],
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 0 },
        },
      },
      headers: withRevision(1),
    });
    expect(badViewport.status).toBe(400);
    expect(badViewport.body.error.code).toBe("validation_error");

    const detail = await call(ctx.app, "GET", `/api/v1/workflows/${created.id}`);
    expect(detail.body.revision).toBe(1);
    expect(detail.body.graph).toEqual({ stages: [], nodes: [], edges: [] });
  });
});

describe("SCN-0103 工作流定义交换", () => {
  test("TC-WFX-001 导出 JSON 含 DSL 结构且不含内部字段", async () => {
    const expert = await makeExpert();
    const created = await createWorkflow("导出流程");
    await call(ctx.app, "PUT", `/api/v1/workflows/${created.id}/definition`, {
      body: { graph: graphFor(expert.id) },
      headers: withRevision(1),
    });

    const exported = await call(ctx.app, "GET", `/api/v1/workflows/${created.id}/dsl?format=json`);
    expect(exported.status).toBe(200);
    expect(exported.body.dslVersion).toBe(1);
    expect(exported.body.metadata).toEqual({
      name: "导出流程",
      type: "研发",
      description: "导出流程 说明",
    });
    expect(exported.body.stages).toHaveLength(1);
    expect(exported.body.nodes).toHaveLength(3);
    expect(exported.body.edges).toHaveLength(2);
    expect(exported.body.id).toBeUndefined();
    expect(exported.body.revision).toBeUndefined();
    expect(exported.body.createdAt).toBeUndefined();
    expect(exported.body.updatedAt).toBeUndefined();
  });

  test("TC-WFX-002 YAML 与 JSON 结构等价且保持数组顺序", async () => {
    const expert = await makeExpert();
    const created = await createWorkflow("YAML 流程");
    await call(ctx.app, "PUT", `/api/v1/workflows/${created.id}/definition`, {
      body: { graph: graphFor(expert.id) },
      headers: withRevision(1),
    });

    const json = await call(ctx.app, "GET", `/api/v1/workflows/${created.id}/dsl`);
    const yamlResponse = await ctx.app(
      new Request(`http://127.0.0.1:3000/api/v1/workflows/${created.id}/dsl?format=yaml`),
    );
    expect(yamlResponse.status).toBe(200);
    expect(yamlResponse.headers.get("content-type")).toContain("application/yaml");
    const yaml = Bun.YAML.parse(await yamlResponse.text()) as {
      nodes: { id: string }[];
      [key: string]: unknown;
    };
    expect(yaml).toEqual(json.body);
    expect(yaml.nodes.map((node) => node.id)).toEqual(["n1", "n2", "n3"]);
  });

  test("TC-WFX-003 导入总是新建，idMap 恒等，缺失专家清空并给 warning", async () => {
    const expert = await makeExpert();
    const missingExpert = "0192f0c4-7a1e-7d3b-9c2a-1f5e6d7c8b9a";
    const dsl = {
      dslVersion: 1,
      metadata: { name: "外部流程", type: "外部导入", description: "" },
      stages: [{ id: "s1", name: "外部阶段" }],
      nodes: [
        { id: "n1", type: "start", name: "开始", stageId: "s1", expertId: missingExpert },
        { id: "n2", type: "end", name: "结束", stageId: "s1", expertId: expert.id },
      ],
      edges: [{ id: "e1", from: "n1", to: "n2", kind: "seq" }],
    };

    const imported = await call(ctx.app, "POST", "/api/v1/workflows/import", { body: dsl });
    expect(imported.status).toBe(201);
    expect(imported.body.workflow.name).toBe("外部流程");
    expect(imported.body.workflow.revision).toBe(1);
    expect(imported.body.idMap).toEqual({ s1: "s1", n1: "n1", n2: "n2", e1: "e1" });
    expect(imported.body.warnings.map((item: { code: string }) => item.code)).toContain("expert_missing");

    const detail = await call(ctx.app, "GET", `/api/v1/workflows/${imported.body.workflow.id}`);
    expect(detail.body.graph.nodes.find((node: { id: string }) => node.id === "n1").expertId).toBeNull();

    const list = await call(ctx.app, "GET", "/api/v1/workflows?q=外部");
    expect(list.body.total).toBe(1);
  });

  test("TC-WFX-004 导入未知字段与语义错误被拒绝且不落库", async () => {
    const dsl = {
      dslVersion: 1,
      metadata: { name: "非法导入", type: "外部", description: "" },
      stages: [],
      nodes: [],
      edges: [],
    };
    const unknown = await call(ctx.app, "POST", "/api/v1/workflows/import", {
      body: { ...dsl, extra: true },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("validation_error");

    const semantic = await call(ctx.app, "POST", "/api/v1/workflows/import", { body: dsl });
    expect(semantic.status).toBe(400);
    expect(semantic.body.error.code).toBe("validation_error");
    expect(
      semantic.body.error.details.fieldErrors.some((item: { reason: string }) =>
        item.reason.includes("missing_start"),
      ),
    ).toBe(true);

    const list = await call(ctx.app, "GET", "/api/v1/workflows");
    expect(list.body.total).toBe(0);
  });
});
