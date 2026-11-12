import { ValidationError } from "../../core/kernel/index.ts";

const ABSOLUTE = /^\//;
const CONTROL = /[\u0000-\u001f\u007f]/;

export function ensureAbsolutePath(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(field, "必须是非空字符串");
  }
  if (!ABSOLUTE.test(value)) throw new ValidationError(field, "必须是绝对路径");
  if (CONTROL.test(value)) throw new ValidationError(field, "不能包含控制字符");
  if (value.length > 1024) throw new ValidationError(field, "长度不能超过 1024");
  return value.replace(/\/+$/, "");
}

export function ensureAttempt(value: unknown): number {
  const attempt = Number(value);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 100) {
    throw new ValidationError("attempt", "必须是 1–100 的整数");
  }
  return attempt;
}

export function taskSpaceFor(workspacePath: string, runId: string): string {
  return `${workspacePath.replace(/\/+$/, "")}/.agent-flow/task/${runId}`;
}
