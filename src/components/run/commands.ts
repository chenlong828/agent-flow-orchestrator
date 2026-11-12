import {
  InvalidStateError,
  NotFoundError,
  RunConflictError,
  ValidationError,
} from "../../core/kernel/index.ts";
import type { DecideInput, RunDetail, StartRun } from "./types.ts";
import { advanceLocked } from "./advance.ts";
import { assertRunnableGraph, nodeById, startNode } from "./graph-checks.ts";
import type { RunRuntime } from "./runtime.ts";
import { ensureAbsolutePath, taskSpaceFor } from "./validate.ts";

type CommandsDeps = {
  get(runId: string): Promise<RunDetail>;
};

async function assertRunnableExperts(runtime: RunRuntime, graph: ReturnType<RunRuntime["graphFor"]>): Promise<void> {
  for (const node of graph.nodes) {
    if (node.expertId === null) continue;
    const expert = await runtime.readExpertOrInvalid(node.id, node.expertId);
    if (!expert.enabled) {
      throw new ValidationError(`graph.nodes.${node.id}.expertId`, "专家已停用");
    }
  }
}

async function resolveInstance(runtime: RunRuntime, clientId: string, workspacePath: string) {
  const existing = await runtime.deps.instance.getByBinding(clientId, workspacePath);
  if (existing !== null && existing.state === "retired") {
    throw new ValidationError("workspacePath", "实例已回收");
  }
  return (
    existing ??
    (await runtime.deps.instance.enroll({
      instanceId: runtime.deps.ids.next(),
      clientId,
      workspacePath,
    }))
  );
}

async function start(input: StartRun, runtime: RunRuntime, deps: CommandsDeps): Promise<RunDetail> {
  const workflow = await runtime.deps.workflowRead.get(input.workflowId);
  const graph = workflow.graph;
  assertRunnableGraph(graph);
  await assertRunnableExperts(runtime, graph);
  const harness = await runtime.deps.harnessRead.get(input.harnessId);
  const clientId = harness.clientId;
  if (clientId === null) throw new ValidationError("harnessId", "节点未绑定客户端");
  if (!harness.enabled) throw new ValidationError("harnessId", "节点已停用");
  const workspacePath = ensureAbsolutePath("workspacePath", input.workspacePath);
  const instance = await resolveInstance(runtime, clientId, workspacePath);
  const active = await runtime.store.findActiveByInstance(runtime.deps.db, instance.instanceId);
  if (active !== null) throw new RunConflictError(instance.instanceId);
  const runId = runtime.deps.ids.next();
  const startNodeValue = startNode(graph);
  if (startNodeValue === null) throw new ValidationError("graph.nodes", "缺少开始节点");
  const now = runtime.deps.clock.now();
  await runtime.deps.db.transaction(async (tx) => {
    await runtime.store.insertRun(tx, {
      id: runId,
      workflowId: input.workflowId,
      workflowRevision: workflow.revision,
      graphSnapshot: graph,
      intentMarkdown: input.intentMarkdown,
      harnessId: input.harnessId,
      clientId,
      instanceId: instance.instanceId,
      workspacePath,
      taskSpacePath: taskSpaceFor(workspacePath, runId),
      autoConfirm: input.autoConfirm ?? false,
      now,
      actor: input.actor ?? null,
    });
    await runtime.store.insertNode(tx, {
      runId,
      nodeId: startNodeValue.id,
      visit: 1,
      nodeType: startNodeValue.type,
      expertId: startNodeValue.expertId,
      state: "queued",
      now,
    });
    await runtime.store.setCurrentNode(tx, runId, startNodeValue.id, now);
  });
  await advanceLocked(runtime, runId);
  return deps.get(runId);
}

async function decide(
  input: DecideInput,
  runtime: RunRuntime,
  deps: CommandsDeps,
): Promise<RunDetail> {
  const run = await runtime.loadRun(input.runId);
  if (run.state === "done") throw new InvalidStateError("run 已结束");
  const row = await runtime.store.findNode(runtime.deps.db, run.id, input.nodeId);
  if (row === null) throw new NotFoundError("run_node", `${run.id}/${input.nodeId}`);
  if (row.state === "succeeded" && input.decision === "pass") return deps.get(run.id);
  if (row.state === "rejected" && input.decision === "reject") return deps.get(run.id);
  if (row.state !== "waiting_confirm") throw new InvalidStateError("节点不在 waiting_confirm");
  const node = nodeById(runtime.graphFor(run), row.node_id);
  if (node === null) throw new NotFoundError("节点", row.node_id);
  await runtime.withLock(run.id, async () => {
    const fresh = await runtime.loadRun(run.id);
    if (input.decision === "pass") {
      await runtime.settleNode(fresh, node, row, { state: "succeeded", message: input.comment ?? "" });
      await runtime.deps.db.transaction((tx) =>
        runtime.store.setRunProgress(tx, run.id, {
          state: "running",
          currentNodeId: run.current_node_id,
          now: runtime.deps.clock.now(),
        }),
      );
    } else {
      await runtime.settleNode(fresh, node, row, {
        state: "rejected",
        message: input.comment ?? "",
        verdict: input.comment === null ? null : { decision: "reject", comment: input.comment },
      });
    }
    await advanceLocked(runtime, run.id);
  });
  return deps.get(run.id);
}

async function cancel(runId: string, runtime: RunRuntime, deps: CommandsDeps, actor?: string): Promise<RunDetail> {
  const run = await runtime.loadRun(runId);
  if (run.state === "done") return deps.get(run.id);
  await runtime.withLock(run.id, async () => {
    const fresh = await runtime.loadRun(run.id);
    if (fresh.state === "done") return;
    const row =
      fresh.current_node_id === null
        ? null
        : await runtime.store.findNode(runtime.deps.db, fresh.id, fresh.current_node_id);
    const node = row === null ? null : nodeById(runtime.graphFor(fresh), row.node_id);
    if (row !== null && node !== null && row.state !== "succeeded" && row.state !== "rejected" && row.state !== "failed") {
      await runtime.settleNode(fresh, node, row, {
        state: "failed",
        message: actor === undefined ? "运行已取消" : `运行已取消（${actor}）`,
        error: { code: "cancelled", message: "运行已取消" },
      });
    }
    await runtime.finish(fresh.id, "cancelled", { code: "cancelled", message: "运行已取消" }, null);
  });
  await runtime.deps.scheduler.cancelInstances([run.instance_id]);
  return deps.get(run.id);
}

export function createCommands(runtime: RunRuntime, deps: CommandsDeps) {
  return {
    start: (input: StartRun) => start(input, runtime, deps),
    decide: (input: DecideInput) => decide(input, runtime, deps),
    cancel: (runId: string, actor?: string) => cancel(runId, runtime, deps, actor),
  };
}
