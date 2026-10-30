import { join, resolve } from "node:path";
import { ConfigError } from "./errors.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type Config = {
  host: string;
  port: number;
  databaseUrl: string;
  actor: string;
  logLevel: LogLevel;
  skillStorageRoot: string;
  skillDraftTtlHours: number;
};

export type LoadConfigOptions = {
  env?: Record<string, string | undefined>;
  configDir?: string;
};

type FileConfig = {
  server?: {
    host?: string;
    port?: number;
  };
  app?: {
    actor?: string;
  };
  log?: {
    level?: LogLevel;
  };
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_URL = "postgres://postgres@127.0.0.1:54329/agentflow";
const DEFAULT_ACTOR = "local";
const DEFAULT_LOG_LEVEL: LogLevel = "info";
const DEFAULT_SKILL_STORAGE_ROOT = ".local/skills";
const DEFAULT_SKILL_DRAFT_TTL_HOURS = 24;
const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const TOP_LEVEL_KEYS = new Set(["server", "app", "log"]);
const SERVER_KEYS = new Set(["host", "port"]);
const APP_KEYS = new Set(["actor"]);
const LOG_KEYS = new Set(["level"]);

function envValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(
  code: ConfigError["code"],
  source: string,
  field: string | undefined,
  message: string,
): never {
  throw new ConfigError(code, source, message, field);
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  source: string,
  prefix: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      const field = prefix === "" ? key : `${prefix}.${key}`;
      fail("config_validation_error", source, field, `未知配置项：${field}`);
    }
  }
}

function nonEmpty(value: string, source: string, field: string): string {
  if (value.trim() === "") {
    fail("config_validation_error", source, field, `${field} 不能为空`);
  }
  return value;
}

function parseLogLevel(value: string, source: string, field: string): LogLevel {
  if (!LOG_LEVELS.includes(value as LogLevel)) {
    fail("config_validation_error", source, field, `${field} 不合法：${value}`);
  }
  return value as LogLevel;
}

function parsePort(value: number | string, source: string, field: string): number {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail("config_validation_error", source, field, `${field} 不合法：${String(value)}`);
  }
  return port;
}

function parsePositiveIntegerHours(
  value: string,
  source: string,
  field: string,
): number {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1) {
    fail("config_validation_error", source, field, `${field} 不合法：${value}`);
  }
  return hours;
}

function parseServer(
  value: unknown,
  source: string,
): NonNullable<FileConfig["server"]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    fail("config_validation_error", source, "server", "server 必须是表");
  }
  assertKnownKeys(value, SERVER_KEYS, source, "server");
  const server: NonNullable<FileConfig["server"]> = {};
  if (value.host !== undefined) {
    if (typeof value.host !== "string") {
      fail("config_validation_error", source, "server.host", "server.host 必须是字符串");
    }
    server.host = nonEmpty(value.host, source, "server.host");
  }
  if (value.port !== undefined) {
    if (typeof value.port !== "number") {
      fail("config_validation_error", source, "server.port", "server.port 必须是整数");
    }
    server.port = parsePort(value.port, source, "server.port");
  }
  return server;
}

function parseApp(
  value: unknown,
  source: string,
): NonNullable<FileConfig["app"]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    fail("config_validation_error", source, "app", "app 必须是表");
  }
  assertKnownKeys(value, APP_KEYS, source, "app");
  if (value.actor === undefined) return undefined;
  if (typeof value.actor !== "string") {
    fail("config_validation_error", source, "app.actor", "app.actor 必须是字符串");
  }
  return { actor: nonEmpty(value.actor, source, "app.actor") };
}

function parseLog(
  value: unknown,
  source: string,
): NonNullable<FileConfig["log"]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    fail("config_validation_error", source, "log", "log 必须是表");
  }
  assertKnownKeys(value, LOG_KEYS, source, "log");
  if (value.level === undefined) return undefined;
  if (typeof value.level !== "string") {
    fail("config_validation_error", source, "log.level", "log.level 必须是字符串");
  }
  return { level: parseLogLevel(value.level, source, "log.level") };
}

function parseFile(raw: unknown, source: string): FileConfig {
  if (!isRecord(raw)) {
    fail("config_validation_error", source, undefined, "TOML 顶层必须是表");
  }
  assertKnownKeys(raw, TOP_LEVEL_KEYS, source, "");
  const config: FileConfig = {};
  const server = parseServer(raw.server, source);
  if (server !== undefined) config.server = server;
  const app = parseApp(raw.app, source);
  if (app !== undefined) config.app = app;
  const log = parseLog(raw.log, source);
  if (log !== undefined) config.log = log;
  return config;
}

