/**
 * 一次性清理：E2E 联调数据 + SP-TEST-01。
 *
 * 默认 dry-run：在事务中执行删除、打印计数、然后 ROLLBACK。
 * --apply：需 CLEANUP_APPLY_CONFIRM=YES 且 CLEANUP_BACKUP_CONFIRMED=YES；
 *          提交后把目标归档目录移到 .local/archive.cleanup-quarantine-<timestamp>/。
 * 只动 agentflow 主库；不碰 agentflow_test。
 */
import { mkdir, rename, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { SQL } from "bun";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/agentflow";
const ARCHIVE_ROOT = resolve(process.env.ARCHIVE_ROOT ?? ".local/archive");
const E2E_FROM = "2026-11-17T14:55:00Z";
const E2E_TO = "2026-11-17T15:55:00Z";
const SP_WORKFLOW = "01a1d7fd-be08-7725-9756-7c3c32784c67";
const apply = process.argv.includes("--apply");

const expected = {
  workflows: 8, experts: 8, harnesses: 8, runs: 11, instances: 6,
  tasks: 17, artifacts: 18,
  after: { workflows: 4, experts: 12, harnesses: 1, runs: 27, instances: 1, tasks: 156, artifacts: 182 },
};

class DryRunRollback extends Error {}
class Abort extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Abort(message);
}

function inList(ids: string[]): string {
  assert(ids.length > 0, "目标集合为空");
  return ids.map((_, index) => `$${index + 1}`).join(", ");
}

async function count(tx: { unsafe: (text: string, params?: unknown[]) => Promise<unknown[]> }): Promise<Record<string, number>> {
  const one = async (table: string) => ((await tx.unsafe(`select count(*)::int as n from ${table}`)) as { n: number }[])[0]!.n;
  return {
    workflows: await one("workflow"), experts: await one("expert"), harnesses: await one("harness"),
    runs: await one("workflow_run"), instances: await one("instance"), tasks: await one("task"),
    attempts: await one("task_attempt"), artifacts: await one("run_artifact"), nodes: await one("run_node"),
  };
}

if (apply) {
  if (process.env.CLEANUP_APPLY_CONFIRM !== "YES") {
    console.error("apply 需要 CLEANUP_APPLY_CONFIRM=YES");
    process.exit(2);
  }
  if (process.env.CLEANUP_BACKUP_CONFIRMED !== "YES") {
    console.error("apply 需要 CLEANUP_BACKUP_CONFIRMED=YES（已停 PG 备份 pgdata/archive）");
    process.exit(2);
  }
}

