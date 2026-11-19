import type { Db } from "../../core/platform/index.ts";
import type { SkillSet, TaskError, TaskOutcome, TaskSignalBundle, TaskState } from "./types.ts";

export type TaskRow = {
  id: string;
  instance_id: string;
  client_id: string;
  node_id: string;
  attempt: number;
  state: TaskState;
  prompt: string;
  workspace_path: string;
  task_space_path: string;
  timeout_ms: number;
  skill_set: SkillSet | string;
  skill_set_digest: string;
  result_signal: Record<string, unknown> | string | null;
  resume_session_id: string | null;
  outcome: TaskOutcome | null;
  error: TaskError | string | null;
  not_before: Date | string;
  dispatched_at: Date | string | null;
  cancel_requested_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type NewTaskRow = {
  id: string;
  instanceId: string;
  nodeId: string;
  prompt: string;
  workspacePath: string;
  taskSpacePath: string;
  timeoutMs: number;
  skillSet: SkillSet;
  skillSetDigest: string;
  signalBundle: TaskSignalBundle | null;
  resumeSessionId: string | null;
  notBefore: Date;
  now: Date;
};

export type SettleInput = {
  id: string;
  outcome: TaskOutcome;
  error: TaskError | null;
  now: Date;
};

const SELECT = `
  select t.id, t.instance_id, i.client_id, t.node_id, t.attempt, t.state, t.prompt,
         t.workspace_path, t.task_space_path, t.timeout_ms, t.skill_set, t.skill_set_digest,
         t.result_signal, t.resume_session_id, t.outcome, t.error, t.not_before,
         t.dispatched_at, t.cancel_requested_at, t.finished_at, t.created_at, t.updated_at
    from task t join instance i on i.id = t.instance_id`;

async function insertTask(tx: Db, row: NewTaskRow): Promise<void> {
  await tx.query(
    `insert into task
       (id, instance_id, node_id, attempt, state, prompt, workspace_path, task_space_path,
        timeout_ms, skill_set, skill_set_digest, result_signal, resume_session_id,
        not_before, created_at, updated_at)
     values ($1, $2, $3, 1, 'queued', $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12, $13, $13)`,
    [
      row.id,
      row.instanceId,
      row.nodeId,
      row.prompt,
      row.workspacePath,
      row.taskSpacePath,
      row.timeoutMs,
      row.skillSet,
      row.skillSetDigest,
      row.signalBundle,
      row.resumeSessionId,
      row.notBefore,
      row.now,
    ],
  );
}

async function markDispatched(tx: Db, ids: string[], clientId: string, now: Date): Promise<void> {
  for (const id of ids) {
    const updated = await tx.one<{ attempt: number }>(
      `update task
          set state = 'dispatched', dispatched_at = $2, updated_at = $2, cancel_requested_at = null
        where id = $1 and state = 'queued'
        returning attempt`,
      [id, now],
    );
    if (updated === null) continue;
    await tx.query(
      `insert into task_attempt (task_id, attempt, client_id, dispatched_at)
       values ($1, $2, $3, $4)
       on conflict (task_id, attempt) do update
         set client_id = excluded.client_id, dispatched_at = excluded.dispatched_at`,
      [id, updated.attempt, clientId, now],
    );
  }
}

async function markResent(tx: Db, ids: string[], clientId: string, now: Date): Promise<void> {
  for (const id of ids) {
    const updated = await tx.one<{ attempt: number }>(
      `update task set updated_at = $2 where id = $1 and state = 'dispatched'
       returning attempt`,
      [id, now],
    );
    if (updated === null) continue;
    await tx.query(
      `insert into task_attempt (task_id, attempt, client_id, dispatched_at)
       values ($1, $2, $3, $4)
       on conflict (task_id, attempt) do update set client_id = excluded.client_id`,
      [id, updated.attempt, clientId, now],
    );
  }
}

async function settle(tx: Db, input: SettleInput): Promise<void> {
  const updated = await tx.one<{ attempt: number }>(
    `update task
        set state = 'done', outcome = $2, error = $3::jsonb, finished_at = $4, updated_at = $4
      where id = $1 and state <> 'done'
      returning attempt`,
    [input.id, input.outcome, input.error, input.now],
  );
  if (updated === null) return;
  await tx.query(
    `update task_attempt set settled_at = $3, outcome = $4 where task_id = $1 and attempt = $2`,
    [input.id, updated.attempt, input.now, input.outcome],
  );
}

export type SchedulerStore = ReturnType<typeof createSchedulerStore>;

function createTaskReads(db: Db) {
  return {
    findById: (id: string) => db.one<TaskRow>(`${SELECT} where t.id = $1`, [id]),

    findAttempt: (taskId: string, attempt: number) =>
      db.one<{ settled_at: Date | string | null }>(
        `select settled_at from task_attempt where task_id = $1 and attempt = $2`,
        [taskId, attempt],
      ),

    listDispatched: () =>
      db.query<TaskRow>(`${SELECT} where t.state = 'dispatched' order by t.dispatched_at asc, t.id asc`),

    listDispatchedForClient: (clientId: string) =>
      db.query<TaskRow>(
        `${SELECT} where t.state = 'dispatched' and i.client_id = $1
          order by t.dispatched_at asc, t.id asc`,
        [clientId],
      ),

    listQueuedForClient: (clientId: string, now: Date) =>
      db.query<TaskRow>(
        `${SELECT} where t.state = 'queued' and i.client_id = $1
            and i.state = 'active' and t.not_before <= $2
          order by t.created_at asc, t.id asc`,
        [clientId, now],
      ),

    hasDispatchedDigestConflict: async (instanceId: string, digest: string): Promise<boolean> => {
      const row = await db.one<{ id: string }>(
        `select id from task
          where instance_id = $1 and state = 'dispatched' and skill_set_digest <> $2 limit 1`,
        [instanceId, digest],
      );
      return row !== null;
    },

    cancelTargets: (clientId: string) =>
      db.query<{ taskId: string; instanceId: string }>(
        `select t.id as "taskId", t.instance_id as "instanceId"
           from task t join instance i on i.id = t.instance_id
          where t.state = 'dispatched' and t.cancel_requested_at is not null and i.client_id = $1
          order by t.id asc`,
        [clientId],
      ),
  };
}

function createTaskWrites(db: Db) {
  return {
    insertTasks: async (tx: Db, rows: NewTaskRow[]): Promise<void> => {
      for (const row of rows) await insertTask(tx, row);
    },
    markDispatched,
    markResent,
    settle,

    requeue: (tx: Db, id: string, now: Date, notBefore: Date) =>
      tx.query(
        `update task
            set state = 'queued', attempt = attempt + 1, dispatched_at = null,
                cancel_requested_at = null, not_before = $2, updated_at = $3
          where id = $1 and state = 'dispatched'`,
        [id, notBefore, now],
      ),

    /** 人工续跑：只允许把已超时的 done 任务重开为下一 attempt。 */
    reopen: async (
      tx: Db,
      id: string,
      resumeSessionId: string,
      now: Date,
    ): Promise<number | null> => {
      const row = await tx.one<{ attempt: number }>(
        `update task
            set state = 'queued', attempt = attempt + 1, resume_session_id = $2,
                outcome = null, error = null, finished_at = null,
                dispatched_at = null, cancel_requested_at = null,
                not_before = $3, updated_at = $3
          where id = $1 and state = 'done' and outcome = 'failed'
            and (
              error->>'class' = 'timeout'
              or error->>'code' in ('timeout', 'prompt_timeout', 'idle_timeout')
            )
          returning attempt`,
        [id, resumeSessionId, now],
      );
      return row?.attempt ?? null;
    },

    settleQueuedByInstance: async (tx: Db, instanceId: string, now: Date): Promise<number> => {
      const rows = await tx.query<{ id: string }>(
        `update task
            set state = 'done', outcome = 'failed',
                error = '{"class":"workspace","code":"instance_unavailable","message":"实例不可用"}'::jsonb,
                finished_at = $2, updated_at = $2
          where instance_id = $1 and state in ('queued', 'dispatched')
          returning id`,
        [instanceId, now],
      );
      return rows.length;
    },

    cancelQueuedByInstances: async (tx: Db, instanceIds: string[], now: Date): Promise<number> => {
      if (instanceIds.length === 0) return 0;
      const rows = await tx.query<{ id: string }>(
        `update task
            set state = 'done', outcome = 'cancelled', finished_at = $2, updated_at = $2
          where instance_id = any($1::uuid[]) and state = 'queued'
          returning id`,
        [instanceIds, now],
      );
      return rows.length;
    },

    requestCancelDispatched: async (tx: Db, instanceIds: string[], now: Date): Promise<number> => {
      if (instanceIds.length === 0) return 0;
      const rows = await tx.query<{ id: string }>(
        `update task
            set cancel_requested_at = coalesce(cancel_requested_at, $2), updated_at = $2
          where instance_id = any($1::uuid[]) and state = 'dispatched'
          returning id`,
        [instanceIds, now],
      );
      return rows.length;
    },
  };
}

export function createSchedulerStore(db: Db) {
  return { ...createTaskReads(db), ...createTaskWrites(db) };
}
