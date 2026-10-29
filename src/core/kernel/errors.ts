/**
 * 共享错误分类。领域组件只抛这里定义的错误；HTTP 网关负责映射状态码。
 */
export type ErrorCode =
  | "validation_error"
  | "not_found"
  | "name_conflict"
  | "revision_conflict"
  | "referenced"
  | "file_conflict"
  | "draft_expired"
  | "payload_too_large"
  | "unsupported_media_type"
  | "skill_md_too_large"
  | "precondition_required"
  | "package_unavailable"
  | "database_unavailable";

export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: ErrorDetails;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: ErrorDetails; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

export class ValidationError extends AppError {
  constructor(field: string, reason: string) {
    super("validation_error", `字段 ${field} 不合法：${reason}`, {
      details: { field, reason },
    });
  }
}

/** 携带多个图校验错误的校验错误；details.issues 为新结构，fieldErrors 保留兼容。 */
export class MultiFieldValidationError extends AppError {
  constructor(issues: { code: string; path: string; message: string }[]) {
    super("validation_error", "请求字段不合法", {
      details: {
        issues,
        fieldErrors: issues.map((issue) => ({
          field: issue.path,
          reason: `${issue.code}: ${issue.message}`,
        })),
      },
    });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super("not_found", `${resource}不存在`, {
      details: { resource, id },
    });
  }
}

export class NameConflictError extends AppError {
  constructor(name: string) {
    super("name_conflict", `名称 ${name} 已存在`, {
      details: { field: "name", value: name },
    });
  }
}

export class RevisionConflictError extends AppError {
  constructor(currentRevision: number) {
    super("revision_conflict", "数据已被其他操作修改，请刷新后重试", {
      details: { currentRevision },
    });
  }
}

export class ReferencedError extends AppError {
  constructor(
    asset: { type: string; id: string; name: string },
    references: { type: string; id: string; name: string }[],
  ) {
    super("referenced", "资产仍被引用，不能删除", {
      details: { asset, references },
    });
  }
}

export class FileConflictError extends AppError {
  constructor(path: string, newPath: string) {
    super("file_conflict", `目标文件 ${newPath} 已存在`, {
      details: { path, newPath },
    });
  }
}

export class DraftExpiredError extends AppError {
  constructor(expiresAt: string) {
    super("draft_expired", "草稿已过期", {
      details: { expiresAt },
    });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(
    limit: "file_bytes" | "file_count" | "package_bytes" | "draft_bytes",
    limitValue: number,
    actualValue: number,
  ) {
    super("payload_too_large", "请求内容超过限制", {
      details: { limit, limitValue, actualValue },
    });
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor() {
    super("unsupported_media_type", "请求内容类型必须是 multipart/form-data");
  }
}

export class SkillMdTooLargeError extends AppError {
  constructor(limitBytes: number, actualBytes: number) {
    super("skill_md_too_large", `SKILL.md 超过 ${limitBytes} 字节`, {
      details: { limitBytes, actualBytes },
    });
  }
}

export class PackageUnavailableError extends AppError {
  constructor(skillId: string, cause?: unknown) {
    super("package_unavailable", `Skill ${skillId} 的包不可用`, {
      details: { skillId },
      cause,
    });
  }
}

export class PreconditionRequiredError extends AppError {
  constructor() {
    super("precondition_required", "缺少 If-Match 请求头");
  }
}

export class DatabaseUnavailableError extends AppError {
  constructor(message = "数据库不可用", cause?: unknown) {
    super("database_unavailable", message, { retryable: true, cause });
  }
}
