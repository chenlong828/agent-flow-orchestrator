import { boundedInteger, integerEnv, isRecord, nonEmptyString, type Fail } from "./helpers.ts";

export type RunConfig = {
  runDefaultTimeoutMs: number;
  runMaxNodeVisits: number;
  runMaxInputFiles: number;
  runMaxInputFileBytes: number;
  runMaxInputBytes: number;
};

export type ArchiveConfig = {
  archiveRoot: string;
};

export type RunFileConfig = {
  defaultTimeoutMs?: number;
  maxNodeVisits?: number;
  maxInputFiles?: number;
  maxInputFileBytes?: number;
  maxInputBytes?: number;
};

export type ArchiveFileConfig = {
  root?: string;
};

const DEFAULT_RUN_TIMEOUT_MS = 3600000;
const DEFAULT_RUN_MAX_NODE_VISITS = 5;
const DEFAULT_RUN_MAX_INPUT_FILES = 8;
const DEFAULT_RUN_MAX_INPUT_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_RUN_MAX_INPUT_BYTES = 20 * 1024 * 1024;
const DEFAULT_ARCHIVE_ROOT = ".local/archive";
const RUN_KEYS = new Set([
  "default_timeout_ms",
  "max_node_visits",
  "max_input_files",
  "max_input_file_bytes",
  "max_input_bytes",
]);
const ARCHIVE_KEYS = new Set(["root"]);

type BoundedSpec = { field: string; min: number; max: number };

function parseRunInteger(
  value: unknown,
  spec: BoundedSpec,
  source: string,
  fail: Fail,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    fail("config_validation_error", source, spec.field, "必须是整数");
  }
  return boundedInteger({ value, source, field: spec.field, min: spec.min, max: spec.max, fail });
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
  const timeout = parseRunInteger(
    value.default_timeout_ms,
    { field: "run.default_timeout_ms", min: 1000, max: 86400000 },
    source,
    fail,
  );
  const visits = parseRunInteger(
    value.max_node_visits,
    { field: "run.max_node_visits", min: 1, max: 20 },
    source,
    fail,
  );
  const files = parseRunInteger(
    value.max_input_files,
    { field: "run.max_input_files", min: 1, max: 20 },
    source,
    fail,
  );
  const fileBytes = parseRunInteger(
    value.max_input_file_bytes,
    { field: "run.max_input_file_bytes", min: 1, max: 128 * 1024 * 1024 },
    source,
    fail,
  );
  const bytes = parseRunInteger(
    value.max_input_bytes,
    { field: "run.max_input_bytes", min: 1, max: 512 * 1024 * 1024 },
    source,
    fail,
  );
  if (timeout !== undefined) run.defaultTimeoutMs = timeout;
  if (visits !== undefined) run.maxNodeVisits = visits;
  if (files !== undefined) run.maxInputFiles = files;
  if (fileBytes !== undefined) run.maxInputFileBytes = fileBytes;
  if (bytes !== undefined) run.maxInputBytes = bytes;
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

type EnvBoundedSpec = { key: string; fallback: number; min: number; max: number };

function resolveRunInteger(
  env: Record<string, string | undefined>,
  fileValue: number | undefined,
  spec: EnvBoundedSpec,
  fail: Fail,
): number {
  const raw = env[spec.key];
  if (raw === undefined || raw === "") return fileValue ?? spec.fallback;
  return boundedInteger({
    value: integerEnv(raw, spec.key, fail),
    source: "env",
    field: spec.key,
    min: spec.min,
    max: spec.max,
    fail,
  });
}

export function resolveRunConfig(
  env: Record<string, string | undefined>,
  file: RunFileConfig | undefined,
  fail: Fail,
): RunConfig {
  return {
    runDefaultTimeoutMs: resolveRunInteger(
      env,
      file?.defaultTimeoutMs,
      { key: "RUN_DEFAULT_TIMEOUT_MS", fallback: DEFAULT_RUN_TIMEOUT_MS, min: 1000, max: 86400000 },
      fail,
    ),
    runMaxNodeVisits: resolveRunInteger(
      env,
      file?.maxNodeVisits,
      { key: "RUN_MAX_NODE_VISITS", fallback: DEFAULT_RUN_MAX_NODE_VISITS, min: 1, max: 20 },
      fail,
    ),
    runMaxInputFiles: resolveRunInteger(
      env,
      file?.maxInputFiles,
      { key: "RUN_MAX_INPUT_FILES", fallback: DEFAULT_RUN_MAX_INPUT_FILES, min: 1, max: 20 },
      fail,
    ),
    runMaxInputFileBytes: resolveRunInteger(
      env,
      file?.maxInputFileBytes,
      { key: "RUN_MAX_INPUT_FILE_BYTES", fallback: DEFAULT_RUN_MAX_INPUT_FILE_BYTES, min: 1, max: 128 * 1024 * 1024 },
      fail,
    ),
    runMaxInputBytes: resolveRunInteger(
      env,
      file?.maxInputBytes,
      { key: "RUN_MAX_INPUT_BYTES", fallback: DEFAULT_RUN_MAX_INPUT_BYTES, min: 1, max: 512 * 1024 * 1024 },
      fail,
    ),
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
