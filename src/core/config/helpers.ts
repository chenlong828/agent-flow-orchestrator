import type { ConfigError } from "./errors.ts";

export type Fail = (
  code: ConfigError["code"],
  source: string,
  field: string | undefined,
  message: string,
) => never;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type BoundedInput = {
  value: number;
  source: string;
  field: string;
  min: number;
  max: number;
  fail: Fail;
};

export function boundedInteger(input: BoundedInput): number {
  const { value, source, field, min, max, fail } = input;
  if (!Number.isInteger(value) || value < min || value > max) {
    fail("config_validation_error", source, field, `${field} 必须是 ${min}–${max} 的整数`);
  }
  return value;
}

export function integerEnv(value: string, field: string, fail: Fail): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    fail("config_validation_error", "env", field, `${field} 必须是整数`);
  }
  return parsed;
}

export function nonEmptyString(value: string, source: string, field: string, fail: Fail): string {
  if (value.trim() === "") {
    fail("config_validation_error", source, field, `${field} 不能为空`);
  }
  return value;
}
