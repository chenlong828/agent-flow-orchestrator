import { toIso, toIsoOrNull } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import type {
  ArchiveState,
  RunArtifactKind,
  RunArtifactRow,
  RunNodeRow,
  RunNodeState,
  RunNodeView,
  RunOutcome,
  RunRow,
  RunState,
  RunSummary,
} from "./types.ts";

const RUN_COLUMNS = `
  id, workflow_id, workflow_revision, graph_snapshot, intent_markdown, harness_id,
  client_id, instance_id, workspace_path, task_space_path, auto_confirm, state,
  outcome, current_node_id, final_message, error, archive_state, started_at,
  finished_at, created_at, updated_at`;

const NODE_COLUMNS = `
  run_id, node_id, visit, node_type, expert_id, state, task_id, verdict,
  message, error, dispatched_at, finished_at`;

export type NewRunRow = {
  id: string;
  workflowId: string;
  workflowRevision: number;
  graphSnapshot: unknown;
  intentMarkdown: string;
  harnessId: string;
  clientId: string;
  instanceId: string;
  workspacePath: string;
  taskSpacePath: string;
  autoConfirm: boolean;
  now: Date;
  actor: string | null;
};

export type NewNodeRow = {
  runId: string;
  nodeId: string;
  visit: number;
  nodeType: string;
  expertId: string | null;
  state: RunNodeState;
  now: Date;
};

export type NewArtifactRow = {
  id: string;
  runId: string;
  nodeId: string | null;
  visit: number | null;
  attempt: number | null;
  kind: RunArtifactKind;
  storeKey: string;
  sizeBytes: number;
  sha256: string;
  now: Date;
};

