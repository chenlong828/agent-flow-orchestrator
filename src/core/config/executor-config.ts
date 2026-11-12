import { boundedInteger, integerEnv, isRecord, type Fail } from "./helpers.ts";

/** 执行面鉴权模式：`off` 只用于开发期，启用 `X-Client-Id` 身份旁路。 */
export type ExecutorAuthMode = "on" | "off";

export type ExecutorConfig = {
  taskMaxAttempts: number;
  taskRetryDelayMs: number;
  /** 默认 `off`：开发期自注册；生产部署必须设 `on`。 */
  auth: ExecutorAuthMode;
};

export type ExecutorFileConfig = {
  maxAttempts?: number;
  retryDelayMs?: number;
};

const DEFAULT_TASK_MAX_ATTEMPTS = 3;
const DEFAULT_TASK_RETRY_DELAY_MS = 5000;
/** 开发期默认：执行面不强制 Bearer，允许 `X-Client-Id` 自注册。 */
const DEFAULT_EXECUTOR_AUTH: ExecutorAuthMode = "off";
export const EXECUTOR_KEYS = new Set(["max_attempts", "retry_delay_ms"]);

function executorAuth(value: string, fail: Fail): ExecutorAuthMode {
  if (value === "on" || value === "off") return value;
  fail("config_validation_error", "env", "EXECUTOR_AUTH", "EXECUTOR_AUTH 必须是 on 或 off");
}

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
  const envAuth = value("EXECUTOR_AUTH");
  return {
    auth: envAuth === undefined ? DEFAULT_EXECUTOR_AUTH : executorAuth(envAuth, fail),
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
