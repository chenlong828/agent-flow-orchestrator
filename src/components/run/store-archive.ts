import type { Db } from "../../core/platform/index.ts";
import type { ArchiveState } from "./types.ts";
import type { ArchiveRow } from "./store-types.ts";

/** 归档电平：待办查询、超时降级、确认与状态写入。 */
export function createArchiveStore() {
  return {
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

    async listArchivePending(db: Db, clientId: string): Promise<ArchiveRow[]> {
      return db.query<ArchiveRow>(
        `select r.id, r.instance_id, r.workspace_path, r.task_space_path
           from workflow_run r join instance i on i.id = r.instance_id
          where i.client_id = $1 and r.state = 'done' and r.archive_state = 'pending'
          order by r.finished_at nulls last, r.id`,
        [clientId],
      );
    },

    async markArchived(tx: Db, runId: string, state: ArchiveState, now: Date): Promise<void> {
      await tx.query(`update workflow_run set archive_state = $2, updated_at = $3 where id = $1`, [
        runId,
        state,
        now,
      ]);
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
  };
}
