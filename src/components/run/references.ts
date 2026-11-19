import type { Db } from "../../core/platform/index.ts";
import type {
  Reference,
  RunReferenceOwner,
  RunReferenceReader,
} from "../../core/kernel/index.ts";

const ACTIVE_STATES = "state <> 'done'";

/**
 * 历史 run 的活跃引用：只有未终态的 run 会阻止删除资产。
 * 终态 run 在 finishRun 已把 workflow_id / harness_id / run_node.expert_id 置空，
 * 这里不返回它们；查询本身只读，不承担删除后的补偿。
 */
export function createRunReferenceReader(deps: { db: Db }): RunReferenceReader {
  return {
    async active(owner: RunReferenceOwner, id: string): Promise<Reference[]> {
      const rows =
        owner === "workflow" || owner === "harness"
          ? await deps.db.query<{ id: string }>(
              `select id from workflow_run
                where ${owner === "workflow" ? "workflow_id" : "harness_id"} = $1
                  and ${ACTIVE_STATES}
                order by created_at, id`,
              [id],
            )
          : await deps.db.query<{ id: string }>(
              `select distinct r.id
                 from run_node n
                 join workflow_run r on r.id = n.run_id
                where n.expert_id = $1 and r.${ACTIVE_STATES}
                order by r.id`,
              [id],
            );
      return rows.map((row) => ({ type: "run", id: row.id, name: row.id }));
    },
  };
}
