import { boundedInteger, integerEnv, isRecord, type Fail } from "./helpers.ts";

export type ExecutorConfig = {
  taskMaxAttempts: number;
  taskRetryDelayMs: number;
};

export type ExecutorFileConfig = {
  maxAttempts?: number;
  retryDelayMs?: number;
};

const DEFAULT_TASK_MAX_ATTEMPTS = 3;
const DEFAULT_TASK_RETRY_DELAY_MS = 5000;
export const EXECUTOR_KEYS = new Set(["max_attempts", "retry_delay_ms"]);

export function parseExecutor(
  value: unknown,
  source: string,
  fail: Fail,
  assertKnownKeys: (value: Record<string, unknown>, allowed: Set<string>, source: string, prefix: string) => void,
): ExecutorFileConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    fail("config_validation_error", source, "executor", "executor 必须是表");
  }
  assertKnownKeys(value, EXECUTOR_KEYS, source, "executor");
  const executor: ExecutorFileConfig = {};
  if (value.max_attempts !== undefined) {
    if (typeof value.max_attempts !== "number") {
      fail("config_validation_error", source, "executor.max_attempts", "必须是整数");
    }
    executor.maxAttempts = boundedInteger({
      value: value.max_attempts,
      source,
      field: "executor.max_attempts",
      min: 1,
      max: 10,
      fail,
    });
  }
  if (value.retry_delay_ms !== undefined) {
    if (typeof value.retry_delay_ms !== "number") {
      fail("config_validation_error", source, "executor.retry_delay_ms", "必须是整数");
    }
    executor.retryDelayMs = boundedInteger({
      value: value.retry_delay_ms,
      source,
      field: "executor.retry_delay_ms",
      min: 0,
      max: 600000,
      fail,
    });
  }
  return executor;
}

export function resolveExecutorConfig(
  env: Record<string, string | undefined>,
  file: ExecutorFileConfig | undefined,
  fail: Fail,
): ExecutorConfig {
  const value = (key: string): string | undefined => {
    const raw = env[key];
    return raw === undefined || raw === "" ? undefined : raw;
  };
  const envMaxAttempts = value("TASK_MAX_ATTEMPTS");
  const envRetryDelayMs = value("TASK_RETRY_DELAY_MS");
  return {
    taskMaxAttempts:
      envMaxAttempts === undefined
        ? (file?.maxAttempts ?? DEFAULT_TASK_MAX_ATTEMPTS)
        : boundedInteger({
            value: integerEnv(envMaxAttempts, "TASK_MAX_ATTEMPTS", fail),
            source: "env",
            field: "TASK_MAX_ATTEMPTS",
            min: 1,
            max: 10,
            fail,
          }),
    taskRetryDelayMs:
      envRetryDelayMs === undefined
        ? (file?.retryDelayMs ?? DEFAULT_TASK_RETRY_DELAY_MS)
        : boundedInteger({
            value: integerEnv(envRetryDelayMs, "TASK_RETRY_DELAY_MS", fail),
            source: "env",
            field: "TASK_RETRY_DELAY_MS",
            min: 0,
            max: 600000,
            fail,
          }),
  };
}
