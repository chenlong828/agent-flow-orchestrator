import { ValidationError } from "./errors.ts";

export function ensureText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ValidationError(field, "不能为空");
  if (trimmed.length > maxLength) {
    throw new ValidationError(field, `长度不能超过 ${maxLength}`);
  }
  return trimmed;
}

export function ensureOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  if (value.length > maxLength) throw new ValidationError(field, `长度不能超过 ${maxLength}`);
  return value;
}

export function ensureEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(field, `必须是 ${allowed.join(" / ")} 之一`);
  }
  return value as T;
}

export function ensureBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError(field, "必须是布尔值");
  }
  return value;
}
