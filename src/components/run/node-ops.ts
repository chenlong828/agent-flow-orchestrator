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
  setNodeWaitingConfirm(
    run: RunRow,
    node: WorkflowNode,
    row: RunNodeRow,
    input: {
      verdict: Record<string, unknown> | null;
      message: string;
      sessionId?: string;
    },
  ): Promise<void>;
  setNodeWaitingResume(
    run: RunRow,
    node: WorkflowNode,
    row: RunNodeRow,
    input: {
      message: string;
      error: { code: string; message: string };
      sessionId?: string;
    },
  ): Promise<void>;
  settleNode(
    run: RunRow,
    node: WorkflowNode,
    row: RunNodeRow,
    input: {
      state: "succeeded" | "rejected" | "failed";
      verdict?: Record<string, unknown> | null;
      message: string;
      error?: ErrorView;
      /** 任务结果里的 sessionId；非任务结算路径不传。 */
      sessionId?: string;
    },
  ): Promise<void>;
};

type SettleInput = {
  state: "succeeded" | "rejected" | "failed";
  verdict?: Record<string, unknown> | null;
  message: string;
  error?: ErrorView;
  sessionId?: string;
};

async function writeSettle(
  core: RunCore,
  run: RunRow,
  node: WorkflowNode,
  row: RunNodeRow,
  input: SettleInput,
): Promise<void> {
  const { deps, store } = core;
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
      sessionId: input.sessionId ?? null,
      now,
    }),
  );
}

async function writeWaitingConfirm(
  core: RunCore,
  run: RunRow,
  node: WorkflowNode,
  row: RunNodeRow,
  input: { verdict: Record<string, unknown> | null; message: string; sessionId?: string },
): Promise<void> {
  const { deps, store } = core;
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await store.setNodeWaitingConfirm(tx, {
      runId: run.id,
      nodeId: node.id,
      visit: row.visit,
      verdict: input.verdict,
      message: input.message,
      sessionId: input.sessionId ?? null,
      now,
    });
    await store.setRunProgress(tx, run.id, {
      state: "waiting_confirm",
      currentNodeId: node.id,
      now,
    });
  });
}

async function writeWaitingResume(
  core: RunCore,
  run: RunRow,
  node: WorkflowNode,
  row: RunNodeRow,
  input: { message: string; error: { code: string; message: string }; sessionId?: string },
): Promise<void> {
  const { deps, store } = core;
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await store.setNodeWaitingResume(tx, {
      runId: run.id,
      nodeId: node.id,
      visit: row.visit,
      message: input.message,
      error: input.error,
      sessionId: input.sessionId ?? null,
      now,
    });
    await store.setRunProgress(tx, run.id, {
      state: "waiting_resume",
      currentNodeId: node.id,
      now,
    });
  });
}

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
    const expertName =
      node.expertId === null ? null : (await deps.expertRead.get(node.expertId)).name;
    await deps.db.transaction(async (tx) => {
      await store.insertNode(tx, {
        runId: run.id,
        nodeId: node.id,
        visit,
        nodeType: node.type,
        expertId: node.expertId,
        expertName,
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

  async function setNodeWaitingConfirm(
    run: RunRow,
    node: WorkflowNode,
    row: RunNodeRow,
    input: {
      verdict: Record<string, unknown> | null;
      message: string;
      sessionId?: string;
    },
  ): Promise<void> {
    await writeWaitingConfirm(core, run, node, row, input);
  }

  async function setNodeWaitingResume(
    run: RunRow,
    node: WorkflowNode,
    row: RunNodeRow,
    input: { message: string; error: { code: string; message: string }; sessionId?: string },
  ): Promise<void> {
    await writeWaitingResume(core, run, node, row, input);
  }

  async function settleNode(
    run: RunRow,
    node: WorkflowNode,
    row: RunNodeRow,
    input: SettleInput,
  ): Promise<void> {
    await writeSettle(core, run, node, row, input);
  }

  return { createNode, setNodeWaitingConfirm, setNodeWaitingResume, settleNode };
}
