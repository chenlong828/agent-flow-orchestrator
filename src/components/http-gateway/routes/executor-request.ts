import {
  PayloadTooLargeError,
  ValidationError,
  MAX_RESULT_BYTES,
} from "../../../core/kernel/index.ts";
import { assertAllowedFields, isPlainObject } from "../validation.ts";
import type { ExecutorResult, ExecutorReport, ExecutorTaskError } from "./executor-types.ts";

export const POLL_FIELDS = ["capacity", "running", "finished", "archivedRuns"] as const;
export const RESULT_FIELDS = [
  "taskId",
  "attempt",
  "status",
  "sessionId",
  "message",
  "truncated",
  "stopReason",
  "usage",
  "error",
  "signals",
  "startedAt",
  "finishedAt",
] as const;

export async function readJson(
  request: Request,
  fields: readonly string[],
): Promise<Record<string, unknown>> {
  const text = await request.text();
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > MAX_RESULT_BYTES) {
    throw new PayloadTooLargeError("result_bytes", MAX_RESULT_BYTES, byteLength);
  }
  if (text.trim() === "") throw new ValidationError("body", "请求体不能为空");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError("body", "必须是合法 JSON");
  }
  if (!isPlainObject(parsed)) throw new ValidationError("body", "必须是 JSON 对象");
  assertAllowedFields(parsed, fields);
  return parsed;
}

function parseRunning(value: unknown): ExecutorReport["running"] {
  if (!Array.isArray(value)) throw new ValidationError("running", "必须是数组");
  return value.map((item, index) => {
    if (!isPlainObject(item)) throw new ValidationError(`running[${index}]`, "必须是对象");
    assertAllowedFields(item, ["taskId", "instanceId", "startedAt", "lastEventAt"], `running[${index}]`);
    if (typeof item.taskId !== "string") throw new ValidationError(`running[${index}].taskId`, "必须是字符串");
    return {
      taskId: item.taskId,
      instanceId: String(item.instanceId ?? ""),
      startedAt: String(item.startedAt ?? ""),
      lastEventAt: typeof item.lastEventAt === "string" ? item.lastEventAt : undefined,
    };
  });
}

function parseFinished(value: unknown): ExecutorReport["finished"] {
  if (!Array.isArray(value)) throw new ValidationError("finished", "必须是数组");
  return value.map((item, index) => {
    if (!isPlainObject(item)) throw new ValidationError(`finished[${index}]`, "必须是对象");
    assertAllowedFields(item, ["taskId", "attempt", "finishedAt"], `finished[${index}]`);
    if (typeof item.taskId !== "string") throw new ValidationError(`finished[${index}].taskId`, "必须是字符串");
    return {
      taskId: item.taskId,
      attempt: Number(item.attempt ?? 0),
      finishedAt: String(item.finishedAt ?? ""),
    };
  });
}

function parseArchivedRuns(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError("archivedRuns", "必须是数组");
  return value.map((item, index) => {
    if (typeof item !== "string") throw new ValidationError(`archivedRuns[${index}]`, "必须是字符串");
    return item;
  });
}

export function parsePollBody(body: Record<string, unknown>): ExecutorReport {
  const capacity = body.capacity;
  if (!isPlainObject(capacity)) throw new ValidationError("capacity", "必须是对象");
  assertAllowedFields(capacity, ["free"], "capacity");
  if (typeof capacity.free !== "number" || !Number.isInteger(capacity.free) || capacity.free < 0) {
    throw new ValidationError("capacity.free", "必须是 ≥0 的整数");
  }
  return {
    free: capacity.free,
    running: parseRunning(body.running),
    finished: parseFinished(body.finished),
    ...(parseArchivedRuns(body.archivedRuns) === undefined
      ? {}
      : { archivedRuns: parseArchivedRuns(body.archivedRuns) }),
  };
}

function parseError(value: unknown, status: ExecutorResult["status"]): ExecutorResult["error"] {
  if (value === undefined) return null;
  if (status === "succeeded") {
    if (value !== null) throw new ValidationError("error", "succeeded 时必须是 null");
    return null;
  }
  if (value === null) throw new ValidationError("error", "失败/超时/取消时必须提供 error");
  if (!isPlainObject(value)) throw new ValidationError("error", "必须是对象");
  if (typeof value.class !== "string" || typeof value.code !== "string") {
    throw new ValidationError("error", "必须包含 class 与 code");
  }
  if (typeof value.message !== "string") throw new ValidationError("error.message", "必须是字符串");
  return value as ExecutorTaskError;
}

