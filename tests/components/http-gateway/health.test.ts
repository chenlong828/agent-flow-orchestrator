import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DatabaseUnavailableError } from "../../../src/core/kernel/index.ts";
import { createHealth, type Db } from "../../../src/core/platform/index.ts";
import { createHttpApp } from "../../../src/components/http-gateway/index.ts";
import { closeTestDb } from "../../helpers/test-db.ts";
import { call, createTestContext, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

function appWith(health: ReturnType<typeof createHealth>) {
  return createHttpApp({
    catalog: ctx.catalog,
    harnessService: ctx.harnessService,
    toolService: ctx.toolService,
    skillService: ctx.skillService,
    expertService: ctx.expertService,
    health,
    actor: "tester",
  });
}

const downDb = {
  one: async () => {
    throw new Error("connect ECONNREFUSED");
  },
} as unknown as Db;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await closeTestDb();
});

describe("健康检查与 503 映射", () => {
  test("数据库不可用：/healthz 503 degraded/down，业务端点 503 service_unavailable", async () => {
    const app = appWith(createHealth(downDb));
    const health = await call(app, "GET", "/healthz");
    expect(health.status).toBe(503);
    expect(health.body).toEqual({ status: "degraded", database: "down" });

    const brokenCatalog = createHttpApp({
      catalog: {
        ...ctx.catalog,
        listHarnesses: async () => {
          throw new DatabaseUnavailableError("连接池耗尽");
        },
      },
      harnessService: ctx.harnessService,
      toolService: ctx.toolService,
      skillService: ctx.skillService,
      expertService: ctx.expertService,
      health: createHealth(downDb),
      actor: "tester",
    });
    const list = await call(brokenCatalog, "GET", "/api/v1/harnesses");
    expect(list.status).toBe(503);
    expect(list.body.error).toMatchObject({
      code: "service_unavailable",
      message: "连接池耗尽",
    });
  });

  test("未分类异常映射 500 internal，不泄漏内部信息并回显 requestId", async () => {
    const app = createHttpApp({
      catalog: {
        ...ctx.catalog,
        listHarnesses: async () => {
          throw new Error("relation secret_table does not exist");
        },
      },
      harnessService: ctx.harnessService,
      toolService: ctx.toolService,
      skillService: ctx.skillService,
      expertService: ctx.expertService,
      health: createHealth(downDb),
      actor: "tester",
    });
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    let response: Awaited<ReturnType<typeof call>>;
    try {
      response = await call(app, "GET", "/api/v1/harnesses", {
        headers: { "x-request-id": "req-500" },
      });
    } finally {
      console.error = original;
    }
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({
      code: "internal",
      message: "服务器内部错误",
      requestId: "req-500",
    });
    expect(response.headers.get("x-request-id")).toBe("req-500");
    expect(logged.length).toBe(1);
  });

  test("未知路由与错误方法返回 404 not_found", async () => {
    const unknown = await call(ctx.app, "GET", "/api/v1/unknown");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("not_found");

    const wrongMethod = await call(ctx.app, "POST", "/api/v1/skill-categories");
    expect(wrongMethod.status).toBe(404);
  });

  test("/healthz 成功响应稳定，且只接受 GET", async () => {
    for (const _ of [1, 2]) {
      const response = await call(ctx.app, "GET", "/healthz");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok", database: "up" });
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    }

    const wrongMethod = await call(ctx.app, "POST", "/healthz");
    expect(wrongMethod.status).toBe(404);
    expect(wrongMethod.body.error.code).toBe("not_found");
  });
});
