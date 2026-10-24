import { SQL } from "bun";
import { DatabaseUnavailableError } from "../kernel/errors.ts";

export type Db = {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
};

export type DbHandle = Db & {
  close(): Promise<void>;
};

type AnyPgError = {
  code?: unknown;
  errno?: unknown;
  message?: unknown;
  constraint?: unknown;
};

function pgCode(error: unknown): string | null {
  const candidate = error as AnyPgError;
  if (candidate === null || typeof candidate !== "object") return null;
  if (typeof candidate.errno === "string" && candidate.errno !== "") return candidate.errno;
  if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
    return candidate.code;
  }
  return null;
}

export function isConnectionError(error: unknown): boolean {
  const candidate = error as AnyPgError;
  if (candidate === null || typeof candidate !== "object") return false;
  const code = String(candidate.code ?? "");
  const sqlState = pgCode(error);
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code.includes("CONNECTION")
  ) {
    return true;
  }
  return sqlState !== null && (sqlState.startsWith("08") || sqlState.startsWith("57P"));
}

export function isUniqueViolation(error: unknown): boolean {
  return pgCode(error) === "23505";
}

export function isForeignKeyViolation(error: unknown): boolean {
  return pgCode(error) === "23503";
}

export function isCheckViolation(error: unknown): boolean {
  return pgCode(error) === "23514";
}

export function violationConstraint(error: unknown): string | null {
  const candidate = error as AnyPgError;
  return typeof candidate?.constraint === "string" ? candidate.constraint : null;
}

function translateError(error: unknown): unknown {
  if (error instanceof DatabaseUnavailableError) return error;
  if (isConnectionError(error)) return new DatabaseUnavailableError("数据库不可用", error);
  return error;
}

function wrapSql(sql: SQL): Db {
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      try {
        const rows = await sql.unsafe(text, params as never[]);
        return rows as T[];
      } catch (error) {
        throw translateError(error);
      }
    },
    async one<T>(text: string, params: unknown[] = []): Promise<T | null> {
      const rows = await db.query<T>(text, params);
      return rows[0] ?? null;
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      try {
        return await sql.begin(async (tx) => {
          const txDb: Db = {
            async query<U>(text: string, params: unknown[] = []): Promise<U[]> {
              try {
                const rows = await tx.unsafe(text, params as never[]);
                return rows as U[];
              } catch (error) {
                throw translateError(error);
              }
            },
            async one<U>(text: string, params: unknown[] = []): Promise<U | null> {
              const rows = await txDb.query<U>(text, params);
              return rows[0] ?? null;
            },
            async transaction<U>(): Promise<U> {
              throw new Error("不支持嵌套事务");
            },
          };
          return await fn(txDb);
        });
      } catch (error) {
        throw translateError(error);
      }
    },
  };
  return db;
}

/**
 * 创建数据库句柄。只暴露参数化查询与事务，不泄漏驱动类型。
 */
export function createDb(databaseUrl: string): DbHandle {
  const sql = new SQL(databaseUrl, { max: 10 });
  const db = wrapSql(sql);
  return {
    ...db,
    async close(): Promise<void> {
      await sql.close();
    },
  };
}

function parseDatabaseName(databaseUrl: string): { adminUrl: string; name: string } {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`数据库名不合法：${name}`);
  }
  url.pathname = "/postgres";
  return { adminUrl: url.toString(), name };
}

/**
 * 确保目标数据库存在；数据库不存在时创建。启动与测试基座共用。
 */
export async function ensureDatabase(databaseUrl: string): Promise<void> {
  const { adminUrl, name } = parseDatabaseName(databaseUrl);
  const admin = new SQL(adminUrl, { max: 1 });
  try {
    const existing = await admin`select 1 as found from pg_database where datname = ${name}`;
    if (existing.length === 0) {
      await admin.unsafe(`create database "${name}"`);
    }
  } catch (error) {
    throw translateError(error);
  } finally {
    await admin.close();
  }
}
