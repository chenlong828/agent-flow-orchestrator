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
  "instance",
  "task",
  "task_attempt",
  "workflow_run",
  "run_node",
  "run_artifact",
  "run_input",
];

beforeAll(async () => {
  db = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

describe("数据库结构", () => {
  test("业务表恰好 23 张，另有 schema_migrations", async () => {
    const rows = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    );
    const names = rows.map((row) => row.table_name);
    expect(names).toEqual([...BUSINESS_TABLES, "schema_migrations"].sort());
  });

  test("15 个迁移按顺序记录，分类参考数据为 6 条", async () => {
    const migrations = await db.query<{ version: string }>(
      "select version from schema_migrations order by version",
    );
    expect(migrations.map((row) => row.version)).toEqual([
      "0001_baseline.sql",
      "0002_workflow_run.sql",
      "0003_task_space.sql",
      "0004_archive_state_backfill.sql",
      "0005_workflow_run_width.sql",
      "0006_skill_slug.sql",
      "0007_drop_instance_blocked.sql",
      "0008_skill_category_flow.sql",
      "0009_run_node_enter_reason.sql",
      "0010_run_node_session_id.sql",
      "0011_task_signal_continuation.sql",
      "0012_run_timeout_resume.sql",
      "0013_run_asset_snapshot.sql",
      "0014_run_input.sql",
      "0015_expert_duty_markdown.sql",
    ]);

    const categories = await db.query<{ code: string; position: number }>(
      "select code, position from skill_category order by position",
    );
    expect(categories).toEqual([
      { code: "coding", position: 0 },
      { code: "retrieval", position: 1 },
      { code: "review", position: 2 },
      { code: "testing", position: 3 },
      { code: "process", position: 4 },
      { code: "docs", position: 5 },
    ]);
  });

  test("Harness 节点登记列与唯一索引落库，凭据必须挂在已绑定节点上", async () => {
    const columns = await db.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
       from information_schema.columns
       where table_schema = 'public' and table_name = 'harness'
         and column_name in ('client_id', 'client_token')
       order by column_name`,
    );
    expect(columns).toEqual([
      { column_name: "client_id", is_nullable: "YES" },
      { column_name: "client_token", is_nullable: "YES" },
    ]);

    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'harness'
         and indexname in ('harness_client_id_key', 'harness_client_token_key')
       order by indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      "harness_client_id_key",
      "harness_client_token_key",
    ]);

    const orphan = await db
      .query(
        `insert into harness (id, name, kind, address, access_mode, concurrency_max, queue_policy, client_token)
         values ('0191f2f0-0000-7000-8000-0000000000aa', 'orphan-token', 'container',
                 '10.0.4.11:7801', 'agent', 1, 'fifo', 'tok-without-node')`,
      )
      .catch((error) => error);
    expect(String(orphan)).toContain("harness_check");
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

  test("task 携带结果信号与续跑 session（v3 加法）", async () => {
    const columns = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'task'
          and column_name in ('result_signal', 'resume_session_id')
        order by column_name`,
    );
    expect(columns).toEqual([
      { column_name: "result_signal", data_type: "jsonb", is_nullable: "YES" },
      { column_name: "resume_session_id", data_type: "text", is_nullable: "YES" },
    ]);
  });

  test("运行编排三表与活跃 run 唯一索引落库", async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('workflow_run', 'run_node', 'run_artifact')
       order by table_name`,
    );
    expect(tables.map((row) => row.table_name)).toEqual([
      "run_artifact",
      "run_node",
      "workflow_run",
    ]);

    const columns = await db.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'workflow_run'
         and column_name in ('state', 'outcome', 'archive_state', 'task_space_path')
       order by column_name`,
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      "archive_state",
      "outcome",
      "state",
      "task_space_path",
    ]);

    const nodeColumns = await db.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
       from information_schema.columns
       where table_schema = 'public' and table_name = 'run_node'
         and column_name = 'session_id'`,
    );
    expect(nodeColumns).toEqual([{ column_name: "session_id", is_nullable: "YES" }]);

    const index = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and indexname = 'workflow_run_active_instance_key'`,
    );
    expect(index).toHaveLength(1);
    expect(index[0]?.indexdef).toContain("UNIQUE INDEX");
    expect(index[0]?.indexdef).toContain("waiting_resume");

    const stateChecks = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def
         from pg_constraint
        where conname in ('workflow_run_state_check', 'run_node_state_check')
        order by conname`,
    );
    expect(stateChecks.map((row) => row.def).join("\n")).toContain("waiting_resume");
    expect(index[0]?.indexdef).toContain("instance_id");
    expect(index[0]?.indexdef).toContain("waiting_confirm");
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
      { table_name: "skill", column_name: "package_digest" },
      { table_name: "skill", column_name: "package_size" },
      { table_name: "skill", column_name: "version" },
      { table_name: "skill", column_name: "enabled" },
      { table_name: "skill", column_name: "revision" },
      { table_name: "skill", column_name: "created_at" },
      { table_name: "skill", column_name: "updated_at" },
      { table_name: "skill", column_name: "created_by" },
      { table_name: "skill", column_name: "updated_by" },
      { table_name: "skill", column_name: "slug" },
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

  test("运行快照列与终态脱钩约束落库", async () => {
    const columns = await db.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'workflow_run'
          and column_name in (
            'workflow_id', 'workflow_ref_id', 'workflow_name',
            'harness_id', 'harness_ref_id', 'harness_name'
          )
        order by column_name`,
    );
    expect(columns).toEqual([
      { column_name: "harness_id", is_nullable: "YES" },
      { column_name: "harness_name", is_nullable: "NO" },
      { column_name: "harness_ref_id", is_nullable: "NO" },
      { column_name: "workflow_id", is_nullable: "YES" },
      { column_name: "workflow_name", is_nullable: "NO" },
      { column_name: "workflow_ref_id", is_nullable: "NO" },
    ]);

    const nodeColumn = await db.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'run_node'
          and column_name = 'expert_name'`,
    );
    expect(nodeColumn).toEqual([{ column_name: "expert_name", is_nullable: "YES" }]);

    const check = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def
         from pg_constraint
        where conname = 'workflow_run_history_detached'`,
    );
    expect(check).toHaveLength(1);
    expect(check[0]?.def).toContain("workflow_id IS NULL");
    expect(check[0]?.def).toContain("harness_id IS NULL");

    const restrict = await db.query<{ name: string; delete_rule: string }>(
      `select c.conname as name, c.confdeltype as delete_rule
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_class r on r.oid = c.confrelid
        where c.contype = 'f'
          and t.relname in ('workflow_run', 'run_node')
          and r.relname in ('workflow', 'harness', 'expert')
        order by c.conname`,
    );
    expect(restrict).toEqual([
      { name: "run_node_expert_id_fkey", delete_rule: "r" },
      { name: "workflow_run_harness_id_fkey", delete_rule: "r" },
      { name: "workflow_run_workflow_id_fkey", delete_rule: "r" },
    ]);
  });
});
