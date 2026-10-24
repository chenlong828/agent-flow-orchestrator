import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;
let harnessId: string;

function toolBody(name = "trace_call_chain") {
  return {
    name,
    kind: "cli",
    invocation: "trace --path {path}",
    description: "调用链追踪",
    harnessId,
    timeoutMs: 30000,
    params: [
      { paramKey: "path", type: "string", description: "目标路径" },
      { paramKey: "depth", type: "int" },
    ],
  };
}

async function createTool(name = "trace_call_chain") {
  const response = await call(ctx.app, "POST", "/api/v1/tools", { body: toolBody(name) });
  expect(response.status).toBe(201);
  return response.body as Record<string, any>;
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
});

afterAll(async () => {
  await closeTestDb();
});

describe("工具 HTTP 契约", () => {
  test("POST 201、Location、参数顺序与默认状态", async () => {
    const response = await call(ctx.app, "POST", "/api/v1/tools", { body: toolBody() });
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(`/api/v1/tools/${response.body.id}`);
    expect(response.body).toMatchObject({
      name: "trace_call_chain",
      status: "unverified",
      lastDebugAt: null,
      paramCount: 2,
      usedByCount: 0,
      harnessName: "build-01",
      revision: 1,
    });
    expect(response.body.params).toEqual([
      { key: "path", type: "string", description: "目标路径" },
      { key: "depth", type: "int", description: "" },
    ]);
  });

  test("GET 列表按 kind/status/harnessId 筛选并返回分页信封", async () => {
    await createTool("trace-call-chain");
    await call(ctx.app, "POST", "/api/v1/tools", {
      body: { ...toolBody("smoke"), kind: "mcp" },
    });
    await createTool("seed");

    const cli = await call(ctx.app, "GET", "/api/v1/tools?kind=cli");
    expect(cli.status).toBe(200);
    expect(cli.body.total).toBe(2);
    expect(cli.body.items.every((item: any) => item.harnessName === "build-01")).toBe(true);

    const none = await call(ctx.app, "GET", "/api/v1/tools?status=available");
    expect(none.body.total).toBe(0);
  });

  test("GET 详情 200；不存在 404", async () => {
    const created = await createTool();
    const detail = await call(ctx.app, "GET", `/api/v1/tools/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.description).toBe("调用链追踪");
    expect(detail.body.params.length).toBe(2);
    expect(detail.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const missing = await call(
      ctx.app,
      "GET",
      "/api/v1/tools/0191f2f0-0000-7000-8000-000000000000",
    );
    expect(missing.status).toBe(404);
  });

  test("PUT 200 并整体替换参数；缺 If-Match 428；旧版本 409", async () => {
    const created = await createTool();
    const updated = await call(ctx.app, "PUT", `/api/v1/tools/${created.id}`, {
      body: {
        ...toolBody(),
        invocation: "trace --fast {target}",
        params: [{ paramKey: "target", type: "string" }],
      },
      headers: withRevision(1),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.invocation).toBe("trace --fast {target}");
    expect(updated.body.params).toEqual([
      { key: "target", type: "string", description: "" },
    ]);
    expect(updated.body.revision).toBe(2);

    const missing = await call(ctx.app, "PUT", `/api/v1/tools/${created.id}`, {
      body: toolBody(),
    });
    expect(missing.status).toBe(428);

    const stale = await call(ctx.app, "PUT", `/api/v1/tools/${created.id}`, {
      body: toolBody(),
      headers: withRevision(1),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("revision_conflict");
  });

  test("POST/PUT 拒绝未知字段、非法 harnessId 与不存在的 Harness", async () => {
    const unknown = await call(ctx.app, "POST", "/api/v1/tools", {
      body: { ...toolBody("x1"), status: "available" },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("validation_error");

    const badUuid = await call(ctx.app, "POST", "/api/v1/tools", {
      body: { ...toolBody("x2"), harnessId: "not-a-uuid" },
    });
    expect(badUuid.status).toBe(400);
    expect(badUuid.body.error.details.field).toBe("harnessId");

    const missingHarness = await call(ctx.app, "POST", "/api/v1/tools", {
      body: { ...toolBody("x3"), harnessId: "0191f2f0-0000-7000-8000-000000000000" },
    });
    expect(missingHarness.status).toBe(400);
    expect(missingHarness.body.error.code).toBe("validation_error");
    expect(missingHarness.body.error.details.field).toBe("harnessId");
  });

  test("DELETE 204；重复 404；被专家引用 409 带列表", async () => {
    const created = await createTool();
    const skill = await ctx.skillService.create({
      name: "CRES 技能",
      categoryCode: "coding",
      summary: "s",
      sections: {
        overview: "o",
        steps: "s",
        examples: "e",
        scripts: "sc",
        verification: "v",
      },
    });
    const expert = await ctx.expertService.create({
      name: "方案设计专家",
      color: "#7c3aed",
      role: "设计",
    });
    await ctx.expertService.setTools(expert.id, 1, [created.id]);
    await ctx.expertService.setSkills(expert.id, 2, [skill.id]);

    const blocked = await call(ctx.app, "DELETE", `/api/v1/tools/${created.id}`, {
      headers: withRevision(1),
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("referenced");
    expect(blocked.body.error.details.references).toEqual([
      { type: "expert", id: expert.id, name: "方案设计专家" },
    ]);

    await ctx.expertService.setTools(expert.id, 3, []);
    const deleted = await call(ctx.app, "DELETE", `/api/v1/tools/${created.id}`, {
      headers: withRevision(1),
    });
    expect(deleted.status).toBe(204);

    const again = await call(ctx.app, "DELETE", `/api/v1/tools/${created.id}`, {
      headers: withRevision(1),
    });
    expect(again.status).toBe(404);
  });

  test("GET references 返回空引用；非法查询 400", async () => {
    const created = await createTool();
    const references = await call(ctx.app, "GET", `/api/v1/tools/${created.id}/references`);
    expect(references.status).toBe(200);
    expect(references.body.total).toBe(0);
    expect(references.body.asset).toEqual({
      type: "tool",
      id: created.id,
      name: "trace_call_chain",
    });

    const badTimeout = await call(ctx.app, "POST", "/api/v1/tools", {
      body: { ...toolBody("x4"), timeoutMs: 600001 },
    });
    expect(badTimeout.status).toBe(400);
    expect(badTimeout.body.error.details.field).toBe("timeoutMs");
  });
});
