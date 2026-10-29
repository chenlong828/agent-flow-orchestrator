import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

function graphFor(expertId: string) {
  return {
    stages: [{ id: "s1", name: "设计" }],
    nodes: [
      { id: "n1", type: "start", name: "开始", stageId: "s1", expertId },
      { id: "n2", type: "confirm", name: "确认", stageId: "s1", expertId: null },
      { id: "n3", type: "end", name: "结束", stageId: "s1", expertId },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
    ],
  };
}

async function makeExpert(name = "HTTP 专家") {
  return ctx.expertService.create({ name, color: "#123456", role: "执行" });
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

describe("工作流 HTTP 契约", () => {
  test("创建、列表、详情、更新、删除与 If-Match", async () => {
    const created = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "需求流程", type: "研发", description: "说明" },
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe(`/api/v1/workflows/${created.body.id}`);
    expect(created.body).toMatchObject({
      name: "需求流程",
      type: "研发",
      revision: 1,
      nodeCount: 0,
      stageCount: 0,
    });

    const list = await call(ctx.app, "GET", "/api/v1/workflows?q=需求&type=研发");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);

    const detail = await call(ctx.app, "GET", `/api/v1/workflows/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.graph).toEqual({ stages: [], nodes: [], edges: [] });

    const missingPrecondition = await call(ctx.app, "PUT", `/api/v1/workflows/${created.body.id}`, {
      body: { name: "改名", type: "研发", description: "" },
    });
    expect(missingPrecondition.status).toBe(428);

    const updated = await call(ctx.app, "PUT", `/api/v1/workflows/${created.body.id}`, {
      body: { name: "改名", type: "研发", description: "新说明" },
      headers: withRevision(1),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.revision).toBe(2);

    const old = await call(ctx.app, "PUT", `/api/v1/workflows/${created.body.id}`, {
      body: { name: "旧", type: "研发", description: "" },
      headers: withRevision(1),
    });
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe("revision_conflict");

    const deleted = await call(ctx.app, "DELETE", `/api/v1/workflows/${created.body.id}`, {
      headers: withRevision(2),
    });
    expect(deleted.status).toBe(204);
    const gone = await call(ctx.app, "GET", `/api/v1/workflows/${created.body.id}`);
    expect(gone.status).toBe(404);
  });

  test("保存定义、形状错误、语义 warning 与校验报告", async () => {
    const expert = await makeExpert();
    const created = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "保存流程", type: "研发" },
    });
    const id = created.body.id as string;

    const bad = await call(ctx.app, "PUT", `/api/v1/workflows/${id}/definition`, {
      body: { graph: { stages: [], nodes: [], edges: [{ id: "e1", from: "x", to: "y", kind: "seq" }] } },
      headers: withRevision(1),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("validation_error");
    expect(Array.isArray(bad.body.error.details.fieldErrors)).toBe(true);

    const semanticGraph = graphFor(expert.id);
    semanticGraph.nodes.splice(2, 1);
    semanticGraph.edges.splice(1, 1);
    const saved = await call(ctx.app, "PUT", `/api/v1/workflows/${id}/definition`, {
      body: { graph: semanticGraph },
      headers: withRevision(1),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.workflow.revision).toBe(2);
    expect(saved.body.warnings.map((item: { code: string }) => item.code)).toContain("missing_end");

    const report = await call(ctx.app, "POST", `/api/v1/workflows/${id}/validate`, {
      body: { graph: graphFor(expert.id) },
    });
    expect(report.status).toBe(200);
    expect(report.body.errors).toEqual([]);
    expect(report.body.warnings).toEqual([]);

    const missing = await call(
      ctx.app,
      "POST",
      "/api/v1/workflows/0192f0c4-7a1e-7d3b-9c2a-1f5e6d7c8b9a/validate",
      { body: { graph: { stages: [], nodes: [], edges: [] } } },
    );
    expect(missing.status).toBe(404);
  });

  test("视口随定义保存/回读；非法视口 400；DSL 往返与复制保留", async () => {
    const expert = await makeExpert();
    const created = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "视口流程", type: "研发" },
    });
    const id = created.body.id as string;
    const viewport = { x: 140, y: 90, zoom: 0.8 };

    const invalid = await call(ctx.app, "PUT", `/api/v1/workflows/${id}/definition`, {
      body: { graph: { ...graphFor(expert.id), viewport: { ...viewport, zoom: 0 } } },
      headers: withRevision(1),
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("validation_error");

    const saved = await call(ctx.app, "PUT", `/api/v1/workflows/${id}/definition`, {
      body: { graph: { ...graphFor(expert.id), viewport } },
      headers: withRevision(1),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.workflow.graph.viewport).toEqual(viewport);
    expect(saved.body.workflow.revision).toBe(2);

    const detail = await call(ctx.app, "GET", `/api/v1/workflows/${id}`);
    expect(detail.body.graph.viewport).toEqual(viewport);

    const dsl = await call(ctx.app, "GET", `/api/v1/workflows/${id}/dsl`);
    expect(dsl.body.layout).toEqual({ viewport });

    const imported = await call(ctx.app, "POST", "/api/v1/workflows/import", {
      body: {
        ...dsl.body,
        metadata: { name: "视口导入", type: "外部", description: "" },
      },
    });
    expect(imported.status).toBe(201);
    expect(imported.body.workflow.graph.viewport).toEqual(viewport);

    const copied = await call(ctx.app, "POST", `/api/v1/workflows/${id}/copy`, { body: {} });
    expect(copied.status).toBe(201);
    expect(copied.body.graph.viewport).toEqual(viewport);
  });

  test("复制自动后缀；DSL JSON 与 YAML 导出；导入缺失专家清空", async () => {
    const expert = await makeExpert();
    const created = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "Alpha", type: "研发" },
    });
    const id = created.body.id as string;
    await call(ctx.app, "PUT", `/api/v1/workflows/${id}/definition`, {
      body: { graph: graphFor(expert.id) },
      headers: withRevision(1),
    });

    const first = await call(ctx.app, "POST", `/api/v1/workflows/${id}/copy`, {
      body: {},
    });
    expect(first.status).toBe(201);
    expect(first.body.name).toBe("Alpha 副本");
    const second = await call(ctx.app, "POST", `/api/v1/workflows/${id}/copy`, {
      body: {},
    });
    expect(second.body.name).toBe("Alpha 副本 (2)");

    const dsl = await call(ctx.app, "GET", `/api/v1/workflows/${id}/dsl`);
    expect(dsl.status).toBe(200);
    expect(dsl.body.dslVersion).toBe(1);
    expect(dsl.body.metadata.name).toBe("Alpha");

    const yamlResponse = await ctx.app(
      new Request(`http://127.0.0.1:3000/api/v1/workflows/${id}/dsl?format=yaml`),
    );
    expect(yamlResponse.status).toBe(200);
    expect(yamlResponse.headers.get("content-type")).toContain("application/yaml");
    const yaml = await yamlResponse.text();
    expect(yaml).toContain('dslVersion: 1');
    expect(yaml).toContain('name: "Alpha"');
    const parsed = Bun.YAML.parse(yaml) as { dslVersion: number; metadata: { name: string } };
    expect(parsed.dslVersion).toBe(1);
    expect(parsed.metadata.name).toBe("Alpha");

    const imported = await call(ctx.app, "POST", "/api/v1/workflows/import", {
      body: {
        ...dsl.body,
        metadata: { name: "导入流程", type: "外部", description: "" },
        nodes: (dsl.body.nodes as { id: string }[]).map((node) =>
          node.id === "n1"
            ? { ...node, expertId: "0192f0c4-7a1e-7d3b-9c2a-1f5e6d7c8b9a" }
            : node,
        ),
      },
    });
    expect(imported.status).toBe(201);
    expect(imported.body.warnings.some((item: { code: string }) => item.code === "expert_missing")).toBe(true);
    const importedDetail = await call(ctx.app, "GET", `/api/v1/workflows/${imported.body.workflow.id}`);
    expect(
      importedDetail.body.graph.nodes.find((node: { id: string }) => node.id === "n1").expertId,
    ).toBeNull();
  });

  test("专家删除被工作流引用时返回 409", async () => {
    const expert = await makeExpert();
    const created = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "引用流程", type: "研发" },
    });
    await call(ctx.app, "PUT", `/api/v1/workflows/${created.body.id}/definition`, {
      body: { graph: graphFor(expert.id) },
      headers: withRevision(1),
    });
    const detail = await call(ctx.app, "GET", `/api/v1/experts/${expert.id}`);
    expect(detail.body.refCount).toBe(1);
    const deleted = await call(ctx.app, "DELETE", `/api/v1/experts/${expert.id}`, {
      headers: withRevision(1),
    });
    expect(deleted.status).toBe(409);
    expect(deleted.body.error.code).toBe("referenced");
    expect(deleted.body.error.details.references[0].type).toBe("workflow");
  });
});
