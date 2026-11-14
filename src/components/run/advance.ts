import { ValidationError } from "../../core/kernel/index.ts";
import type { WorkflowGraph, WorkflowNode } from "../workflow/index.ts";
import {
  nodeById,
  rollbackTarget,
  seqOut,
  startNode,
} from "./graph-checks.ts";
import type { EnterReason, RunNodeRow, RunRow } from "./types.ts";
import type { RunRuntime } from "./runtime.ts";

type Step = { type: "stop" } | { type: "next"; currentId: string };

function pathBetween(graph: WorkflowGraph, from: string, to: string): WorkflowNode[] {
  const path: WorkflowNode[] = [];
  let current = from;
  for (let guard = 0; guard <= graph.nodes.length; guard += 1) {
    const node = nodeById(graph, current);
    if (node === null) return [];
    path.push(node);
    if (current === to) return path;
    const out = seqOut(graph, node.id);
    if (out.length !== 1) return [];
    const next = out[0];
    if (next === undefined) return [];
    current = next.to;
  }
  return [];
}

async function markCurrent(runtime: RunRuntime, run: RunRow, nodeId: string): Promise<void> {
  const now = runtime.deps.clock.now();
  await runtime.deps.db.transaction((tx) => runtime.store.setCurrentNode(tx, run.id, nodeId, now));
}

async function stepConfirm(
  runtime: RunRuntime,
  run: RunRow,
  node: WorkflowNode,
  existing: RunNodeRow | null,
): Promise<{ type: "stop" } | { type: "row"; row: RunNodeRow }> {
  let row = existing ?? (await runtime.createNode(run, node, "waiting_confirm"));
  if (row === null) return { type: "stop" };
  if (row.state !== "waiting_confirm") return { type: "row", row };
  if (!run.auto_confirm) {
    await runtime.setWaitingConfirm(run.id);
    return { type: "stop" };
  }
  await runtime.settleNode(run, node, row, { state: "succeeded", message: "auto" });
  row = await runtime.store.findNode(runtime.deps.db, run.id, node.id);
  if (row === null) return { type: "stop" };
  return { type: "row", row };
}

async function stepRejected(
  runtime: RunRuntime,
  run: RunRow,
  graph: WorkflowGraph,
  node: WorkflowNode,
  row: RunNodeRow,
): Promise<Step> {
  const target = rollbackTarget(graph, node.id);
  if (target === null) {
    await runtime.finish(run.id, "failed", {
      code: "missing_rollback_edge",
      message: `节点 ${node.id} 没有回退边`,
    }, null);
    return { type: "stop" };
  }
  const path = pathBetween(graph, target, node.id);
  if (path.length === 0) {
    await runtime.finish(run.id, "failed", {
      code: "invalid_rollback_target",
      message: `回退目标 ${target} 不在当前路径上`,
    }, null);
    return { type: "stop" };
  }
  // 回退进入原因只记指针：理由正文仍在被驳回行的 verdict 里。
  const enterReason: EnterReason =
    node.type === "confirm"
      ? { kind: "confirm_reject", from: node.id, fromVisit: row.visit }
      : { kind: "review_fail", from: node.id, fromVisit: row.visit };
  for (const revisit of path) {
    const created = await runtime.createNode(run, revisit, "queued", enterReason);
    if (created === null) return { type: "stop" };
  }
  await markCurrent(runtime, run, target);
  return { type: "next", currentId: target };
}

async function stepSucceeded(
  runtime: RunRuntime,
  run: RunRow,
  graph: WorkflowGraph,
  node: WorkflowNode,
  row: RunNodeRow,
): Promise<Step> {
  if (node.type === "end") {
    await runtime.finish(run.id, "succeeded", null, row.message);
    return { type: "stop" };
  }
  const out = seqOut(graph, node.id);
  const next = out.length === 1 ? out[0] : undefined;
  if (next === undefined) {
    await runtime.finish(run.id, "failed", {
      code: "missing_out_edge",
      message: `节点 ${node.id} 没有唯一出边`,
    }, null);
    return { type: "stop" };
  }
  await markCurrent(runtime, run, next.to);
  return { type: "next", currentId: next.to };
}

async function stepNode(
  runtime: RunRuntime,
  run: RunRow,
  graph: WorkflowGraph,
  node: WorkflowNode,
): Promise<Step> {
  const existing = await runtime.store.findNode(runtime.deps.db, run.id, node.id);
  let row = existing;
  if (node.type === "confirm") {
    const confirmed = await stepConfirm(runtime, run, node, row);
    if (confirmed.type === "stop") return confirmed;
    row = confirmed.row;
  }
  if (row === null) row = await runtime.createNode(run, node, "queued");
  if (row === null) return { type: "stop" };
  switch (row.state) {
    case "queued":
      await runtime.dispatch(run, node, row);
      return { type: "stop" };
    case "dispatched":
      return { type: "stop" };
    case "waiting_confirm":
      await runtime.setWaitingConfirm(run.id);
      return { type: "stop" };
    case "failed":
      return { type: "stop" };
    case "rejected":
      return stepRejected(runtime, run, graph, node, row);
    case "succeeded":
      return stepSucceeded(runtime, run, graph, node, row);
    default:
      return { type: "stop" };
  }
}

export async function advanceLocked(runtime: RunRuntime, runId: string): Promise<void> {
  const run = await runtime.loadRun(runId);
  if (run.state === "done") return;
  const graph = runtime.graphFor(run);
  const start = startNode(graph);
  if (start === null) throw new ValidationError("graph.nodes", "缺少开始节点");
  let currentId = run.current_node_id ?? start.id;
  if (run.current_node_id === null) await markCurrent(runtime, run, currentId);
  for (let guard = 0; guard <= graph.nodes.length * 3; guard += 1) {
    const node = nodeById(graph, currentId);
    if (node === null) {
      await runtime.finish(run.id, "failed", { code: "missing_node", message: currentId }, null);
      return;
    }
    const step = await stepNode(runtime, run, graph, node);
    if (step.type === "stop") return;
    currentId = step.currentId;
  }
  await runtime.finish(run.id, "failed", { code: "advance_loop", message: "推进超过上限" }, null);
}

/** 逐节点推进（幂等）；终态直接返回。 */
export function createAdvance(runtime: RunRuntime) {
  return async function advance(runId: string): Promise<void> {
    await runtime.withLock(runId, () => advanceLocked(runtime, runId));
  };
}