function parseJson<T>(value: T | string | null): T | null {
  if (value === null) return null;
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

export function toRunSummary(row: RunRow): RunSummary {
  return {
    runId: row.id,
    workflowId: row.workflow_id,
    workflowRevision: row.workflow_revision,
    harnessId: row.harness_id,
    clientId: row.client_id,
    instanceId: row.instance_id,
    workspacePath: row.workspace_path,
    taskSpacePath: row.task_space_path,
    autoConfirm: row.auto_confirm,
    state: row.state,
    outcome: row.outcome,
    currentNodeId: row.current_node_id,
    archiveState: row.archive_state,
    error: parseJson(row.error),
    createdAt: toIso(row.created_at),
    startedAt: toIsoOrNull(row.started_at),
    finishedAt: toIsoOrNull(row.finished_at),
  };
}

export function toNodeView(row: RunNodeRow): RunNodeView {
  return {
    nodeId: row.node_id,
    nodeType: row.node_type,
    visit: row.visit,
    state: row.state,
    taskId: row.task_id,
    verdict: parseJson(row.verdict),
    message: row.message ?? "",
    error: parseJson(row.error),
    dispatchedAt: toIsoOrNull(row.dispatched_at),
    finishedAt: toIsoOrNull(row.finished_at),
  };
}

export function createRunStore() {
  return {
    async insertRun(tx: Db, row: NewRunRow): Promise<void> {
      await tx.query(
        `insert into workflow_run
           (id, workflow_id, workflow_revision, graph_snapshot, intent_markdown, harness_id,
            client_id, instance_id, workspace_path, task_space_path, auto_confirm, state,
            archive_state, started_at, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, 'running',
                 'none', $12, $12, $12, $13, $13)`,
        [
          row.id,
          row.workflowId,
          row.workflowRevision,
          row.graphSnapshot,
          row.intentMarkdown,
          row.harnessId,
          row.clientId,
          row.instanceId,
          row.workspacePath,
          row.taskSpacePath,
          row.autoConfirm,
          row.now,
          row.actor,
        ],
      );
    },

    async insertNode(tx: Db, row: NewNodeRow): Promise<void> {
      await tx.query(
        `insert into run_node
           (run_id, node_id, visit, node_type, expert_id, state, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [row.runId, row.nodeId, row.visit, row.nodeType, row.expertId, row.state, row.now],
      );
    },

    async findRun(db: Db, runId: string): Promise<RunRow | null> {
      return db.one<RunRow>(`select ${RUN_COLUMNS} from workflow_run where id = $1`, [runId]);
    },

    async findActiveByInstance(db: Db, instanceId: string): Promise<RunRow | null> {
      return db.one<RunRow>(
        `select ${RUN_COLUMNS} from workflow_run
          where instance_id = $1 and state in ('running', 'waiting_confirm')`,
        [instanceId],
      );
    },

    async listRuns(
      db: Db,
      query: { workflowId?: string; state?: RunState; limit: number; offset: number },
    ): Promise<{ rows: RunRow[]; total: number }> {
      const where: string[] = [];
      const params: unknown[] = [];
      if (query.workflowId !== undefined) {
        params.push(query.workflowId);
        where.push(`workflow_id = $${params.length}`);
      }
      if (query.state !== undefined) {
        params.push(query.state);
        where.push(`state = $${params.length}`);
      }
      const clause = where.length === 0 ? "" : `where ${where.join(" and ")}`;
      const countRow = await db.one<{ total: number }>(
        `select count(*)::int as total from workflow_run ${clause}`,
        params,
      );
      const rows = await db.query<RunRow>(
        `select ${RUN_COLUMNS} from workflow_run ${clause}
          order by created_at desc, id desc limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return { rows, total: countRow?.total ?? 0 };
    },

    async listNodes(db: Db, runId: string): Promise<RunNodeRow[]> {
      return db.query<RunNodeRow>(
        `select ${NODE_COLUMNS} from run_node where run_id = $1
          order by dispatched_at nulls first, node_id, visit`,
        [runId],
      );
    },

    async findNode(db: Db, runId: string, nodeId: string, visit?: number): Promise<RunNodeRow | null> {
      return db.one<RunNodeRow>(
        visit === undefined
          ? `select ${NODE_COLUMNS} from run_node
              where run_id = $1 and node_id = $2 order by visit desc limit 1`
          : `select ${NODE_COLUMNS} from run_node
              where run_id = $1 and node_id = $2 and visit = $3`,
        visit === undefined ? [runId, nodeId] : [runId, nodeId, visit],
      );
    },

    async findNodeByTask(db: Db, taskId: string): Promise<RunNodeRow | null> {
      return db.one<RunNodeRow>(`select ${NODE_COLUMNS} from run_node where task_id = $1`, [taskId]);
    },

    async maxVisit(db: Db, runId: string, nodeId: string): Promise<number> {
      const row = await db.one<{ visit: number | null }>(
        `select max(visit)::int as visit from run_node where run_id = $1 and node_id = $2`,
        [runId, nodeId],
      );
      return row?.visit ?? 0;
    },

    async setNodeDispatched(
      tx: Db,
      runId: string,
      nodeId: string,
      visit: number,
      taskId: string,
      now: Date,
    ): Promise<void> {
      await tx.query(
        `update run_node set state = 'dispatched', task_id = $4, dispatched_at = $5, updated_at = $5
          where run_id = $1 and node_id = $2 and visit = $3`,
        [runId, nodeId, visit, taskId, now],
      );
    },

    async settleNode(
      tx: Db,
      input: {
        runId: string;
        nodeId: string;
        visit: number;
        state: RunNodeState;
        verdict: Record<string, unknown> | null;
        message: string;
        error: { code: string; message: string } | null;
        now: Date;
      },
    ): Promise<void> {
      await tx.query(
        `update run_node
            set state = $4, verdict = $5::jsonb, message = $6, error = $7::jsonb,
                finished_at = $8, updated_at = $8
          where run_id = $1 and node_id = $2 and visit = $3`,
        [
          input.runId,
          input.nodeId,
          input.visit,
          input.state,
          input.verdict,
          input.message,
          input.error,
          input.now,
        ],
      );
    },

    async setRunProgress(
      tx: Db,
      runId: string,
      input: { state: RunState; currentNodeId: string | null; now: Date },
    ): Promise<void> {
      await tx.query(
        `update workflow_run set state = $2, current_node_id = $3, updated_at = $4 where id = $1`,
        [runId, input.state, input.currentNodeId, input.now],
      );
    },

    async finishRun(
      tx: Db,
      runId: string,
      input: {
        outcome: RunOutcome;
        error: { code: string; message: string } | null;
        finalMessage: string | null;
        now: Date;
      },
    ): Promise<void> {
      await tx.query(
        `update workflow_run
            set state = 'done', outcome = $2, error = $3::jsonb, final_message = $4,
                finished_at = $5, updated_at = $5,
                archive_state = case
                  when archive_state <> 'none' then archive_state
                  when exists (
                    select 1 from run_node n
                     where n.run_id = workflow_run.id and n.state = 'succeeded'
                  ) then 'pending'
                  else 'none'
                end
          where id = $1 and state <> 'done'`,
        [runId, input.outcome, input.error, input.finalMessage, input.now],
      );
    },

    async insertArtifact(tx: Db, row: NewArtifactRow): Promise<void> {
      await tx.query(
        `insert into run_artifact
           (id, run_id, node_id, visit, attempt, kind, store_key, size_bytes, sha256, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (run_id, node_id, visit, attempt) where kind = 'session_log'
         do update set store_key = excluded.store_key, size_bytes = excluded.size_bytes,
                       sha256 = excluded.sha256, created_at = excluded.created_at`,
        [
          row.id,
          row.runId,
          row.nodeId,
          row.visit,
          row.attempt,
          row.kind,
          row.storeKey,
          row.sizeBytes,
          row.sha256,
          row.now,
        ],
      );
    },

    async replaceArchiveArtifact(tx: Db, row: NewArtifactRow): Promise<void> {
      await tx.query(`delete from run_artifact where run_id = $1 and kind = 'archive'`, [row.runId]);
      await tx.query(
        `insert into run_artifact
           (id, run_id, node_id, visit, attempt, kind, store_key, size_bytes, sha256, created_at)
         values ($1, $2, null, null, null, 'archive', $3, $4, $5, $6)`,
        [row.id, row.runId, row.storeKey, row.sizeBytes, row.sha256, row.now],
      );
    },

    async findArtifact(
      db: Db,
      input: { runId: string; kind: RunArtifactKind; nodeId?: string; visit?: number; attempt?: number },
    ): Promise<RunArtifactRow | null> {
      if (input.kind === "archive") {
        return db.one<RunArtifactRow>(
          `select * from run_artifact where run_id = $1 and kind = 'archive'`,
          [input.runId],
        );
      }
      const params: unknown[] = [input.runId, input.kind];
      const where = ["run_id = $1", "kind = $2"];
      if (input.nodeId !== undefined) {
        params.push(input.nodeId);
        where.push(`node_id = $${params.length}`);
      }
      if (input.visit !== undefined) {
        params.push(input.visit);
        where.push(`visit = $${params.length}`);
      }
      if (input.attempt !== undefined) {
        params.push(input.attempt);
        where.push(`attempt = $${params.length}`);
      }
      const order =
        input.attempt === undefined
          ? "order by visit desc, attempt desc limit 1"
          : "order by created_at desc limit 1";
      return db.one<RunArtifactRow>(
        `select * from run_artifact where ${where.join(" and ")} ${order}`,
        params,
      );
    },

    async setCurrentNode(tx: Db, runId: string, nodeId: string, now: Date): Promise<void> {
      await tx.query(`update workflow_run set current_node_id = $2, updated_at = $3 where id = $1`, [
        runId,
        nodeId,
        now,
      ]);
    },

    async listArtifacts(db: Db, runId: string, kind: RunArtifactKind): Promise<RunArtifactRow[]> {
      return db.query<RunArtifactRow>(
        `select * from run_artifact where run_id = $1 and kind = $2 order by created_at`,
        [runId, kind],
      );
    },

    async expirePendingArchives(tx: Db, cutoff: Date): Promise<number> {
      const rows = await tx.query<{ id: string }>(
        `update workflow_run
            set archive_state = 'failed', updated_at = now()
          where archive_state = 'pending' and state = 'done'
            and finished_at is not null and finished_at < $1
          returning id`,
        [cutoff],
      );
      return rows.length;
    },

    async listArchivePending(
      db: Db,
      clientId: string,
    ): Promise<{ id: string; instance_id: string; workspace_path: string; task_space_path: string }[]> {
      return db.query(
        `select r.id, r.instance_id, r.workspace_path, r.task_space_path
           from workflow_run r join instance i on i.id = r.instance_id
          where i.client_id = $1 and r.state = 'done' and r.archive_state = 'pending'
          order by r.finished_at nulls last, r.id`,
        [clientId],
      );
    },

    async markArchived(tx: Db, runId: string, state: ArchiveState, now: Date): Promise<void> {
      await tx.query(
        `update workflow_run set archive_state = $2, updated_at = $3 where id = $1`,
        [runId, state, now],
      );
    },

    async ackArchived(tx: Db, clientId: string, runIds: string[], now: Date): Promise<void> {
      if (runIds.length === 0) return;
      await tx.query(
        `update workflow_run r
            set archive_state = 'stored', updated_at = $3
           from instance i
          where i.id = r.instance_id and i.client_id = $1
            and r.id = any($2::uuid[]) and r.archive_state = 'pending'`,
        [clientId, runIds, now],
      );
    },

    async listActive(db: Db): Promise<RunRow[]> {
      return db.query<RunRow>(
        `select ${RUN_COLUMNS} from workflow_run
          where state in ('running', 'waiting_confirm') order by created_at`,
      );
    },
  };
}

export type RunStore = ReturnType<typeof createRunStore>;
