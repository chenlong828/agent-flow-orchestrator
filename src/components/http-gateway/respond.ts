import { AppError } from "../../core/kernel/index.ts";

export type JsonValue = Record<string, unknown> | unknown[];

export function json(
  data: JsonValue | string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function markdown(text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      ...headers,
    },
  });
}

export function notModified(): Response {
  return new Response(null, { status: 304 });
}

function restCode(error: AppError): string {
  return error.code === "database_unavailable" ? "service_unavailable" : error.code;
}

/** 执行面错误码与产品面不同：数据库不可用仍按 `service_unavailable`，其余原样。 */

const STATUS_BY_CODE: Record<AppError["code"], number> = {
  validation_error: 400,
  not_found: 404,
  name_conflict: 409,
  revision_conflict: 409,
  referenced: 409,
  binding_conflict: 409,
  file_conflict: 409,
  draft_expired: 410,
  payload_too_large: 413,
  unsupported_media_type: 415,
  skill_md_too_large: 422,
  precondition_required: 428,
  task_not_found: 404,
  package_not_found: 404,
  package_unavailable: 500,
  unsupported_protocol: 400,
  unauthorized: 401,
  run_not_found: 404,
  run_conflict: 409,
  session_log_missing: 409,
  invalid_state: 409,
  invalid_archive: 400,
  unsupported_node_type: 400,
  database_unavailable: 503,
};

function statusFor(error: AppError): number {
  return STATUS_BY_CODE[error.code];
}

export function errorResponse(error: unknown, requestId?: string): Response {
  if (error instanceof AppError) {
    const payload: Record<string, unknown> = {
      code: restCode(error),
      message: error.message,
    };
    if (error.details !== undefined) payload.details = error.details;
    if (requestId !== undefined) payload.requestId = requestId;
    return json({ error: payload }, statusFor(error));
  }
  console.error(error);
  const payload: Record<string, unknown> = {
    code: "internal",
    message: "服务器内部错误",
  };
  if (requestId !== undefined) payload.requestId = requestId;
  return json({ error: payload }, 500);
}
