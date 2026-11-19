import type { Db } from "../../core/platform/index.ts";

export type WaitingResumeWrite = {
  runId: string;
  nodeId: string;
  visit: number;
  message: string;
  error: { code: string; message: string };
  sessionId: string | null;
  now: Date;
};

export type ResumedWrite = {
  runId: string;
  nodeId: string;
  visit: number;
  now: Date;
};

/** 超时等待与人工续跑对 run_node 的写入。 */
export function createNodeResumeWrites() {
  return {
    async setNodeWaitingResume(tx: Db, input: WaitingResumeWrite): Promise<void> {
      await tx.query(
        `update run_node
            set state = 'waiting_resume', verdict = null, message = $4, error = $5::jsonb,
                session_id = coalesce($6, session_id), finished_at = null, updated_at = $7
          where run_id = $1 and node_id = $2 and visit = $3`,
        [
          input.runId,
          input.nodeId,
          input.visit,
          input.message,
          input.error,
          input.sessionId,
          input.now,
        ],
      );
    },

    async setNodeResumed(tx: Db, input: ResumedWrite): Promise<void> {
      await tx.query(
        `update run_node
            set state = 'dispatched', verdict = null, message = null, error = null,
                finished_at = null, dispatched_at = $4, updated_at = $4
          where run_id = $1 and node_id = $2 and visit = $3`,
        [input.runId, input.nodeId, input.visit, input.now],
      );
    },
  };
}
