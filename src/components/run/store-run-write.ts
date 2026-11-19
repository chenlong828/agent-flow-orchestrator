import type { Db } from "../../core/platform/index.ts";
import type { RunOutcome, RunState } from "./types.ts";
import type { NewRunRow } from "./store-types.ts";

type FinishInput = {
  outcome: RunOutcome;
  error: { code: string; message: string } | null;
  finalMessage: string | null;
  now: Date;
};

async function insertRun(tx: Db, row: NewRunRow): Promise<void> {
  await tx.query(
    `insert into workflow_run
       (id, workflow_id, workflow_ref_id, workflow_name, workflow_revision,
        graph_snapshot, intent_markdown, harness_id, harness_ref_id, harness_name,
        client_id, instance_id, workspace_path, task_space_path, auto_confirm, state,
        archive_state, created_at, updated_at, created_by)
     values ($1, $2, $2, $3, $4, $5::jsonb, $6, $7, $7, $8, $9, $10, $11, $12, $13, 'running',
             'none', $14, $14, $15)`,
    [
      row.id,
      row.workflowId,
      row.workflowName,
      row.workflowRevision,
      row.graphSnapshot,
      row.intentMarkdown,
      row.harnessId,
      row.harnessName,
      row.clientId,
      row.instanceId,
      row.workspacePath,
      row.taskSpacePath,
      row.autoConfirm,
      row.now,
      row.actor,
    ],
  );
}

async function setRunProgress(
  tx: Db,
  runId: string,
  input: { state: RunState; currentNodeId: string | null; now: Date },
): Promise<void> {
  await tx.query(
    `update workflow_run set state = $2, current_node_id = $3, updated_at = $4 where id = $1`,
    [runId, input.state, input.currentNodeId, input.now],
  );
}

async function setCurrentNode(tx: Db, runId: string, nodeId: string, now: Date): Promise<void> {
  await tx.query(`update workflow_run set current_node_id = $2, updated_at = $3 where id = $1`, [
    runId,
    nodeId,
    now,
  ]);
}

async function finishRun(tx: Db, runId: string, input: FinishInput): Promise<void> {
  await tx.query(
    `update workflow_run
        set state = 'done', outcome = $2,
            result = jsonb_build_object('finalMessage', $4::text, 'error', $3::jsonb),
            finished_at = $5, updated_at = $5,
            workflow_id = null, harness_id = null,
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
  await tx.query(
    `update run_node set expert_id = null
      where run_id = $1 and expert_id is not null`,
    [runId],
  );
}

/** 运行行的写入：建 run、推进游标、结算终态。 */
export function createRunWrites() {
  return { insertRun, setRunProgress, setCurrentNode, finishRun };
}
