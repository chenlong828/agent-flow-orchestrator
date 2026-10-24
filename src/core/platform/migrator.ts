import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "./db.ts";

export type Migrator = {
  up(): Promise<{ applied: string[]; skipped: string[] }>;
};

export class MigrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MigrationError";
  }
}

export type MigratorOptions = {
  db: Db;
  directory: string;
};

function checksum(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}

/**
 * 只向前的迁移执行器：advisory lock 串行化，checksum 校验，整体事务回滚。
 */
export function createMigrator({ db, directory }: MigratorOptions): Migrator {
  return {
    async up(): Promise<{ applied: string[]; skipped: string[] }> {
      let files: string[];
      try {
        files = (await readdir(directory))
          .filter((name) => name.endsWith(".sql"))
          .sort((a, b) => a.localeCompare(b));
      } catch (error) {
        throw new MigrationError(`迁移目录不可读：${directory}`, { cause: error });
      }

      return db.transaction(async (tx) => {
        await tx.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [
          "agentflow_schema_migrations",
        ]);
        await tx.query(`
          create table if not exists schema_migrations (
            version text primary key,
            checksum text not null,
            applied_at timestamptz not null default now()
          )
        `);

        const rows = await tx.query<{ version: string; checksum: string }>(
          "select version, checksum from schema_migrations",
        );
        const appliedChecksums = new Map(rows.map((row) => [row.version, row.checksum]));

        const applied: string[] = [];
        const skipped: string[] = [];
        for (const file of files) {
          const content = await readFile(join(directory, file), "utf8");
          const fileChecksum = checksum(content);
          const known = appliedChecksums.get(file);
          if (known !== undefined) {
            if (known !== fileChecksum) {
              throw new MigrationError(`迁移 ${file} 的 checksum 与已应用版本不一致`);
            }
            skipped.push(file);
            continue;
          }
          try {
            await tx.query(content);
          } catch (error) {
            throw new MigrationError(`迁移 ${file} 执行失败`, { cause: error });
          }
          await tx.query(
            "insert into schema_migrations (version, checksum) values ($1, $2)",
            [file, fileChecksum],
          );
          applied.push(file);
        }
        return { applied, skipped };
      });
    },
  };
}
