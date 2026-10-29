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
  test("创建必须带合法图；列表、详情、更新、删除与 If-Match", async () => {
    await expect(
      call(ctx.app, "POST", "/api/v1/workflows", {
        body: { name: "缺图", type: "研发" },
      }),
    ).resolves.toMatchObject({ status: 400 });
    const empty = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "空图", type: "研发", graph: { stages: [], nodes: [], edges: [] } },
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_start", path: "graph.nodes" }),
        expect.objectContaining({ code: "missing_end", path: "graph.nodes" }),
      ]),
    );

    const expert = await makeExpert();
    const created = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "需求流程", type: "研发", description: "说明", graph: graphFor(expert.id) },
    });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: expect.any(String), revision: 1, warnings: [] });
    expect(created.headers.get("location")).toBe(`/api/v1/workflows/${created.body.id}`);

    const list = await call(ctx.app, "GET", "/api/v1/workflows?q=需求&type=研发");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);

    const detail = await call(ctx.app, "GET", `/api/v1/workflows/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      name: "需求流程",
      type: "研发",
      revision: 1,
      nodeCount: 3,
      stageCount: 1,
      updatedBy: "tester",
    });
    expect(detail.body.graph).toEqual(graphFor(expert.id));

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
    expect(updated.body.updatedBy).toBe("tester");

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

  test("保存定义：形状/拓扑错误 400，校验报告区分 errors 与 warnings", async () => {
    const expert = await makeExpert();
    const created = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "保存流程", type: "研发", graph: graphFor(expert.id) },
    });
    const id = created.body.id as string;

    const bad = await call(ctx.app, "PUT", `/api/v1/workflows/${id}/definition`, {
      body: { graph: { stages: [], nodes: [], edges: [{ id: "e1", from: "x", to: "y", kind: "seq" }] } },
      headers: withRevision(1),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("validation_error");
    expect(Array.isArray(bad.body.error.details.issues)).toBe(true);
    expect(Array.isArray(bad.body.error.details.fieldErrors)).toBe(true);

    const broken = graphFor(expert.id);
    broken.nodes.splice(2, 1);
    broken.edges.splice(1, 1);
    const rejected = await call(ctx.app, "PUT", `/api/v1/workflows/${id}/definition`, {
      body: { graph: broken },
      headers: withRevision(1),
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_end", path: "graph.nodes" }),
      ]),
    );
    const unchanged = await call(ctx.app, "GET", `/api/v1/workflows/${id}`);
    expect(unchanged.body.revision).toBe(1);
    expect(unchanged.body.graph).toEqual(graphFor(expert.id));

    const report = await call(ctx.app, "POST", `/api/v1/workflows/${id}/validate`, {
      body: { graph: graphFor(expert.id) },
    });
    expect(report.status).toBe(200);
    expect(report.body.errors).toEqual([]);
    expect(report.body.warnings).toEqual([]);

    const empty = await call(ctx.app, "POST", `/api/v1/workflows/${id}/validate`, {
      body: { graph: { stages: [], nodes: [], edges: [] } },
    });
    expect(empty.status).toBe(200);
    expect(empty.body.errors.map((item: { code: string }) => item.code)).toEqual(
      expect.arrayContaining(["missing_start", "missing_end"]),
    );
    expect(empty.body.warnings).toEqual([]);

    const missing = await call(
      ctx.app,
      "POST",
      "/api/v1/workflows/0192f0c4-7a1e-7d3b-9c2a-1f5e6d7c8b9a/validate",
      { body: { graph: { stages: [], nodes: [], edges: [] } } },
    );
    expect(missing.status).toBe(404);
  });

  test("layout/viewport 透明：zoom=0 与任意字段保存/回读；DSL 往返与复制保留", async () => {
    const expert = await makeExpert();
    const created = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "视口流程", type: "研发", graph: graphFor(expert.id) },
    });
    const id = created.body.id as string;
    const viewport = { x: 140, y: 90, zoom: 0, extra: { minimap: true } };

    const bad = await call(ctx.app, "PUT", `/api/v1/workflows/${id}/definition`, {
      body: { graph: { ...graphFor(expert.id), viewport: "not-an-object" } },
      headers: withRevision(1),
    });
    expect(bad.status).toBe(400);

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
    const copiedDetail = await call(ctx.app, "GET", `/api/v1/workflows/${copied.body.id}`);
    expect(copiedDetail.body.graph.viewport).toEqual(viewport);
  });

  test("复制自动后缀；DSL JSON 与 YAML 导出；导入缺失专家清空", async () => {
    const expert = await makeExpert();
    const created = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "Alpha", type: "研发", graph: graphFor(expert.id) },
    });
    const id = created.body.id as string;

    const first = await call(ctx.app, "POST", `/api/v1/workflows/${id}/copy`, {
      body: {},
    });
    expect(first.status).toBe(201);
    const firstDetail = await call(ctx.app, "GET", `/api/v1/workflows/${first.body.id}`);
    expect(firstDetail.body.name).toBe("Alpha 副本");
    const second = await call(ctx.app, "POST", `/api/v1/workflows/${id}/copy`, {
      body: {},
    });
    const secondDetail = await call(ctx.app, "GET", `/api/v1/workflows/${second.body.id}`);
    expect(secondDetail.body.name).toBe("Alpha 副本 (2)");

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
    expect(yaml).toContain("dslVersion: 1");
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

  test("列表排序使用冒号语法，旧的 -updatedAt 返回 400", async () => {
    const ok = await call(ctx.app, "GET", "/api/v1/workflows?sort=updatedAt:desc");
    expect(ok.status).toBe(200);
    const bad = await call(ctx.app, "GET", "/api/v1/workflows?sort=-updatedAt");
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.field).toBe("sort");
  });

  test("专家删除被工作流引用时返回 409", async () => {
    const expert = await makeExpert();
    const created = await call(ctx.app, "POST", "/api/v1/workflows", {
      body: { name: "引用流程", type: "研发", graph: graphFor(expert.id) },
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
