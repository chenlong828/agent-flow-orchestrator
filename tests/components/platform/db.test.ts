import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMigrator,
  isCheckViolation,
  isConnectionError,
  isForeignKeyViolation,
  isUniqueViolation,
  MigrationError,
  violationConstraint,
  type Db,
} from "../../../src/core/platform/index.ts";
import { closeTestDb, getTestDb, resetBusinessData } from "../../helpers/test-db.ts";

const MIGRATIONS = join(process.cwd(), "db", "migrations");
const HARNESS_ID = "0191f2f0-aaaa-7000-8000-000000000001";
const OTHER_HARNESS_ID = "0191f2f0-aaaa-7000-8000-000000000002";

let db: Awaited<ReturnType<typeof getTestDb>>;

async function insertHarness(id: string, name: string, executor: Db = db) {
  await executor.query(
    `insert into harness (id, name, kind, address, access_mode, concurrency_max, queue_policy)
     values ($1, $2, 'container', '127.0.0.1:9000', 'ssh', 1, 'fifo')`,
    [id, name],
  );
}

beforeAll(async () => {
  db = await getTestDb();
});

beforeEach(async () => {
  await resetBusinessData();
});

afterAll(async () => {
  await closeTestDb();
});

describe("platform 事务边界", () => {
  test("事务提交后数据可见", async () => {
    await db.transaction(async (tx) => {
      await insertHarness(HARNESS_ID, "committed-harness", tx);
    });
    const rows = await db.query("select name from harness where id = $1", [HARNESS_ID]);
    expect(rows).toEqual([{ name: "committed-harness" }]);
  });

  test("事务抛错整体回滚，不留下半条数据", async () => {
    const error = await db
      .transaction(async (tx) => {
        await insertHarness(HARNESS_ID, "rolled-back-harness", tx);
        throw new Error("业务失败");
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("业务失败");
    const rows = await db.query("select 1 from harness where id = $1", [HARNESS_ID]);
    expect(rows).toEqual([]);
  });

  test("嵌套事务显式失败，不被静默吞掉", async () => {
    const error = await db
      .transaction(async (tx) => {
        await insertHarness(HARNESS_ID, "nested-harness", tx);
        await tx.transaction(async () => undefined);
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("不支持嵌套事务");
    expect(await db.query("select 1 from harness where id = $1", [HARNESS_ID])).toEqual([]);
  });
});

describe("platform 数据库错误分类", () => {
  test("唯一、外键与检查约束按 SQLSTATE 识别", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ errno: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);

    expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
    expect(isForeignKeyViolation({ code: "23505" })).toBe(false);

    expect(isCheckViolation({ code: "23514" })).toBe(true);
    expect(isCheckViolation({ code: "23503" })).toBe(false);
    expect(violationConstraint({ constraint: "harness_kind_check" })).toBe("harness_kind_check");
    expect(violationConstraint({})).toBeNull();
  });

  test("连接错误覆盖网络错误码与 PostgreSQL 连接类 SQLSTATE", () => {
    for (const error of [
      { code: "ECONNREFUSED" },
      { code: "ENOTFOUND" },
      { code: "ECONNRESET" },
      { code: "ETIMEDOUT" },
      { code: "CONNECTION_CLOSED" },
      { code: "08006" },
      { code: "57P01" },
    ]) {
      expect(isConnectionError(error)).toBe(true);
    }
    expect(isConnectionError({ code: "23505" })).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});

describe("platform 迁移执行", () => {
  test("已应用迁移重复执行只跳过，不重复写 schema_migrations", async () => {
    const before = await db.query("select version, checksum from schema_migrations order by version");
    const migrator = createMigrator({ db, directory: MIGRATIONS });
    const result = await migrator.up();
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      "0001_harness.sql",
      "0002_tool.sql",
      "0003_skill.sql",
      "0004_expert.sql",
    ]);
    const after = await db.query("select version, checksum from schema_migrations order by version");
    expect(after).toEqual(before);
  });

  test("已应用迁移内容变化时校验和不匹配，执行失败且不新增记录", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentflow-migrations-"));
    try {
      const original = await readFile(join(MIGRATIONS, "0001_harness.sql"), "utf8");
      await writeFile(join(directory, "0001_harness.sql"), `${original}\n-- tampered\n`);
      const before = await db.query("select version, checksum from schema_migrations order by version");
      const migrator = createMigrator({ db, directory });
      const error = await migrator.up().catch((e) => e);
      expect(error).toBeInstanceOf(MigrationError);
      expect(error.message).toContain("checksum");
      const after = await db.query("select version, checksum from schema_migrations order by version");
      expect(after).toEqual(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("迁移目录不可读时返回 MigrationError", async () => {
    const migrator = createMigrator({
      db,
      directory: join(process.cwd(), "db", "no-such-migrations"),
    });
    const error = await migrator.up().catch((e) => e);
    expect(error).toBeInstanceOf(MigrationError);
    expect(error.message).toContain("迁移目录不可读");
  });
});
