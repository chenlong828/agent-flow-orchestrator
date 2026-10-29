import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeTestDb, getTestDb } from "../helpers/test-db.ts";

let db: Awaited<ReturnType<typeof getTestDb>>;

const BUSINESS_TABLES = [
  "workflow",
  "workflow_definition",
  "workflow_expert_ref",
  "expert",
  "expert_persona",
  "expert_ref",
  "expert_skill",
  "expert_tool",
  "harness",
  "harness_tag",
  "skill",
  "skill_category",
  "skill_draft",
  "skill_tag",
  "tool",
  "tool_param",
];

beforeAll(async () => {
  db = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

describe("数据库结构", () => {
  test("业务表恰好 16 张，另有 schema_migrations", async () => {
    const rows = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );
    const names = rows.map((row) => row.table_name);
    expect(names).toEqual([...BUSINESS_TABLES, "schema_migrations"].sort());
  });

  test("5 个迁移按顺序记录，分类参考数据为 4 条", async () => {
    const migrations = await db.query<{ version: string }>(
      "select version from schema_migrations order by version",
    );
    expect(migrations.map((row) => row.version)).toEqual([
      "0001_harness.sql",
      "0002_tool.sql",
      "0003_skill.sql",
      "0004_expert.sql",
      "0005_workflow.sql",
    ]);

    const categories = await db.query<{ code: string; position: number }>(
      "select code, position from skill_category order by position",
    );
    expect(categories).toEqual([
      { code: "coding", position: 0 },
      { code: "retrieval", position: 1 },
      { code: "review", position: 2 },
      { code: "testing", position: 3 },
    ]);
  });

  test("引用保护外键为 RESTRICT，子表为 CASCADE", async () => {
    const constraints = await db.query<{ name: string; delete_rule: string }>(
      `select c.conname as name, c.confdeltype as delete_rule
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_class r on r.oid = c.confrelid
       where c.contype = 'f'
         and t.relname = 'tool' and r.relname = 'harness'`,
    );
    expect(constraints).toEqual([{ name: "tool_harness_id_fkey", delete_rule: "r" }]);

    const cascade = await db.query<{ delete_rule: string }>(
      `select c.confdeltype as delete_rule
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_class r on r.oid = c.confrelid
       where c.contype = 'f'
         and t.relname = 'harness_tag' and r.relname = 'harness'`,
    );
    expect(cascade).toEqual([{ delete_rule: "c" }]);

    const draftCascade = await db.query<{ delete_rule: string }>(
      `select c.confdeltype as delete_rule
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_class r on r.oid = c.confrelid
       where c.contype = 'f'
         and t.relname = 'skill_draft' and r.relname = 'skill'`,
    );
    expect(draftCascade).toEqual([{ delete_rule: "c" }]);
  });

  test("工作流三表按冻结 schema 落库", async () => {
    const columns = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name in ('workflow', 'workflow_definition', 'workflow_expert_ref')
       order by table_name, ordinal_position`,
    );
    expect(columns).toEqual([
      { table_name: "workflow", column_name: "id" },
      { table_name: "workflow", column_name: "name" },
      { table_name: "workflow", column_name: "type" },
      { table_name: "workflow", column_name: "description" },
      { table_name: "workflow", column_name: "revision" },
      { table_name: "workflow", column_name: "created_at" },
      { table_name: "workflow", column_name: "updated_at" },
      { table_name: "workflow", column_name: "created_by" },
      { table_name: "workflow", column_name: "updated_by" },
      { table_name: "workflow_definition", column_name: "workflow_id" },
      { table_name: "workflow_definition", column_name: "graph" },
      { table_name: "workflow_definition", column_name: "updated_at" },
      { table_name: "workflow_definition", column_name: "updated_by" },
      { table_name: "workflow_expert_ref", column_name: "workflow_id" },
      { table_name: "workflow_expert_ref", column_name: "node_id" },
      { table_name: "workflow_expert_ref", column_name: "expert_id" },
    ]);
  });

  test("Skill brief、包指针与草稿字段按契约落库", async () => {
    const columns = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name in ('skill', 'skill_draft')
       order by table_name, ordinal_position`,
    );
    expect(columns).toEqual([
      { table_name: "skill", column_name: "id" },
      { table_name: "skill", column_name: "name" },
      { table_name: "skill", column_name: "category_code" },
      { table_name: "skill", column_name: "description" },
      { table_name: "skill", column_name: "package_key" },
      { table_name: "skill", column_name: "version" },
      { table_name: "skill", column_name: "enabled" },
      { table_name: "skill", column_name: "revision" },
      { table_name: "skill", column_name: "created_at" },
      { table_name: "skill", column_name: "updated_at" },
      { table_name: "skill", column_name: "created_by" },
      { table_name: "skill", column_name: "updated_by" },
      { table_name: "skill_draft", column_name: "id" },
      { table_name: "skill_draft", column_name: "skill_id" },
      { table_name: "skill_draft", column_name: "base_revision" },
      { table_name: "skill_draft", column_name: "base_version" },
      { table_name: "skill_draft", column_name: "expires_at" },
      { table_name: "skill_draft", column_name: "created_at" },
      { table_name: "skill_draft", column_name: "created_by" },
      { table_name: "skill_draft", column_name: "updated_by" },
    ]);
  });
});
