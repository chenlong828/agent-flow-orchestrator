export type LogLevel = "debug" | "info" | "warn" | "error";

export type Config = {
  host: string;
  port: number;
  databaseUrl: string;
  actor: string;
  logLevel: LogLevel;
};

const DEFAULT_DATABASE_URL = "postgres://postgres@127.0.0.1:54329/agentflow";
const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 不合法：${raw}`);
  }
  return port;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === "") return "info";
  if (!LOG_LEVELS.includes(raw as LogLevel)) {
    throw new Error(`LOG_LEVEL 不合法：${raw}`);
  }
  return raw as LogLevel;
}

/**
 * 读取并校验进程配置。只从环境读取，不在模块内散落环境分支。
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    host: env.HOST === undefined || env.HOST === "" ? "127.0.0.1" : env.HOST,
    port: parsePort(env.PORT),
    databaseUrl:
      env.DATABASE_URL === undefined || env.DATABASE_URL === ""
        ? DEFAULT_DATABASE_URL
        : env.DATABASE_URL,
    actor: env.DEV_ACTOR === undefined || env.DEV_ACTOR === "" ? "local" : env.DEV_ACTOR,
    logLevel: parseLogLevel(env.LOG_LEVEL),
  };
}
