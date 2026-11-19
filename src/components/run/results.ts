import { SessionLogMissingError } from "../../core/kernel/index.ts";
import type { TaskResult, TaskSignal } from "../scheduler/index.ts";
import type { WorkflowNode } from "../workflow/index.ts";
import { advanceLocked } from "./advance.ts";
import { nodeById } from "./graph-checks.ts";
import type { ErrorView } from "./internal.ts";
import type { RunNodeRow, RunRow } from "./types.ts";
import { confirmationOf, confirmationSignalOf, reviewSignalOf, reviewVerdictOf } from "./signals.ts";
import type { RunRuntime } from "./runtime.ts";

type ResultView = {
  status: string;
  message: string;
  error: ErrorView;
  sessionId?: string;
  signals?: TaskSignal[];
};

async function applyReview(
  runtime: RunRuntime,
  run: RunRow,
  row: RunNodeRow,
  node: WorkflowNode,
  result: ResultView,
): Promise<void> {
  const { message, sessionId } = result;
  const verdict = reviewVerdictOf(reviewSignalOf(result.signals));
  if (verdict === null) {
    await runtime.settleNode(run, node, row, {
      state: "failed",
      message,
      error: { code: "verdict_invalid", message: "缺少合法 review_verdict 信号" },
      ...(sessionId === undefined ? {} : { sessionId }),
    });
    await runtime.finish(run.id, "failed", {
      code: "verdict_invalid",
      message: `节点 ${node.id} 的 verdict 不合法`,
    }, null);
    return;
  }
  await runtime.settleNode(run, node, row, {
    state: verdict.verdict === "fail" ? "rejected" : "succeeded",
    verdict,
    message,
    ...(sessionId === undefined ? {} : { sessionId }),
  });
}

async function applyConfirmation(
  runtime: RunRuntime,
  run: RunRow,
  row: RunNodeRow,
  input: {
    node: WorkflowNode;
    result: ResultView;
    confirmation: NonNullable<ReturnType<typeof confirmationOf>>;
  },
): Promise<void> {
  await runtime.setNodeWaitingConfirm(run, input.node, row, {
    verdict: { kind: "confirmation_request", ...input.confirmation },
    message: input.result.message,
    ...(input.result.sessionId === undefined ? {} : { sessionId: input.result.sessionId }),
  });
}

export async function applyResult(
  runtime: RunRuntime,
  run: RunRow,
  row: RunNodeRow,
  result: ResultView,
): Promise<void> {
  const node = nodeById(runtime.graphFor(run), row.node_id);
  if (node === null) {
    await runtime.finish(run.id, "failed", { code: "missing_node", message: row.node_id }, null);
    return;
  }
  if (result.status === "succeeded") {
    const confirmation = confirmationOf(confirmationSignalOf(result.signals));
    if (confirmation !== null) {
      await applyConfirmation(runtime, run, row, { node, result, confirmation });
      return;
    }
    if (node.type === "review") {
      await applyReview(runtime, run, row, node, result);
      return;
    }
    await runtime.settleNode(run, node, row, {
      state: "succeeded",
      message: result.message,
      ...(result.sessionId === undefined ? {} : { sessionId: result.sessionId }),
    });
    return;
  }
  if (result.status === "cancelled") {
    await runtime.settleNode(run, node, row, {
      state: "failed",
      message: result.message,
      error: { code: "cancelled", message: "任务已取消" },
      ...(result.sessionId === undefined ? {} : { sessionId: result.sessionId }),
    });
    await runtime.finish(run.id, "cancelled", { code: "cancelled", message: "任务已取消" }, null);
    return;
  }
  // 超时且有 session：不进终态，等人工用同一 task/session 续跑。
  if (
    result.status === "timeout"
    && result.sessionId !== undefined
    && result.sessionId !== ""
    && result.error !== null
  ) {
    await runtime.setNodeWaitingResume(run, node, row, {
      message: result.message,
      error: result.error,
      sessionId: result.sessionId,
    });
    return;
  }
  await runtime.settleNode(run, node, row, {
    state: "failed",
    message: result.message,
    error: result.error,
    ...(result.sessionId === undefined ? {} : { sessionId: result.sessionId }),
  });
  await runtime.finish(
    run.id,
    "failed",
    result.error ?? { code: result.status, message: "任务失败" },
    null,
  );
}

async function settleRunTask(
  runtime: RunRuntime,
  runId: string,
  row: RunNodeRow,
  result: ResultView,
): Promise<void> {
  const fresh = await runtime.loadRun(runId);
  const node = nodeById(runtime.graphFor(fresh), row.node_id);
  if (node === null) return;
  await applyResult(runtime, fresh, row, result);
  const latest = await runtime.loadRun(runId);
  if (latest.state !== "done" && latest.state !== "waiting_resume") await advanceLocked(runtime, runId);
}

/** P-02 入口：有 run 归属走编排结算，无归属委托调度器（手工注入任务兼容）。 */
export function createResultHandler(runtime: RunRuntime) {
  return async function handleTaskResult(
    clientId: string,
    result: TaskResult,
  ): Promise<{ taskId: string; accepted: boolean }> {
    const row = await runtime.store.findNodeByTask(runtime.deps.db, result.taskId);
    if (row === null) return runtime.deps.scheduler.acceptResult(clientId, result);
    const run = await runtime.loadRun(row.run_id);
    const log = await runtime.store.findArtifact(runtime.deps.db, {
      runId: run.id,
      kind: "session_log",
      nodeId: row.node_id,
      visit: row.visit,
      attempt: result.attempt,
    });
    if (log === null) throw new SessionLogMissingError(result.taskId, result.attempt);
    const ack = await runtime.deps.scheduler.acceptResult(clientId, result);
    if (!ack.accepted) return ack;
    await runtime.withLock(run.id, () =>
      settleRunTask(runtime, run.id, row, {
        status: result.status,
        message: result.message,
        error: result.error as ErrorView,
        ...(result.sessionId === undefined ? {} : { sessionId: result.sessionId }),
        ...(result.signals === undefined ? {} : { signals: result.signals }),
      }),
    );
    return ack;
  };
}
