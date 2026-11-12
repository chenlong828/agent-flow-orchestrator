import { ConfigError } from "./errors.ts";

export type RunConfig = {
  runDefaultTimeoutMs: number;
  runMaxNodeVisits: number;
};

export type ArchiveConfig = {
  archiveRoot: string;
};

export type RunFileConfig = {
  defaultTimeoutMs?: number;
  maxNodeVisits?: number;
};

export type ArchiveFileConfig = {
  root?: string;
};

const DEFAULT_RUN_TIMEOUT_MS = 1800000;
const DEFAULT_RUN_MAX_NODE_VISITS = 5;
const DEFAULT_ARCHIVE_ROOT = ".local/archive";
export const RUN_KEYS = new Set(["default_timeout_ms", "max_node_visits"]);
export const ARCHIVE_KEYS = new Set(["root"]);

type Fail = (
  code: ConfigError["code"],
  source: string,
  field: string | undefined,
  message: string,
) => never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type BoundedInput = {
  value: number;
  source: string;
  field: string;
  min: number;
  max: number;
  fail: Fail;
};

function boundedInteger(input: BoundedInput): number {
  const { value, source, field, min, max, fail } = input;
  if (!Number.isInteger(value) || value < min || value > max) {
    fail("config_validation_error", source, field, `${field} 必须是 ${min}–${max} 的整数`);
  }
  return value;
}

function integerEnv(value: string, field: string, fail: Fail): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    fail("config_validation_error", "env", field, `${field} 必须是整数`);
  }
  return parsed;
}

function nonEmptyString(value: string, source: string, field: string, fail: Fail): string {
  if (value.trim() === "") {
    fail("config_validation_error", source, field, `${field} 不能为空`);
  }
  return value;
}

export function parseRun(
  value: unknown,
  source: string,
  fail: Fail,
  assertKnownKeys: (
    value: Record<string, unknown>,
    allowed: Set<string>,
    source: string,
    prefix: string,
  ) => void,
): RunFileConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    fail("config_validation_error", source, "run", "run 必须是表");
  }
  assertKnownKeys(value, RUN_KEYS, source, "run");
  const run: RunFileConfig = {};
  if (value.default_timeout_ms !== undefined) {
    if (typeof value.default_timeout_ms !== "number") {
      fail("config_validation_error", source, "run.default_timeout_ms", "必须是整数");
    }
    run.defaultTimeoutMs = boundedInteger({
      value: value.default_timeout_ms,
      source,
      field: "run.default_timeout_ms",
      min: 1000,
      max: 86400000,
      fail,
    });
  }
  if (value.max_node_visits !== undefined) {
    if (typeof value.max_node_visits !== "number") {
      fail("config_validation_error", source, "run.max_node_visits", "必须是整数");
    }
    run.maxNodeVisits = boundedInteger({
      value: value.max_node_visits,
      source,
      field: "run.max_node_visits",
      min: 1,
      max: 20,
      fail,
    });
  }
  return run;
}

export function parseArchive(
  value: unknown,
  source: string,
  fail: Fail,
  assertKnownKeys: (
    value: Record<string, unknown>,
    allowed: Set<string>,
    source: string,
    prefix: string,
  ) => void,
): ArchiveFileConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    fail("config_validation_error", source, "archive", "archive 必须是表");
  }
  assertKnownKeys(value, ARCHIVE_KEYS, source, "archive");
  if (value.root === undefined) return undefined;
  if (typeof value.root !== "string") {
    fail("config_validation_error", source, "archive.root", "archive.root 必须是字符串");
  }
  return { root: nonEmptyString(value.root, source, "archive.root", fail) };
}

export function resolveRunConfig(
  env: Record<string, string | undefined>,
  file: RunFileConfig | undefined,
  fail: Fail,
): RunConfig {
  const value = (key: string): string | undefined => {
    const raw = env[key];
    return raw === undefined || raw === "" ? undefined : raw;
  };
  const envTimeout = value("RUN_DEFAULT_TIMEOUT_MS");
  const envVisits = value("RUN_MAX_NODE_VISITS");
  return {
    runDefaultTimeoutMs:
      envTimeout === undefined
        ? (file?.defaultTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS)
        : boundedInteger({
            value: integerEnv(envTimeout, "RUN_DEFAULT_TIMEOUT_MS", fail),
            source: "env",
            field: "RUN_DEFAULT_TIMEOUT_MS",
            min: 1000,
            max: 86400000,
            fail,
          }),
    runMaxNodeVisits:
      envVisits === undefined
        ? (file?.maxNodeVisits ?? DEFAULT_RUN_MAX_NODE_VISITS)
        : boundedInteger({
            value: integerEnv(envVisits, "RUN_MAX_NODE_VISITS", fail),
            source: "env",
            field: "RUN_MAX_NODE_VISITS",
            min: 1,
            max: 20,
            fail,
          }),
  };
}

export function resolveArchiveConfig(
  env: Record<string, string | undefined>,
  file: ArchiveFileConfig | undefined,
  fail: Fail,
): ArchiveConfig {
  const raw = env.ARCHIVE_ROOT;
  const envValue = raw === undefined || raw === "" ? undefined : raw;
  return {
    archiveRoot:
      envValue === undefined
        ? (file?.root ?? DEFAULT_ARCHIVE_ROOT)
        : nonEmptyString(envValue, "env", "ARCHIVE_ROOT", fail),
  };
}
