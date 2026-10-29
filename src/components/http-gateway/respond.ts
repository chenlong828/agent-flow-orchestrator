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

function statusFor(error: AppError): number {
  switch (error.code) {
    case "validation_error":
      return 400;
    case "not_found":
      return 404;
    case "name_conflict":
    case "revision_conflict":
    case "referenced":
    case "file_conflict":
      return 409;
    case "draft_expired":
      return 410;
    case "payload_too_large":
      return 413;
    case "unsupported_media_type":
      return 415;
    case "skill_md_too_large":
      return 422;
    case "precondition_required":
      return 428;
    case "package_unavailable":
      return 500;
    case "database_unavailable":
      return 503;
  }
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
