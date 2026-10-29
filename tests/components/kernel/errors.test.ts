import { describe, expect, test } from "bun:test";
import {
  AppError,
  DatabaseUnavailableError,
  DraftExpiredError,
  FileConflictError,
  MultiFieldValidationError,
  NameConflictError,
  NotFoundError,
  PackageUnavailableError,
  PayloadTooLargeError,
  PreconditionRequiredError,
  ReferencedError,
  RevisionConflictError,
  SkillMdTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
  normalizePageQuery,
} from "../../../src/core/kernel/index.ts";

describe("kernel 错误分类", () => {
  test("校验错误携带 field/reason，且默认不可重试", () => {
    const error = new ValidationError("name", "不能为空");
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "validation_error",
      details: { field: "name", reason: "不能为空" },
      retryable: false,
    });
    expect(error.message).toBe("字段 name 不合法：不能为空");
  });

  test("多字段校验错误使用 details.fieldErrors 数组", () => {
    const error = new MultiFieldValidationError([
      { field: "name", reason: "不能为空" },
      { field: "color", reason: "格式不合法" },
    ]);
    expect(error.code).toBe("validation_error");
    expect(error.details).toEqual({
      fieldErrors: [
        { field: "name", reason: "不能为空" },
        { field: "color", reason: "格式不合法" },
      ],
    });
  });

  test("未找到、名称冲突与版本冲突的 details 可直接供 HTTP 映射", () => {
    expect(new NotFoundError("Harness", "h-1")).toMatchObject({
      code: "not_found",
      details: { resource: "Harness", id: "h-1" },
    });
    expect(new NameConflictError("build-01")).toMatchObject({
      code: "name_conflict",
      details: { field: "name", value: "build-01" },
    });
    expect(new RevisionConflictError(3)).toMatchObject({
      code: "revision_conflict",
      details: { currentRevision: 3 },
    });
    expect(new PreconditionRequiredError()).toMatchObject({
      code: "precondition_required",
      retryable: false,
    });
  });

  test("删除冲突保留资产与引用列表，数据库不可用标记可重试", () => {
    const error = new ReferencedError(
      { type: "tool", id: "t-1", name: "trace" },
      [{ type: "expert", id: "e-1", name: "方案设计专家" }],
    );
    expect(error).toMatchObject({
      code: "referenced",
      details: {
        asset: { type: "tool", id: "t-1", name: "trace" },
        references: [{ type: "expert", id: "e-1", name: "方案设计专家" }],
      },
    });

    const cause = new Error("ECONNREFUSED");
    const unavailable = new DatabaseUnavailableError("连接池耗尽", cause);
    expect(unavailable).toMatchObject({
      code: "database_unavailable",
      message: "连接池耗尽",
      retryable: true,
    });
    expect(unavailable.cause).toBe(cause);
  });

  test("草稿、文件、限额与包错误保留 HTTP details", () => {
    expect(new FileConflictError("scripts/a.ts", "scripts/b.ts")).toMatchObject({
      code: "file_conflict",
      details: { path: "scripts/a.ts", newPath: "scripts/b.ts" },
      retryable: false,
    });

    expect(new DraftExpiredError("2026-10-30T00:00:00.000Z")).toMatchObject({
      code: "draft_expired",
      details: { expiresAt: "2026-10-30T00:00:00.000Z" },
      retryable: false,
    });

    expect(new PayloadTooLargeError("file_bytes", 20 * 1024 * 1024, 20 * 1024 * 1024 + 1)).toMatchObject({
      code: "payload_too_large",
      details: {
        limit: "file_bytes",
        limitValue: 20 * 1024 * 1024,
        actualValue: 20 * 1024 * 1024 + 1,
      },
      retryable: false,
    });

    expect(new UnsupportedMediaTypeError()).toMatchObject({
      code: "unsupported_media_type",
      retryable: false,
    });

    expect(new SkillMdTooLargeError(16_384, 16_385)).toMatchObject({
      code: "skill_md_too_large",
      details: { limitBytes: 16_384, actualBytes: 16_385 },
      retryable: false,
    });

    const cause = new Error("zip 损坏");
    const packageUnavailable = new PackageUnavailableError("s-1", cause);
    expect(packageUnavailable).toMatchObject({
      code: "package_unavailable",
      details: { skillId: "s-1" },
      retryable: false,
    });
    expect(packageUnavailable.cause).toBe(cause);
  });
});

describe("分页边界", () => {
  test("limit/offset 非整数或越界返回具体字段错误", () => {
    const cases = [
      { limit: 1.5, offset: undefined, field: "limit" },
      { limit: Number.NaN, offset: undefined, field: "limit" },
      { limit: undefined, offset: -1, field: "offset" },
      { limit: undefined, offset: 1.5, field: "offset" },
      { limit: undefined, offset: Number.NaN, field: "offset" },
    ];
    for (const item of cases) {
      const error = (() => {
        try {
          normalizePageQuery(item.limit, item.offset);
          return null;
        } catch (caught) {
          return caught as ValidationError;
        }
      })();
      expect(error).toBeInstanceOf(ValidationError);
      expect(error?.details).toMatchObject({ field: item.field });
    }
  });
});
