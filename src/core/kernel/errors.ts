/**
 * 共享错误分类。领域组件只抛这里定义的错误；HTTP 网关负责映射状态码。
 */
export type ErrorCode =
  | "validation_error"
  | "not_found"
  | "name_conflict"
  | "revision_conflict"
  | "referenced"
  | "binding_conflict"
  | "file_conflict"
  | "draft_expired"
  | "payload_too_large"
  | "unsupported_media_type"
  | "skill_md_too_large"
  | "precondition_required"
  | "task_not_found"
  | "package_not_found"
  | "package_unavailable"
  | "unsupported_protocol"
  | "unauthorized"
  | "run_not_found"
  | "run_conflict"
  | "client_unsupported"
  | "input_not_found"
  | "session_log_missing"
  | "invalid_state"
  | "invalid_archive"
  | "unsupported_node_type"
  | "database_unavailable"
  | "client_observability_unavailable"
  | "client_observability_unauthorized"
  | "client_observability_invalid"
  | "client_observability_http"
  | "session_not_linked";

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
  /** `field` 区分撞的是展示名还是系统标识（`skill.slug`）。 */
  constructor(value: string, field: "name" | "slug" = "name") {
    super("name_conflict", `${field === "slug" ? "系统标识" : "名称"} ${value} 已存在`, {
      details: { field, value },
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

/**
 * 节点登记冲突：`clientId` 已被其他 Harness 绑定，或凭据已被其他节点使用。
 * 凭据冲突不回显 token 值，避免凭据进入响应与日志。
 */
export class BindingConflictError extends AppError {
  constructor(field: "clientId" | "clientToken", clientId?: string) {
    const isClientId = field === "clientId";
    super(
      "binding_conflict",
      isClientId
        ? `clientId ${clientId ?? ""} 已被其他 Harness 绑定`
        : "该 token 已被其他 Harness 使用",
      {
        details: isClientId ? { field, clientId } : { field },
      },
    );
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
    limit:
      | "file_bytes"
      | "file_count"
      | "package_bytes"
      | "draft_bytes"
      | "result_bytes"
      | "prompt_bytes"
      | "session_log_bytes"
      | "archive_bytes"
      | "run_input_file_bytes"
      | "run_input_bytes"
      | "run_input_count",
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

/** client 观测面不可达/超时/5xx；调用方可重试。 */
export class ClientObservabilityUnavailableError extends AppError {
  constructor(message = "client 观测面不可用", cause?: unknown) {
    super("client_observability_unavailable", message, { retryable: true, cause });
  }
}

/** client 观测面要求 Bearer，但凭据缺失/错误。 */
export class ClientObservabilityUnauthorizedError extends AppError {
  constructor(message = "client 观测面凭据无效") {
    super("client_observability_unauthorized", message);
  }
}

/** client 观测面响应/URL 非法。 */
export class ClientObservabilityInvalidError extends AppError {
  constructor(message = "client 观测面响应非法", cause?: unknown) {
    super("client_observability_invalid", message, { cause });
  }
}

/** client 观测面其它 4xx；保留原始状态码与错误码供网关映射。 */
export class ClientObservabilityHttpError extends AppError {
  readonly status: number;
  readonly clientCode: string;

  constructor(status: number, clientCode: string, message: string) {
    super("client_observability_http", message, { details: { status, code: clientCode } });
    this.status = status;
    this.clientCode = clientCode;
  }
}

/** 节点已结算但结果未带 sessionId（历史行/重启补结算），无法代理会话观测。 */
export class SessionNotLinkedError extends AppError {
  constructor(runId: string, nodeId: string) {
    super("session_not_linked", `节点尚未关联会话：${runId}/${nodeId}`, {
      details: { runId, nodeId },
    });
  }
}
