import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

beforeEach(async () => {
  await resetBusinessData();
  ctx = await createTestContext({ executorAuth: "off" });
});

afterAll(async () => {
  await closeTestDb();
});

const PROTOCOL = { "x-executor-protocol": "3" } as const;
const POLL_BODY = { capacity: { free: 1 }, running: [], finished: [] };

function identity(clientId: string, headers: Record<string, string> = {}): Record<string, string> {
  return { ...PROTOCOL, "x-client-id": clientId, ...headers };
}

describe("TC-EXN-101 开发期身份头（EXECUTOR_AUTH=off）", () => {
  test("X-Client-Id 放行并自动登记节点，poll 返回空批", async () => {
    const polled = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: identity("dev-node-01"),
      body: POLL_BODY,
    });
    expect(polled.status).toBe(200);
    expect(polled.body.tasks).toEqual([]);

    const node = await ctx.harnessRead.getByClientId("dev-node-01");
    expect(node).not.toBeNull();
    expect(node).toMatchObject({
      name: "dev-node-01",
      kind: "container",
      address: "auto",
      accessMode: "agent",
      enabled: true,
      clientId: "dev-node-01",
      concurrencyMax: 4,
      queuePolicy: "fifo",
    });
  });

  test("同一 clientId 重复 poll 只产生一行；上报地址写入首次登记", async () => {
    for (let i = 0; i < 3; i += 1) {
      const polled = await call(ctx.app, "POST", "/api/v1/executor/poll", {
        headers: identity("dev-node-02", { "x-client-address": "10.0.4.13:7801" }),
        body: POLL_BODY,
      });
      expect(polled.status).toBe(200);
    }
    const page = await ctx.harnessRead.list({ page: { limit: 20, offset: 0 } });
    expect(page.total).toBe(1);
    expect(page.items[0]?.address).toBe("10.0.4.13:7801");
  });

  test("既无 Bearer 也无身份头返回 401，且不建行", async () => {
    const polled = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: PROTOCOL,
      body: POLL_BODY,
    });
    expect(polled.status).toBe(401);
    expect(polled.body.error.code).toBe("unauthorized");
    const page = await ctx.harnessRead.list({ page: { limit: 20, offset: 0 } });
    expect(page.total).toBe(0);
  });

  test("未知 Bearer 回退到身份头；能命中的 Bearer 优先", async () => {
    const viaHeader = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: identity("dev-node-03", { authorization: "Bearer stale-token" }),
      body: POLL_BODY,
    });
    expect(viaHeader.status).toBe(200);

    const created = await ctx.harnessService.create({
      name: "bound-node",
      kind: "container",
      address: "10.0.4.20:7801",
      accessMode: "agent",
      concurrencyMax: 4,
      queuePolicy: "fifo",
    });
    await ctx.harnessService.bindClient(created.id, 1, {
      clientId: "bearer-node",
      token: "tok-bearer",
    });
    const viaBearer = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: identity("dev-node-03", { authorization: "Bearer tok-bearer" }),
      body: POLL_BODY,
    });
    expect(viaBearer.status).toBe(200);
    const bound = await ctx.harnessRead.get(created.id);
    expect(bound.clientId).toBe("bearer-node");
  });

  test("身份头形状非法返回 400 validation_error，不建行", async () => {
    const polled = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: identity("has space"),
      body: POLL_BODY,
    });
    expect(polled.status).toBe(400);
    expect(polled.body.error.code).toBe("validation_error");
    expect(polled.body.error.details).toMatchObject({ field: "clientId" });
    const page = await ctx.harnessRead.list({ page: { limit: 20, offset: 0 } });
    expect(page.total).toBe(0);
  });
});

describe("TC-EXN-102 严格鉴权（EXECUTOR_AUTH=on）", () => {
  test("身份头不被接受，返回 401 且不建行", async () => {
    const strict = await createTestContext({ executorAuth: "on" });
    const polled = await call(strict.app, "POST", "/api/v1/executor/poll", {
      headers: identity("dev-node-09"),
      body: POLL_BODY,
    });
    expect(polled.status).toBe(401);
    expect(polled.body.error.code).toBe("unauthorized");
    const page = await strict.harnessRead.list({ page: { limit: 20, offset: 0 } });
    expect(page.total).toBe(0);
  });
});
