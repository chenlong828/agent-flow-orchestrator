import { ValidationError } from "../../core/kernel/index.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ensureClientId(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("clientId", "必须是字符串");
  if (value.trim() === "" || value.trim() !== value || /\s/.test(value)) {
    throw new ValidationError("clientId", "必须是非空、无空白字符的字符串");
  }
  if (value.length > 64) throw new ValidationError("clientId", "长度不能超过 64");
  return value;
}

export function ensureWorkspacePath(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("workspacePath", "必须是字符串");
  if (value.length === 0 || value.length > 1024) {
    throw new ValidationError("workspacePath", "长度必须是 1–1024");
  }
  if (!value.startsWith("/")) {
    throw new ValidationError("workspacePath", "必须是 POSIX 绝对路径");
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ValidationError("workspacePath", "不能包含控制字符");
  }
  return value;
}

export function ensureInstanceId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ValidationError("instanceId", "必须是 UUID");
  }
  return value;
}
