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

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** 目录名取运行启动时刻的本地时间：`YYYYMMDD-HHmmss`，人可读且稳定。 */
function taskSpaceName(startedAt: Date): string {
  const date = [startedAt.getFullYear(), pad(startedAt.getMonth() + 1), pad(startedAt.getDate())].join("");
  const time = [pad(startedAt.getHours()), pad(startedAt.getMinutes()), pad(startedAt.getSeconds())].join("");
  return `${date}-${time}`;
}

/** task-space 名由服务端生成，调用方不提供路径分量；冲突时由调用方追加序号。 */
export function taskSpaceFor(workspacePath: string, startedAt: Date, suffix?: number): string {
  const base = `${workspacePath.replace(/\/+$/, "")}/task-spaces/${taskSpaceName(startedAt)}`;
  return suffix === undefined ? base : `${base}-${suffix}`;
}
