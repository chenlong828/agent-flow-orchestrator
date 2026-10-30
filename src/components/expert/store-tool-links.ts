import type { Db } from "../../core/platform/index.ts";

export function createExpertStoreToolLinks() {
  return {
    async clearToolLinks(tx: Db, expertId: string): Promise<void> {
      await tx.query("delete from expert_tool where expert_id = $1", [expertId]);
    },

    async insertToolLink(
      tx: Db,
      expertId: string,
      toolId: string,
      position: number,
    ): Promise<void> {
      await tx.query(
        "insert into expert_tool (expert_id, position, tool_id) values ($1, $2, $3)",
        [expertId, position, toolId],
      );
    },

    async toolIdsFor(tx: Db, expertId: string): Promise<string[]> {
      const rows = await tx.query<{ tool_id: string }>(
        "select tool_id from expert_tool where expert_id = $1 order by position asc",
        [expertId],
      );
      return rows.map((row) => row.tool_id);
    },

    async listUsingTool(tx: Db, toolId: string): Promise<{ id: string; name: string }[]> {
      return tx.query(
        `select e.id, e.name from expert_tool et
         join expert e on e.id = et.expert_id
         where et.tool_id = $1 order by lower(e.name) asc, e.id asc`,
        [toolId],
      );
    },
  };
}
