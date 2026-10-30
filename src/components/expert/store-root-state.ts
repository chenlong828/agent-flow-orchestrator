import type { Db } from "../../core/platform/index.ts";

type SetEnabledInput = {
  id: string;
  revision: number;
  enabled: boolean;
  now: Date;
  actor: string | null;
};

export function createExpertStoreRootStates() {
  return {
    async setEnabled(tx: Db, input: SetEnabledInput): Promise<number> {
      const rows = await tx.query<{ id: string }>(
        `update expert set enabled = $1, revision = revision + 1, updated_at = $2,
           updated_by = $3
         where id = $4 and revision = $5
         returning id`,
        [input.enabled, input.now, input.actor, input.id, input.revision],
      );
      return rows.length;
    },

    async deleteRoot(tx: Db, id: string, revision: number): Promise<number> {
      const rows = await tx.query<{ id: string }>(
        "delete from expert where id = $1 and revision = $2 returning id",
        [id, revision],
      );
      return rows.length;
    },

    async bumpRevision(
      tx: Db,
      id: string,
      revision: number,
      now: Date,
      actor: string | null,
    ): Promise<number | null> {
      const row = await tx.one<{ revision: number }>(
        `update expert set revision = revision + 1, updated_at = $1, updated_by = $2
         where id = $3 and revision = $4
         returning revision`,
        [now, actor, id, revision],
      );
      return row?.revision ?? null;
    },
  };
}
