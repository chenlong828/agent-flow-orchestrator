import type { Db } from "../../core/platform/index.ts";

export function createExpertStoreSkillLinks() {
  return {
    async clearSkillLinks(tx: Db, expertId: string): Promise<void> {
      await tx.query("delete from expert_skill where expert_id = $1", [expertId]);
    },

    async insertSkillLink(
      tx: Db,
      expertId: string,
      skillId: string,
      position: number,
    ): Promise<void> {
      await tx.query(
        "insert into expert_skill (expert_id, position, skill_id) values ($1, $2, $3)",
        [expertId, position, skillId],
      );
    },

    async skillIdsFor(tx: Db, expertId: string): Promise<string[]> {
      const rows = await tx.query<{ skill_id: string }>(
        "select skill_id from expert_skill where expert_id = $1 order by position asc",
        [expertId],
      );
      return rows.map((row) => row.skill_id);
    },

    async listUsingSkill(tx: Db, skillId: string): Promise<{ id: string; name: string }[]> {
      return tx.query(
        `select e.id, e.name from expert_skill es
         join expert e on e.id = es.expert_id
         where es.skill_id = $1 order by lower(e.name) asc, e.id asc`,
        [skillId],
      );
    },
  };
}
