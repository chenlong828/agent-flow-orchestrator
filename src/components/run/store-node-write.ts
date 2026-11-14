import type { Db } from "../../core/platform/index.ts";
import type { RunNodeState } from "./types.ts";
import type { NewNodeRow } from "./store-types.ts";

export type DispatchWrite = {
  runId: string;
  nodeId: string;
  visit: number;
  taskId: string;
  now: Date;
};

export type SettleWrite = {
  runId: string;
  nodeId: string;
  visit: number;
  state: RunNodeState;
  verdict: Record<string, unknown> | null;
  message: string;
  error: { code: string; message: string } | null;
  now: Date;
};

/** 节点进度的写入：建行、派发回填 taskId、结算。 */
export function createNodeWrites() {
  return {
    async insertNode(tx: Db, row: NewNodeRow): Promise<void> {
      await tx.query(
        `insert into run_node
           (run_id, node_id, visit, node_type, expert_id, state, enter_reason, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7::text::jsonb, $8, $8)`,
        [
          row.runId,
          row.nodeId,
          row.visit,
          row.nodeType,
          row.expertId,
          row.state,
          row.enterReason === undefined || row.enterReason === null
            ? null
            : JSON.stringify(row.enterReason),
          row.now,
        ],
      );
    },

    async setNodeDispatched(tx: Db, input: DispatchWrite): Promise<void> {
      await tx.query(
        `update run_node set state = 'dispatched', task_id = $4, dispatched_at = $5, updated_at = $5
          where run_id = $1 and node_id = $2 and visit = $3`,
        [input.runId, input.nodeId, input.visit, input.taskId, input.now],
      );
    },

    async settleNode(tx: Db, input: SettleWrite): Promise<void> {
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
  };
}