type ResultHeader = {
  status: ExecutorResult["status"];
  attempt: number;
};

function parseResultHeader(body: Record<string, unknown>, taskId: string): ResultHeader {
  if (typeof body.taskId !== "string" || body.taskId !== taskId) {
    throw new ValidationError("taskId", "必须与路径一致");
  }
  if (typeof body.attempt !== "number" || !Number.isInteger(body.attempt) || body.attempt < 1) {
    throw new ValidationError("attempt", "必须是 ≥1 的整数");
  }
  const status = body.status;
  if (status !== "succeeded" && status !== "failed" && status !== "cancelled" && status !== "timeout") {
    throw new ValidationError("status", "必须是 succeeded/failed/cancelled/timeout");
  }
  return { status, attempt: body.attempt };
}

const SIGNAL_KINDS = ["review_verdict", "confirmation_request"] as const;
const MAX_SIGNALS = 8;
const MAX_SIGNALS_BYTES = 16384;

function parseSignals(value: unknown, status: ExecutorResult["status"]): ExecutorResult["signals"] {
  if (value === undefined) return undefined;
  if (status !== "succeeded") throw new ValidationError("signals", "只在 succeeded 时允许");
  if (!Array.isArray(value)) throw new ValidationError("signals", "必须是数组");
  if (value.length > MAX_SIGNALS) throw new ValidationError("signals", `最多 ${MAX_SIGNALS} 条`);
  const signals = value.map((item, index) => {
    if (!isPlainObject(item)) throw new ValidationError(`signals[${index}]`, "必须是对象");
    assertAllowedFields(item, ["seq", "at", "kind", "data"], `signals[${index}]`);
    if (typeof item.seq !== "number" || !Number.isInteger(item.seq) || item.seq < 1) {
      throw new ValidationError(`signals[${index}].seq`, "必须是 ≥1 的整数");
    }
    if (typeof item.at !== "string" || item.at === "") {
      throw new ValidationError(`signals[${index}].at`, "必须是非空字符串");
    }
    if (!SIGNAL_KINDS.includes(item.kind as never)) {
      throw new ValidationError(`signals[${index}].kind`, "不在闭集内");
    }
    if (!isPlainObject(item.data)) throw new ValidationError(`signals[${index}].data`, "必须是对象");
    return {
      seq: item.seq,
      at: item.at,
      kind: item.kind as "review_verdict" | "confirmation_request",
      data: item.data,
    };
  });
  const bytes = new TextEncoder().encode(JSON.stringify(signals)).byteLength;
  if (bytes > MAX_SIGNALS_BYTES) throw new ValidationError("signals", `超过 ${MAX_SIGNALS_BYTES} 字节`);
  return signals;
}

function parseResultContent(body: Record<string, unknown>): {
  message: string;
  truncated: boolean;
  stopReason: string | null;
  usage: ExecutorResult["usage"];
} {
  if (typeof body.message !== "string") throw new ValidationError("message", "必须是字符串");
  if (typeof body.truncated !== "boolean") throw new ValidationError("truncated", "必须是布尔值");
  if (body.stopReason !== null && typeof body.stopReason !== "string") {
    throw new ValidationError("stopReason", "必须是字符串或 null");
  }
  if (body.usage !== null && body.usage !== undefined && !isPlainObject(body.usage)) {
    throw new ValidationError("usage", "必须是对象或 null");
  }
  return {
    message: body.message,
    truncated: body.truncated,
    stopReason: body.stopReason as string | null,
    usage: (body.usage ?? null) as ExecutorResult["usage"],
  };
}

export function parseResultBody(
  body: Record<string, unknown>,
  taskId: string,
): ExecutorResult {
  const header = parseResultHeader(body, taskId);
  const content = parseResultContent(body);
  return {
    taskId,
    attempt: header.attempt,
    status: header.status,
    sessionId:
      typeof body.sessionId === "string" && body.sessionId !== "" ? body.sessionId : undefined,
    message: content.message,
    truncated: content.truncated,
    stopReason: content.stopReason,
    usage: content.usage,
    error: parseError(body.error, header.status),
    signals: parseSignals(body.signals, header.status),
    startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined,
    finishedAt: typeof body.finishedAt === "string" ? body.finishedAt : undefined,
  };
}
