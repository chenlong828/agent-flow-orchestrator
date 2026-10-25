import { join, resolve } from "node:path";
import { ConfigError } from "./errors.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type Config = {
  host: string;
  port: number;
  databaseUrl: string;
  actor: string;
  logLevel: LogLevel;
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

function parseFile(raw: unknown, source: string): FileConfig {
  if (!isRecord(raw)) {
    fail("config_validation_error", source, undefined, "TOML 顶层必须是表");
  }
  assertKnownKeys(raw, TOP_LEVEL_KEYS, source, "");

  const config: FileConfig = {};

  if (raw.server !== undefined) {
    if (!isRecord(raw.server)) {
      fail("config_validation_error", source, "server", "server 必须是表");
    }
    assertKnownKeys(raw.server, SERVER_KEYS, source, "server");
    const server: NonNullable<FileConfig["server"]> = {};
    if (raw.server.host !== undefined) {
      if (typeof raw.server.host !== "string") {
        fail("config_validation_error", source, "server.host", "server.host 必须是字符串");
      }
      server.host = nonEmpty(raw.server.host, source, "server.host");
    }
    if (raw.server.port !== undefined) {
      if (typeof raw.server.port !== "number") {
        fail("config_validation_error", source, "server.port", "server.port 必须是整数");
      }
      server.port = parsePort(raw.server.port, source, "server.port");
    }
    config.server = server;
  }

  if (raw.app !== undefined) {
    if (!isRecord(raw.app)) {
      fail("config_validation_error", source, "app", "app 必须是表");
    }
    assertKnownKeys(raw.app, APP_KEYS, source, "app");
    if (raw.app.actor !== undefined) {
      if (typeof raw.app.actor !== "string") {
        fail("config_validation_error", source, "app.actor", "app.actor 必须是字符串");
      }
      config.app = { actor: nonEmpty(raw.app.actor, source, "app.actor") };
    }
  }

  if (raw.log !== undefined) {
    if (!isRecord(raw.log)) {
      fail("config_validation_error", source, "log", "log 必须是表");
    }
    assertKnownKeys(raw.log, LOG_KEYS, source, "log");
    if (raw.log.level !== undefined) {
      if (typeof raw.log.level !== "string") {
        fail("config_validation_error", source, "log.level", "log.level 必须是字符串");
      }
      config.log = {
        level: parseLogLevel(raw.log.level, source, "log.level"),
      };
    }
  }

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
export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<Config> {
  const env = options.env ?? process.env;
  const configDir = resolve(options.configDir ?? join(process.cwd(), "config"));
  const explicitFile = envValue(env, "CONFIG_FILE");

  let file: FileConfig;
  if (explicitFile !== undefined) {
    file = await readToml(resolve(process.cwd(), explicitFile), true);
  } else {
    const base = await readToml(join(configDir, "default.toml"), false);
    const local = await readToml(join(configDir, "local.toml"), false);
    file = mergeFile(base, local);
  }

  const envHost = envValue(env, "HOST");
  const envPort = envValue(env, "PORT");
  const envActor = envValue(env, "DEV_ACTOR");
  const envLogLevel = envValue(env, "LOG_LEVEL");

  const host = nonEmpty(
    envHost ?? file.server?.host ?? DEFAULT_HOST,
    envHost === undefined ? "default" : "env",
    "HOST",
  );
  const port =
    envPort === undefined
      ? (file.server?.port ?? DEFAULT_PORT)
      : parsePort(envPort, "env", "PORT");
  const actor = nonEmpty(
    envActor ?? file.app?.actor ?? DEFAULT_ACTOR,
    envActor === undefined ? "default" : "env",
    "DEV_ACTOR",
  );
  const logLevel =
    envLogLevel === undefined
      ? (file.log?.level ?? DEFAULT_LOG_LEVEL)
      : parseLogLevel(envLogLevel, "env", "LOG_LEVEL");
  const databaseUrl = nonEmpty(
    envValue(env, "DATABASE_URL") ?? DEFAULT_DATABASE_URL,
    "env",
    "DATABASE_URL",
  );

  return {
    host,
    port,
    databaseUrl,
    actor,
    logLevel,
  };
}
