/**
 * 共享错误分类。领域组件只抛这里定义的错误；HTTP 网关负责映射状态码。
 */
export type ErrorCode =
  | "validation_error"
  | "not_found"
  | "name_conflict"
  | "revision_conflict"
  | "referenced"
  | "precondition_required"
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

/** 携带多个字段错误的校验错误；details.fieldErrors 为数组。 */
export class MultiFieldValidationError extends AppError {
  constructor(errors: { field: string; reason: string }[]) {
    super("validation_error", "请求字段不合法", {
      details: { fieldErrors: errors },
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
