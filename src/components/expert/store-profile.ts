import type { Db } from "../../core/platform/index.ts";
import type { ExpertRefRow } from "./store-types.ts";

export function createExpertStoreProfiles() {
  return {
    async replacePersona(tx: Db, expertId: string, persona: string[]): Promise<void> {
      await tx.query("delete from expert_persona where expert_id = $1", [expertId]);
      for (const [position, value] of persona.entries()) {
        await tx.query(
          "insert into expert_persona (expert_id, position, value) values ($1, $2, $3)",
          [expertId, position, value],
        );
      }
    },

    async personaFor(tx: Db, expertId: string): Promise<string[]> {
      const rows = await tx.query<{ value: string }>(
        "select value from expert_persona where expert_id = $1 order by position asc",
        [expertId],
      );
      return rows.map((row) => row.value);
    },

    async replaceRefs(
      tx: Db,
      expertId: string,
      refs: { label: string; refType: string; path: string | null }[],
    ): Promise<void> {
      await tx.query("delete from expert_ref where expert_id = $1", [expertId]);
      for (const [position, ref] of refs.entries()) {
        await tx.query(
          `insert into expert_ref (expert_id, position, label, ref_type, path)
           values ($1, $2, $3, $4, $5)`,
          [expertId, position, ref.label, ref.refType, ref.path],
        );
      }
    },

    async refsFor(tx: Db, expertId: string): Promise<ExpertRefRow[]> {
      return tx.query<ExpertRefRow>(
        `select expert_id, position, label, ref_type, path
         from expert_ref where expert_id = $1 order by position asc`,
        [expertId],
      );
    },
  };
}
