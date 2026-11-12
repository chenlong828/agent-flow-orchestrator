import type { Db } from "../../core/platform/index.ts";
import type { RunArtifactKind, RunArtifactRow } from "./types.ts";
import type { ArchiveRow, ArtifactQuery, NewArtifactRow } from "./store-types.ts";

export type { ArchiveRow, ArtifactQuery } from "./store-types.ts";

/** 会话日志与归档包的制品元数据读写。 */
export function createLogStore() {
  return {
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

    async findArtifact(db: Db, input: ArtifactQuery): Promise<RunArtifactRow | null> {
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

    async listArtifacts(db: Db, runId: string, kind: RunArtifactKind): Promise<RunArtifactRow[]> {
      return db.query<RunArtifactRow>(
        `select * from run_artifact where run_id = $1 and kind = $2 order by created_at`,
        [runId, kind],
      );
    },
  };
}