async function readToml(path: string, required: boolean): Promise<FileConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    if (required) {
      fail("config_read_error", path, undefined, `配置文件不存在：${path}`);
    }
    return {};
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    fail("config_read_error", path, undefined, `配置文件读取失败：${path}`);
  }

  let raw: unknown;
  try {
    raw = Bun.TOML.parse(text);
  } catch {
    fail("config_parse_error", path, undefined, `TOML 解析失败：${path}`);
  }

  return parseFile(raw, path);
}

function mergeFile(base: FileConfig, next: FileConfig): FileConfig {
  return {
    server: { ...(base.server ?? {}), ...(next.server ?? {}) },
    app: { ...(base.app ?? {}), ...(next.app ?? {}) },
    log: { ...(base.log ?? {}), ...(next.log ?? {}) },
  };
}

/**
 * 读取 TOML 与进程环境，返回启动配置。
 *
 * 优先级：代码默认值 < default.toml < local.toml < process.env。
 * `.env` 由 Bun 在进入进程前加载到 process.env，这里不重复解析。
 */
async function readConfigFile(
  env: Record<string, string | undefined>,
  configDir: string,
): Promise<FileConfig> {
  const explicitFile = envValue(env, "CONFIG_FILE");
  if (explicitFile !== undefined) {
    return readToml(resolve(process.cwd(), explicitFile), true);
  }
  const base = await readToml(join(configDir, "default.toml"), false);
  const local = await readToml(join(configDir, "local.toml"), false);
  return mergeFile(base, local);
}

function resolveServerConfig(
  env: Record<string, string | undefined>,
  file: FileConfig,
): { host: string; port: number } {
  const envHost = envValue(env, "HOST");
  const envPort = envValue(env, "PORT");
  return {
    host: nonEmpty(
      envHost ?? file.server?.host ?? DEFAULT_HOST,
      envHost === undefined ? "default" : "env",
      "HOST",
    ),
    port:
      envPort === undefined
        ? (file.server?.port ?? DEFAULT_PORT)
        : parsePort(envPort, "env", "PORT"),
  };
}

function resolveAppConfig(
  env: Record<string, string | undefined>,
  file: FileConfig,
): Pick<Config, "actor" | "logLevel" | "skillStorageRoot" | "skillDraftTtlHours"> {
  const envActor = envValue(env, "DEV_ACTOR");
  const envLogLevel = envValue(env, "LOG_LEVEL");
  const envSkillStorageRoot = envValue(env, "SKILL_STORAGE_ROOT");
  const envSkillDraftTtlHours = envValue(env, "SKILL_DRAFT_TTL_HOURS");
  return {
    actor: nonEmpty(
      envActor ?? file.app?.actor ?? DEFAULT_ACTOR,
      envActor === undefined ? "default" : "env",
      "DEV_ACTOR",
    ),
    logLevel:
      envLogLevel === undefined
        ? (file.log?.level ?? DEFAULT_LOG_LEVEL)
        : parseLogLevel(envLogLevel, "env", "LOG_LEVEL"),
    skillStorageRoot: nonEmpty(
      envSkillStorageRoot ?? DEFAULT_SKILL_STORAGE_ROOT,
      envSkillStorageRoot === undefined ? "default" : "env",
      "SKILL_STORAGE_ROOT",
    ),
    skillDraftTtlHours:
      envSkillDraftTtlHours === undefined
        ? DEFAULT_SKILL_DRAFT_TTL_HOURS
        : parsePositiveIntegerHours(envSkillDraftTtlHours, "env", "SKILL_DRAFT_TTL_HOURS"),
  };
}

function resolveEnvConfig(
  env: Record<string, string | undefined>,
  file: FileConfig,
): Omit<Config, "databaseUrl"> {
  return { ...resolveServerConfig(env, file), ...resolveAppConfig(env, file) };
}

export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<Config> {
  const env = options.env ?? process.env;
  const configDir = resolve(options.configDir ?? join(process.cwd(), "config"));
  const file = await readConfigFile(env, configDir);
  return {
    ...resolveEnvConfig(env, file),
    databaseUrl: nonEmpty(
      envValue(env, "DATABASE_URL") ?? DEFAULT_DATABASE_URL,
      "env",
      "DATABASE_URL",
    ),
  };
}
