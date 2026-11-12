import type { Db } from "../../core/platform/index.ts";
import type { RunNodeRow } from "./types.ts";
import { NODE_COLUMNS } from "./store-types.ts";

/** 节点进度的只读查询。 */
export function createNodeReads() {
  return {
    async listNodes(db: Db, runId: string): Promise<RunNodeRow[]> {
      return db.query<RunNodeRow>(
        `select ${NODE_COLUMNS} from run_node where run_id = $1
          order by dispatched_at nulls first, node_id, visit`,
        [runId],
      );
    },

    async findNode(
      db: Db,
      runId: string,
      nodeId: string,
      visit?: number,
    ): Promise<RunNodeRow | null> {
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
      return db.one<RunNodeRow>(`select ${NODE_COLUMNS} from run_node where task_id = $1`, [
        taskId,
      ]);
    },

    async maxVisit(db: Db, runId: string, nodeId: string): Promise<number> {
      const row = await db.one<{ visit: number | null }>(
        `select max(visit)::int as visit from run_node where run_id = $1 and node_id = $2`,
        [runId, nodeId],
      );
      return row?.visit ?? 0;
    },
  };
}
