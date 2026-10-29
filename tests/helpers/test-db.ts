import { join } from "node:path";
import {
  createDb,
  createMigrator,
  ensureDatabase,
  type DbHandle,
} from "../../src/core/platform/index.ts";

const DEFAULT_URL = "postgres://postgres@127.0.0.1:54329/agentflow";

function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit !== undefined && explicit !== "") return explicit;
  const url = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
  url.pathname = `/agentflow_test_${process.pid}`;
  return url.toString();
}

let db: DbHandle | null = null;
let ready: Promise<DbHandle> | null = null;

async function initialize(): Promise<DbHandle> {
  const url = testDatabaseUrl();
  await ensureDatabase(url);
  const handle = createDb(url);
  const migrator = createMigrator({
    db: handle,
    directory: join(process.cwd(), "db", "migrations"),
  });
  await migrator.up();
  return handle;
}

export async function getTestDb(): Promise<DbHandle> {
  if (db !== null) return db;
  ready ??= initialize();
  db = await ready;
  return db;
}

export async function closeTestDb(): Promise<void> {
  if (db !== null) {
    await db.close();
    db = null;
    ready = null;
  }
}

const BUSINESS_TABLES = [
  "expert_tool",
  "expert_skill",
  "expert_ref",
  "expert_persona",
  "expert",
  "skill_draft",
  "skill_tag",
  "skill",
  "tool_param",
  "tool",
  "harness_tag",
  "harness",
];

/** 清空业务数据，保留 skill_category 参考数据。 */
export async function resetBusinessData(): Promise<void> {
  const handle = await getTestDb();
  await handle.query(`truncate ${BUSINESS_TABLES.join(", ")} cascade`);
}
