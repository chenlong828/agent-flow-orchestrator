import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  ValidationError,
  normalizePageQuery,
} from "../../src/core/kernel/index.ts";
import {
  createHealth,
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
