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
      { key: "path", type: "string", description: "目标路径" },
      { key: "depth", type: "int" },
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

  test("请求参数只接受契约字段 key，不接受 paramKey 别名", async () => {
    const response = await call(ctx.app, "POST", "/api/v1/tools", {
      body: {
        ...toolBody("legacy-param"),
        params: [{ paramKey: "path", type: "string", description: "旧字段" }],
      },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
    expect(response.body.error.details.field).toBe("params[0]");
    expect(response.body.error.message).toContain("未知字段 paramKey");
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
    expect(cli.body.items.every((item: any) => item.description === "调用链追踪")).toBe(true);

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
        params: [{ key: "target", type: "string" }],
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
      description: "s",
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

  test("API-08 空库返回默认分页信封，支持 q 检索与分页排序", async () => {
    const empty = await call(ctx.app, "GET", "/api/v1/tools");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ items: [], total: 0, limit: 50, offset: 0 });

    await createTool("alpha");
    await createTool("beta");
    await createTool("gamma");

    const searched = await call(ctx.app, "GET", "/api/v1/tools?q=ALPHA");
    expect(searched.body.total).toBe(1);
    expect(searched.body.items[0].name).toBe("alpha");

    const page = await call(
      ctx.app,
      "GET",
      "/api/v1/tools?limit=1&offset=1&sort=name:asc&unknown=1",
    );
    expect(page.body).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect(page.body.items.map((item: any) => item.name)).toEqual(["beta"]);
  });

  test("API-08 支持状态与所属 Harness 筛选，并返回派生计数", async () => {
    const created = await createTool("counted");
    const expert = await ctx.expertService.create({
      name: "计数专家",
      color: "#2563eb",
      role: "计数",
    });
    await ctx.expertService.setTools(expert.id, 1, [created.id]);

    const byStatus = await call(ctx.app, "GET", "/api/v1/tools?status=unverified");
    expect(byStatus.body.total).toBe(1);
    const byHarness = await call(ctx.app, "GET", `/api/v1/tools?harnessId=${harnessId}`);
    expect(byHarness.body.total).toBe(1);
    expect(byHarness.body.items[0]).toMatchObject({
      name: "counted",
      usedByCount: 1,
      paramCount: 2,
      harnessName: "build-01",
    });
  });

  test("API-09 详情 usedByCount 随专家装配变化", async () => {
    const created = await createTool("detail-tool");
    const expert = await ctx.expertService.create({
      name: "详情专家",
      color: "#16a34a",
      role: "详情",
    });
    await ctx.expertService.setTools(expert.id, 1, [created.id]);

    const bound = await call(ctx.app, "GET", `/api/v1/tools/${created.id}`);
    expect(bound.body.usedByCount).toBe(1);
    expect(bound.body.params).toEqual([
      { key: "path", type: "string", description: "目标路径" },
      { key: "depth", type: "int", description: "" },
    ]);

    await ctx.expertService.setTools(expert.id, 2, []);
    const cleared = await call(ctx.app, "GET", `/api/v1/tools/${created.id}`);
    expect(cleared.body.usedByCount).toBe(0);
  });

  test("API-10 最小创建体默认 description 为空、params 为空", async () => {
    const response = await call(ctx.app, "POST", "/api/v1/tools", {
      body: {
        name: "minimal-tool",
        kind: "script",
        invocation: "echo hi",
        harnessId,
        timeoutMs: 1000,
      },
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      description: "",
      params: [],
      paramCount: 0,
      status: "unverified",
      lastDebugAt: null,
      revision: 1,
    });
  });

  test("API-10 超时边界可接受，非法 Kind/重复参数/越界超时被拒绝", async () => {
    const upper = await call(ctx.app, "POST", "/api/v1/tools", {
      body: { ...toolBody("upper-bound"), timeoutMs: 600000 },
    });
    expect(upper.status).toBe(201);
    expect(upper.body.timeoutMs).toBe(600000);

    const badKind = await call(ctx.app, "POST", "/api/v1/tools", {
      body: { ...toolBody("bad-kind"), kind: "docker" },
    });
    expect(badKind.status).toBe(400);
    expect(badKind.body.error.details.field).toBe("kind");

    const duplicateParam = await call(ctx.app, "POST", "/api/v1/tools", {
      body: {
        ...toolBody("duplicate-param"),
        params: [
          { key: "p", type: "string" },
          { key: "p", type: "int" },
        ],
      },
    });
    expect(duplicateParam.status).toBe(400);
    expect(duplicateParam.body.error.details.field).toBe("params");

    const badType = await call(ctx.app, "POST", "/api/v1/tools", {
      body: {
        ...toolBody("bad-param-type"),
        params: [{ key: "p", type: "float" }],
      },
    });
    expect(badType.status).toBe(400);
    expect(badType.body.error.details.field).toBe("params.type");
  });

  test("API-11 更新可改名称、Kind、Harness 与超时，并按新归属检索", async () => {
    const created = await createTool("before-update");
    const otherHarness = await ctx.harnessService.create({
      name: "build-02",
      kind: "server",
      address: "10.0.4.12:7801",
      accessMode: "ssh",
      concurrencyMax: 5,
      queuePolicy: "priority",
    });

    const updated = await call(ctx.app, "PUT", `/api/v1/tools/${created.id}`, {
      body: {
        ...toolBody("after-update"),
        kind: "mcp",
        harnessId: otherHarness.id,
        timeoutMs: 60000,
        params: [],
      },
      headers: withRevision(1),
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: "after-update",
      kind: "mcp",
      harnessId: otherHarness.id,
      harnessName: "build-02",
      timeoutMs: 60000,
      paramCount: 0,
      revision: 2,
    });

    const oldHarness = await call(ctx.app, "GET", `/api/v1/tools?harnessId=${harnessId}`);
    expect(oldHarness.body.total).toBe(0);
    const newHarness = await call(ctx.app, "GET", `/api/v1/tools?harnessId=${otherHarness.id}`);
    expect(newHarness.body.total).toBe(1);
    expect(newHarness.body.items[0].name).toBe("after-update");

    const detail = await call(ctx.app, "GET", `/api/v1/tools/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      name: "after-update",
      kind: "mcp",
      harnessName: "build-02",
      timeoutMs: 60000,
      revision: 2,
      usedByCount: 0,
    });
  });

  test("API-12 删除旧 revision 409；删除后参数级联清理", async () => {
    const created = await createTool("stale-delete");
    const stale = await call(ctx.app, "DELETE", `/api/v1/tools/${created.id}`, {
      headers: withRevision(2),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentRevision).toBe(1);

    const deleted = await call(ctx.app, "DELETE", `/api/v1/tools/${created.id}`, {
      headers: withRevision(1),
    });
    expect(deleted.status).toBe(204);
    const rows = await ctx.db.query("select 1 from tool_param where tool_id = $1", [created.id]);
    expect(rows.length).toBe(0);
  });

  test("API-13 引用页返回多个专家；资产不存在 404", async () => {
    const created = await createTool("multi-ref");
    for (const name of ["专家乙", "专家甲"]) {
      const expert = await ctx.expertService.create({
        name,
        color: "#7c3aed",
        role: "引用",
      });
      await ctx.expertService.setTools(expert.id, 1, [created.id]);
    }

    const references = await call(ctx.app, "GET", `/api/v1/tools/${created.id}/references`);
    expect(references.status).toBe(200);
    expect(references.body.total).toBe(2);
    expect(references.body.items.every((item: any) => item.type === "expert")).toBe(true);
    expect(references.body.items.map((item: any) => item.name).sort()).toEqual([
      "专家乙",
      "专家甲",
    ]);

    const missing = await call(
      ctx.app,
      "GET",
      "/api/v1/tools/0191f2f0-0000-7000-8000-000000000000/references",
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
  });
});
