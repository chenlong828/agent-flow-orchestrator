import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  ValidationError,
  normalizePageQuery,
} from "../../src/core/kernel/index.ts";
import {
  createHealth,
  loadConfig,
  type Db,
} from "../../src/core/platform/index.ts";

describe("分页规范化", () => {
  test("缺省 limit=50、offset=0，允许 1 与 200 边界", () => {
    expect(normalizePageQuery()).toEqual({ limit: DEFAULT_PAGE_LIMIT, offset: 0 });
    expect(normalizePageQuery(1, 5)).toEqual({ limit: 1, offset: 5 });
    expect(normalizePageQuery(MAX_PAGE_LIMIT, 0)).toEqual({ limit: 200, offset: 0 });
  });

  test("0、201、-1、非整数返回 validation_error", () => {
    for (const value of [0, 201, -1]) {
      const error = (() => {
        try {
          normalizePageQuery(value);
          return null;
        } catch (caught) {
          return caught;
        }
      })();
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details?.field).toBe("limit");
    }
  });
});

describe("进程配置", () => {
  test("默认值", () => {
    expect(loadConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
      databaseUrl: "postgres://postgres@127.0.0.1:54329/agentflow",
      actor: "local",
      logLevel: "info",
    });
  });

  test("环境覆盖与非法 PORT / LOG_LEVEL", () => {
    expect(
      loadConfig({
        HOST: "0.0.0.0",
        PORT: "3100",
        DATABASE_URL: "postgres://u@db:5432/x",
        DEV_ACTOR: "alice",
        LOG_LEVEL: "debug",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 3100,
      databaseUrl: "postgres://u@db:5432/x",
      actor: "alice",
      logLevel: "debug",
    });
    expect(() => loadConfig({ PORT: "70000" })).toThrow("PORT 不合法");
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow("LOG_LEVEL 不合法");
  });
});

describe("健康检查", () => {
  test("查询成功返回 ok/up，查询失败返回 degraded/down", async () => {
    const up = createHealth({
      one: async () => ({ ping: 1 }),
      query: async () => [],
      transaction: async () => {
        throw new Error("unused");
      },
      close: async () => {},
    } as unknown as Db);
    expect(await up.check()).toEqual({ status: "ok", database: "up" });

    const down = createHealth({
      one: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      query: async () => [],
      transaction: async () => {
        throw new Error("unused");
      },
      close: async () => {},
    } as unknown as Db);
    expect(await down.check()).toEqual({ status: "degraded", database: "down" });
  });
});
