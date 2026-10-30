import type { Db } from "../../core/platform/index.ts";
import type { ExpertRootWrite } from "./store-types.ts";

type UpdateRootInput = Omit<ExpertRootWrite, "enabled" | "now"> & {
  revision: number;
  now: Date;
};

export function createExpertStoreRootWrites() {
  return {
    async insertRoot(tx: Db, input: ExpertRootWrite): Promise<void> {
      await tx.query(
        `insert into expert
          (id, name, color, role, enabled, duty, skill_order, verify_order, notes,
           revision, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10, $11, $11)`,
        [
          input.id,
          input.name,
          input.color,
          input.role,
          input.enabled,
          input.duty,
          input.skillOrder,
          input.verifyOrder,
          input.notes,
          input.now,
          input.actor,
        ],
      );
    },

    async updateRoot(tx: Db, input: UpdateRootInput): Promise<number> {
      const rows = await tx.query<{ id: string }>(
        `update expert set
           name = $1, color = $2, role = $3, duty = $4, skill_order = $5,
           verify_order = $6, notes = $7, revision = revision + 1,
           updated_at = $8, updated_by = $9
         where id = $10 and revision = $11
         returning id`,
        [
          input.name,
          input.color,
          input.role,
          input.duty,
          input.skillOrder,
          input.verifyOrder,
          input.notes,
          input.now,
          input.actor,
          input.id,
          input.revision,
        ],
      );
      return rows.length;
    },
  };
}
