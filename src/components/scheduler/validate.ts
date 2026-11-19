import { ValidationError } from "../../core/kernel/index.ts";
import { MAX_PROMPT_BYTES } from "../../core/kernel/index.ts";
import type { ClientReport, ResultSignalContract, TaskDraft, TaskError } from "./types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_RESULT_SIGNAL_BYTES = 8192;
const SIGNAL_KINDS = ["review_verdict", "confirmation_request"] as const;

function validateSignalContract(value: unknown, field: string): ResultSignalContract {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(field, "必须是对象");
  }
  const signal = value as Record<string, unknown>;
  if (signal.version !== 1) throw new ValidationError(`${field}.version`, "只支持 1");
  if (!SIGNAL_KINDS.includes(signal.kind as never)) {
    throw new ValidationError(`${field}.kind`, "必须是 review_verdict 或 confirmation_request");
  }
  if (typeof signal.required !== "boolean") {
    throw new ValidationError(`${field}.required`, "必须是布尔值");
  }
  if (signal.schema === null || typeof signal.schema !== "object" || Array.isArray(signal.schema)) {
    throw new ValidationError(`${field}.schema`, "必须是对象");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(signal)).byteLength;
  if (bytes > MAX_RESULT_SIGNAL_BYTES) {
    throw new ValidationError(field, `超过 ${MAX_RESULT_SIGNAL_BYTES} 字节`);
  }
  return {
    version: 1,
    kind: signal.kind as ResultSignalContract["kind"],
    required: signal.required,
    schema: signal.schema as Record<string, unknown>,
  };
}

function validateResultSignal(value: unknown): ResultSignalContract {
  return validateSignalContract(value, "resultSignal");
}

/** 额外确认契约：只允许 `confirmation_request` 且非必需（verdict 才是必需结果）。 */
function validateConfirmation(value: unknown): ResultSignalContract {
  const signal = validateSignalContract(value, "confirmation");
  if (signal.kind !== "confirmation_request") {
    throw new ValidationError("confirmation.kind", "必须是 confirmation_request");
  }
  if (signal.required !== false) {
    throw new ValidationError("confirmation.required", "必须是 false");
  }
  return signal;
}

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

type DraftBase = Pick<TaskDraft, "instanceId" | "nodeId" | "prompt" | "timeoutMs" | "skillIds" | "taskSpacePath">;
type DraftOptional = Pick<TaskDraft, "resultSignal" | "confirmation" | "resumeSessionId">;

function validateDraftBase(draft: TaskDraft): DraftBase {
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
  if (typeof draft.taskSpacePath !== "string" || draft.taskSpacePath.trim() === "") {
    throw new ValidationError("taskSpacePath", "必须是非空字符串");
  }
  if (!draft.taskSpacePath.startsWith("/")) {
    throw new ValidationError("taskSpacePath", "必须是绝对路径");
  }
  return {
    instanceId,
    nodeId: draft.nodeId,
    prompt: draft.prompt,
    timeoutMs,
    skillIds,
    taskSpacePath: draft.taskSpacePath,
  };
}

function validateDraftOptional(draft: TaskDraft): DraftOptional {
  const resultSignal = draft.resultSignal === undefined ? undefined : validateResultSignal(draft.resultSignal);
  const confirmation = draft.confirmation === undefined ? undefined : validateConfirmation(draft.confirmation);
  if (
    draft.resumeSessionId !== undefined
    && (typeof draft.resumeSessionId !== "string" || draft.resumeSessionId.length < 1 || draft.resumeSessionId.length > 200)
  ) {
    throw new ValidationError("resumeSessionId", "长度必须是 1–200");
  }
  return {
    ...(resultSignal === undefined ? {} : { resultSignal }),
    ...(confirmation === undefined ? {} : { confirmation }),
    ...(draft.resumeSessionId === undefined ? {} : { resumeSessionId: draft.resumeSessionId }),
  };
}

export function validateDraft(draft: TaskDraft): TaskDraft {
  if (draft === null || typeof draft !== "object") {
    throw new ValidationError("tasks", "必须是对象数组");
  }
  return { ...validateDraftBase(draft), ...validateDraftOptional(draft) };
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
