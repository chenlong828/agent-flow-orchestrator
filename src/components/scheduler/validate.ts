import { ValidationError } from "../../core/kernel/index.ts";
import { MAX_PROMPT_BYTES } from "../../core/kernel/index.ts";
import type { ClientReport, TaskDraft, TaskError } from "./types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ensureClientId(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("clientId", "必须是字符串");
  if (value.trim() === "" || /\s/.test(value)) {
    throw new ValidationError("clientId", "必须是非空、不含空白字符的字符串");
  }
  if (value.length > 64) throw new ValidationError("clientId", "长度不能超过 64");
  return value;
}

export function ensureUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ValidationError(field, "必须是 UUID");
  }
  return value;
}

function ensurePositiveInt(value: unknown, field: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new ValidationError(field, `必须是 1–${max} 的整数`);
  }
  return value;
}

export function validateDraft(draft: TaskDraft): TaskDraft {
  if (draft === null || typeof draft !== "object") {
    throw new ValidationError("tasks", "必须是对象数组");
  }
  const instanceId = ensureUuid(draft.instanceId, "instanceId");
  if (typeof draft.nodeId !== "string" || draft.nodeId.trim() === "" || draft.nodeId.length > 200) {
    throw new ValidationError("nodeId", "长度必须是 1–200");
  }
  if (typeof draft.prompt !== "string" || draft.prompt === "") {
    throw new ValidationError("prompt", "不能为空");
  }
  if (new TextEncoder().encode(draft.prompt).byteLength > MAX_PROMPT_BYTES) {
    throw new ValidationError("prompt", `超过 ${MAX_PROMPT_BYTES} 字节`);
  }
  const timeoutMs = ensurePositiveInt(draft.timeoutMs, "timeoutMs", 24 * 60 * 60 * 1000);
  if (!Array.isArray(draft.skillIds)) throw new ValidationError("skillIds", "必须是字符串数组");
  const skillIds = [...new Set(draft.skillIds)];
  for (const id of skillIds) ensureUuid(id, "skillIds");
  return {
    instanceId,
    nodeId: draft.nodeId,
    prompt: draft.prompt,
    timeoutMs,
    skillIds,
    ...(draft.taskSpacePath === undefined ? {} : { taskSpacePath: draft.taskSpacePath }),
  };
}

const ERROR_CLASSES = [
  "workspace",
  "asset",
  "runtime",
  "protocol",
  "cancelled",
  "timeout",
  "scheduler",
  "internal",
] as const;

export function toTaskError(value: unknown): TaskError {
  if (value === null || typeof value !== "object") {
    throw new ValidationError("error", "必须是对象");
  }
  const candidate = value as Record<string, unknown>;
  if (!ERROR_CLASSES.includes(candidate.class as never)) {
    throw new ValidationError("error.class", "不在闭集内");
  }
  if (typeof candidate.code !== "string" || candidate.code === "") {
    throw new ValidationError("error.code", "必须是非空字符串");
  }
  if (typeof candidate.message !== "string") {
    throw new ValidationError("error.message", "必须是字符串");
  }
  return {
    class: candidate.class as TaskError["class"],
    code: candidate.code,
    message: candidate.message,
  };
}

export function validateReport(report: ClientReport): void {
  if (report === null || typeof report !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  if (typeof report.free !== "number" || !Number.isInteger(report.free) || report.free < 0) {
    throw new ValidationError("capacity.free", "必须是 ≥0 的整数");
  }
  if (!Array.isArray(report.running) || !Array.isArray(report.finished)) {
    throw new ValidationError("body", "running/finished 必须是数组");
  }
}
