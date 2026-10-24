import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

function harnessBody(name = "build-01") {
  return {
    name,
    kind: "container",
    address: "10.0.4.11:7801",
    accessMode: "container_registry",
    description: "CI 构建容器池节点",
    concurrencyMax: 20,
    queuePolicy: "fifo",
    tags: ["CICD", "构建", "测试"],
  };
}

async function createHarness(name = "build-01") {
  const response = await call(ctx.app, "POST", "/api/v1/harnesses", {
    body: harnessBody(name),
  });
  expect(response.status).toBe(201);
  return response.body as Record<string, any>;
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

describe("GET /healthz", () => {
  test("数据库可用时返回 200 与 ok/up", async () => {
    const response = await call(ctx.app, "GET", "/healthz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: "up" });
  });
});

describe("Harness HTTP 契约", () => {
  test("POST 201、Location、默认运行时字段与详情字段", async () => {
    const response = await call(ctx.app, "POST", "/api/v1/harnesses", {
      body: harnessBody(),
      headers: { "x-actor": "alice", "x-request-id": "req-1" },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      `/api/v1/harnesses/${response.body.id}`,
    );
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(response.body).toMatchObject({
      name: "build-01",
      kind: "container",
      enabled: true,
      health: "unknown",
      lastHeartbeatAt: null,
      tags: ["CICD", "构建", "测试"],
      toolCount: 0,
      revision: 1,
    });
    expect(response.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("GET 列表返回分页信封，并支持筛选与排序", async () => {
    await createHarness("build-02");
    await createHarness("build-01");
    await createHarness("agent-07");

    const list = await call(ctx.app, "GET", "/api/v1/harnesses?limit=2&offset=0&sort=name:asc");
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(list.body.items.map((item: any) => item.name)).toEqual(["agent-07", "build-01"]);

    const filtered = await call(ctx.app, "GET", "/api/v1/harnesses?q=BUILD&kind=container");
    expect(filtered.body.total).toBe(2);
    expect(filtered.body.items.every((item: any) => item.toolCount === 0)).toBe(true);
  });

  test("GET 详情 200；不存在返回 404 not_found", async () => {
    const created = await createHarness();
    const detail = await call(ctx.app, "GET", `/api/v1/harnesses/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.description).toBe("CI 构建容器池节点");

    const missing = await call(
      ctx.app,
      "GET",
      "/api/v1/harnesses/0191f2f0-0000-7000-8000-000000000000",
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
  });

  test("PUT 200 并整体替换标签；缺少 If-Match 428；旧版本 409 带 currentRevision", async () => {
    const created = await createHarness();
    const updated = await call(ctx.app, "PUT", `/api/v1/harnesses/${created.id}`, {
      body: { ...harnessBody(), kind: "server", tags: ["调试"] },
      headers: withRevision(1),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.kind).toBe("server");
    expect(updated.body.tags).toEqual(["调试"]);
    expect(updated.body.revision).toBe(2);

    const missingPrecondition = await call(
      ctx.app,
      "PUT",
      `/api/v1/harnesses/${created.id}`,
      { body: harnessBody() },
    );
    expect(missingPrecondition.status).toBe(428);
    expect(missingPrecondition.body.error.code).toBe("precondition_required");

    const stale = await call(ctx.app, "PUT", `/api/v1/harnesses/${created.id}`, {
      body: harnessBody(),
      headers: withRevision(1),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("revision_conflict");
    expect(stale.body.error.details.currentRevision).toBe(2);
  });

  test("PUT 拒绝未知字段、非法枚举与非法 If-Match", async () => {
    const created = await createHarness();
    const unknown = await call(ctx.app, "PUT", `/api/v1/harnesses/${created.id}`, {
      body: { ...harnessBody(), toolCount: 3 },
      headers: withRevision(1),
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("validation_error");

    const badKind = await call(ctx.app, "POST", "/api/v1/harnesses", {
      body: { ...harnessBody("x1"), kind: "vm" },
    });
    expect(badKind.status).toBe(400);
    expect(badKind.body.error.details.field).toBe("kind");

    const badHeader = await call(ctx.app, "PUT", `/api/v1/harnesses/${created.id}`, {
      body: harnessBody(),
      headers: { "if-match": "abc" },
    });
    expect(badHeader.status).toBe(400);
    expect(badHeader.body.error.code).toBe("validation_error");
  });

  test("PATCH enabled 200；旧 revision 409", async () => {
    const created = await createHarness();
    const disabled = await call(
      ctx.app,
      "PATCH",
      `/api/v1/harnesses/${created.id}/enabled`,
      { body: { enabled: false }, headers: withRevision(1) },
    );
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);
    expect(disabled.body.revision).toBe(2);

    const stale = await call(
      ctx.app,
      "PATCH",
      `/api/v1/harnesses/${created.id}/enabled`,
      { body: { enabled: true }, headers: withRevision(1) },
    );
    expect(stale.status).toBe(409);
  });

  test("DELETE 204；重复删除 404；被引用时 409 并返回引用列表", async () => {
    const created = await createHarness();
    const tool = await ctx.toolService.create({
      name: "trace-call-chain",
      kind: "cli",
      invocation: "trace {path}",
      harnessId: created.id,
      timeoutMs: 30000,
    });
    const blocked = await call(ctx.app, "DELETE", `/api/v1/harnesses/${created.id}`, {
      headers: withRevision(1),
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("referenced");
    expect(blocked.body.error.details.references).toEqual([
      { type: "tool", id: tool.id, name: "trace-call-chain" },
    ]);

    await ctx.toolService.delete(tool.id, 1);
    const deleted = await call(ctx.app, "DELETE", `/api/v1/harnesses/${created.id}`, {
      headers: withRevision(1),
    });
    expect(deleted.status).toBe(204);
    expect(deleted.body).toBeNull();

    const again = await call(ctx.app, "DELETE", `/api/v1/harnesses/${created.id}`, {
      headers: withRevision(1),
    });
    expect(again.status).toBe(404);
  });

  test("GET references 返回资产与引用；不存在资产 404", async () => {
    const created = await createHarness();
    const response = await call(
      ctx.app,
      "GET",
      `/api/v1/harnesses/${created.id}/references`,
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      asset: { type: "harness", id: created.id, name: "build-01" },
      total: 0,
      items: [],
    });
  });

  test("非法 limit 与 sort 返回 400", async () => {
    const badLimit = await call(ctx.app, "GET", "/api/v1/harnesses?limit=0");
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error.details.field).toBe("limit");

    const badSort = await call(ctx.app, "GET", "/api/v1/harnesses?sort=createdAt:asc");
    expect(badSort.status).toBe(400);
    expect(badSort.body.error.details.field).toBe("sort");
  });
});
