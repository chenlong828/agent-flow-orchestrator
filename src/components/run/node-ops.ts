import { NotFoundError } from "../../core/kernel/index.ts";
import type { WorkflowNode } from "../workflow/index.ts";
import type { RunCore } from "./core.ts";
import type { ErrorView } from "./internal.ts";
import type { EnterReason, RunNodeRow, RunRow } from "./types.ts";

export type NodeOps = {
  createNode(
    run: RunRow,
    node: WorkflowNode,
    state: "queued" | "waiting_confirm",
    enterReason?: EnterReason | null,
  ): Promise<RunNodeRow | null>;
  settleNode(
    run: RunRow,
    node: WorkflowNode,
    row: RunNodeRow,
    input: {
      state: "succeeded" | "rejected" | "failed";
      verdict?: Record<string, unknown> | null;
      message: string;
      error?: ErrorView;
    },
  ): Promise<void>;
};

/** 节点行原语：建行（含重访轮次上限）与结算。 */
export function createNodeOps(core: RunCore): NodeOps {
  const { deps, store, finish } = core;

  async function createNode(
    run: RunRow,
    node: WorkflowNode,
    state: "queued" | "waiting_confirm",
    enterReason?: EnterReason | null,
  ): Promise<RunNodeRow | null> {
    const visit = (await store.maxVisit(deps.db, run.id, node.id)) + 1;
    if (visit > deps.maxNodeVisits) {
      // 轮次用尽属于 run 终态，不是调用方错误：结果已经接受，不能再返回 409。
      await finish(run.id, "failed", {
        code: "visit_limit_exceeded",
        message: `节点 ${node.id} 超过最大重访次数 ${deps.maxNodeVisits}`,
      }, null);
      return null;
    }
    const now = deps.clock.now();
    await deps.db.transaction(async (tx) => {
      await store.insertNode(tx, {
        runId: run.id,
        nodeId: node.id,
        visit,
        nodeType: node.type,
        expertId: node.expertId,
        state,
        ...(enterReason === undefined || enterReason === null ? {} : { enterReason }),
        now,
      });
      await store.setCurrentNode(tx, run.id, node.id, now);
      if (state === "waiting_confirm") {
        await store.setRunProgress(tx, run.id, {
          state: "waiting_confirm",
          currentNodeId: node.id,
          now,
        });
      }
    });
    const row = await store.findNode(deps.db, run.id, node.id, visit);
    if (row === null) throw new NotFoundError("run_node", `${run.id}/${node.id}/${visit}`);
    return row;
  }

  async function settleNode(
    run: RunRow,
    node: WorkflowNode,
    row: RunNodeRow,
    input: {
      state: "succeeded" | "rejected" | "failed";
      verdict?: Record<string, unknown> | null;
      message: string;
      error?: ErrorView;
    },
  ): Promise<void> {
    const now = deps.clock.now();
    await deps.db.transaction((tx) =>
      store.settleNode(tx, {
        runId: run.id,
        nodeId: node.id,
        visit: row.visit,
        state: input.state,
        verdict: input.verdict ?? null,
        message: input.message,
        error: input.error ?? null,
        now,
      }),
    );
  }

  return { createNode, settleNode };
}