const sql = new SQL(DATABASE_URL, { max: 1 });
try {
  let outcomes: Record<string, unknown> = {};
  try {
    await sql.begin(async (tx) => {
      const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await tx.unsafe(text, params)) as T[];
      const workflows = await q<{ id: string }>(
        `select id from workflow where (name like 'E2E 流程 %' and created_at >= $1 and created_at < $2) or id = $3`,
        [E2E_FROM, E2E_TO, SP_WORKFLOW],
      );
      const experts = await q<{ id: string }>(
        `select id from expert where name like 'E2E 专家 %' and created_at >= $1 and created_at < $2`,
        [E2E_FROM, E2E_TO],
      );
      const harnesses = await q<{ id: string }>(
        `select id from harness where name like 'E2E 节点 %' and created_at >= $1 and created_at < $2`,
        [E2E_FROM, E2E_TO],
      );
      const workflowIds = workflows.map((x) => x.id);
      const expertIds = experts.map((x) => x.id);
      const harnessIds = harnesses.map((x) => x.id);
      const runs = await q<{ id: string; instance_id: string }>(
        `select id, instance_id from workflow_run where workflow_id in (${inList(workflowIds)})`,
        workflowIds,
      );
      const runIds = runs.map((x) => x.id);
      const instanceIds = [...new Set(runs.map((x) => x.instance_id))];
      const tasks = await q<{ task_id: string }>(
        `select distinct task_id from run_node where run_id in (${inList(runIds)}) and task_id is not null`,
        runIds,
      );
      const taskIds = tasks.map((x) => x.task_id);
      const artifacts = await q<{ store_key: string }>(
        `select store_key from run_artifact where run_id in (${inList(runIds)})`,
        runIds,
      );
      const counts = {
        workflows: workflowIds.length, experts: expertIds.length, harnesses: harnessIds.length,
        runs: runIds.length, instances: instanceIds.length, tasks: taskIds.length, artifacts: artifacts.length,
      };
      outcomes = { counts, storeKeys: artifacts.map((x) => x.store_key) };
      for (const [key, value] of Object.entries(expected).filter(([key]) => key !== "after")) {
        assert((counts as Record<string, number>)[key] === value, `目标计数 ${key}=${(counts as Record<string, number>)[key]}，预期 ${value}`);
      }
      const active = await q<{ n: number }>(`select count(*)::int as n from workflow_run where id in (${inList(runIds)}) and state <> 'done'`, runIds);
      assert(active[0]!.n === 0, "目标 run 仍有非 done 状态，停止");
      const toolRefs = await q<{ n: number }>(`select count(*)::int as n from tool where harness_id in (${inList(harnessIds)})`, harnessIds);
      assert(toolRefs[0]!.n === 0, "目标 Harness 仍被 tool 引用，停止");

      const before = await count(tx);
      console.log("TARGET", counts);
      console.log("BEFORE", before);

      await tx.unsafe(`delete from workflow_run where id in (${inList(runIds)})`, runIds);
      await tx.unsafe(`delete from task_attempt where task_id in (${inList(taskIds)})`, taskIds);
      await tx.unsafe(`delete from task where id in (${inList(taskIds)})`, taskIds);
      await tx.unsafe(`delete from workflow where id in (${inList(workflowIds)})`, workflowIds);
      await tx.unsafe(`delete from expert where id in (${inList(expertIds)})`, expertIds);
      await tx.unsafe(`delete from harness where id in (${inList(harnessIds)})`, harnessIds);

      const instanceRuns = await q<{ n: number }>(`select count(*)::int as n from workflow_run where instance_id in (${inList(instanceIds)})`, instanceIds);
      const instanceTasks = await q<{ n: number }>(`select count(*)::int as n from task where instance_id in (${inList(instanceIds)})`, instanceIds);
      assert(instanceRuns[0]!.n === 0 && instanceTasks[0]!.n === 0, "目标实例仍被 run/task 引用，停止");
      await tx.unsafe(`delete from instance where id in (${inList(instanceIds)})`, instanceIds);

      const after = await count(tx);
      for (const [key, value] of Object.entries(expected.after)) {
        assert((after as Record<string, number>)[key] === value, `删除后 ${key}=${(after as Record<string, number>)[key]}，预期 ${value}`);
      }
      console.log("AFTER", after);
      outcomes = { ...outcomes, before, after };
      if (!apply) throw new DryRunRollback("dry-run rollback");
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    console.log("DRY_RUN_ROLLBACK");
  }

  if (!apply) {
    console.log("DRY_RUN_OK");
  } else {
    console.log("APPLIED");
  }
  console.log("ARCHIVE_ROOT", ARCHIVE_ROOT);
  const storeKeys = (outcomes.storeKeys as string[] | undefined) ?? [];
  const topDirs = [...new Set(storeKeys.map((key) => {
    const parts = key.split("/");
    return parts[0] === "runs" ? `runs/${parts[1]}` : `history/${parts[1]}/${parts[2]}`;
  }))];
  console.log("ARCHIVE_TARGETS", topDirs);
  if (apply) {
    const quarantine = `${ARCHIVE_ROOT}.cleanup-quarantine-${new Date().toISOString().replaceAll(":", "-")}`;
    for (const top of topDirs) {
      const source = join(ARCHIVE_ROOT, top);
      const target = join(quarantine, top);
      const exists = await stat(source).then((info) => info.isDirectory()).catch(() => false);
      if (!exists) { console.log("ARCHIVE_MISSING", source); continue; }
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
      console.log("ARCHIVE_MOVED", source, "->", target);
    }
    console.log("ARCHIVE_QUARANTINE", quarantine);
  }
} finally {
  await sql.close();
}


