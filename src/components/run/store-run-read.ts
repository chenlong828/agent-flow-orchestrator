import type { Db } from "../../core/platform/index.ts";
import type { RunRow } from "./types.ts";
import { RUN_COLUMNS, type RunListQuery, type RunRowList } from "./store-types.ts";

/** 运行行的只读查询：详情、活跃运行、分页列表与重启恢复扫描。 */
export function createRunReads() {
  return {
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

    async listRuns(db: Db, query: RunListQuery): Promise<RunRowList> {
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

    async listActive(db: Db): Promise<RunRow[]> {
      return db.query<RunRow>(
        `select ${RUN_COLUMNS} from workflow_run
          where state in ('running', 'waiting_confirm') order by created_at`,
      );
    },
  };
}
