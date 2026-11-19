import {
  InvalidStateError,
  NotFoundError,
  PayloadTooLargeError,
  RunConflictError,
  ValidationError,
} from "../../core/kernel/index.ts";
import { isForeignKeyViolation, violationConstraint } from "../../core/platform/index.ts";
import type { DecideInput, ResumeNodeInput, RunDetail, RunInputStaged, RunInputUpload, StartRun } from "./types.ts";
import { advanceLocked } from "./advance.ts";
import { assertRunnableGraph, nodeById, startNode } from "./graph-checks.ts";
import type { RunRuntime } from "./runtime.ts";
import { confirmationFromVerdict } from "./signals.ts";
import { ensureAbsolutePath, taskSpaceFor } from "./validate.ts";
import { ensureInputId } from "./inputs.ts";

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

const MAX_INTENT_BYTES = 262144;

function ensureIntent(intentMarkdown: string): void {
  if (intentMarkdown.trim() === "") {
    throw new ValidationError("intentMarkdown", "必须是非空字符串");
  }
  if (new TextEncoder().encode(intentMarkdown).byteLength > MAX_INTENT_BYTES) {
    throw new ValidationError("intentMarkdown", `不能超过 ${MAX_INTENT_BYTES} 字节`);
  }
}

async function resolveStartInputs(
  runtime: RunRuntime,
  clientId: string,
  inputs: { inputId: string }[] | undefined,
): Promise<{ inputId: string }[]> {
  const refs = (inputs ?? []).map((ref, index) => ({
    inputId: ensureInputId(ref.inputId, `inputs[${index}].inputId`),
  }));
  if (refs.length > runtime.deps.maxInputFiles) {
    throw new PayloadTooLargeError("run_input_count", runtime.deps.maxInputFiles, refs.length);
  }
  if (new Set(refs.map((ref) => ref.inputId)).size !== refs.length) {
    throw new ValidationError("inputs", "inputId 不能重复");
  }
  if (refs.length > 0) await runtime.ensureClientSupports(clientId);
  return refs;
}

/** 同一秒内重复启动时追加 `-2`、`-3`；路径一旦写入 run 即冻结。 */
async function resolveTaskSpacePath(
  runtime: RunRuntime,
  workspacePath: string,
  now: Date,
): Promise<string> {
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = taskSpaceFor(workspacePath, now, suffix === 1 ? undefined : suffix);
    const taken = await runtime.deps.db.one<{ found: number }>(
      "select 1 as found from workflow_run where task_space_path = $1 limit 1",
      [candidate],
    );
    if (taken === null) return candidate;
  }
  throw new ValidationError("workspacePath", "同一秒内启动次数过多，请稍后重试");
}

async function start(input: StartRun, runtime: RunRuntime, deps: CommandsDeps): Promise<RunDetail> {
  ensureIntent(input.intentMarkdown);
  const workflow = await runtime.deps.workflowRead.get(input.workflowId);
  const graph = workflow.graph;
  assertRunnableGraph(graph);
  await assertRunnableExperts(runtime, graph);
  const harness = await runtime.deps.harnessRead.get(input.harnessId);
  const clientId = harness.clientId;
  if (clientId === null) throw new ValidationError("harnessId", "节点未绑定客户端");
  if (!harness.enabled) throw new ValidationError("harnessId", "节点已停用");
  const inputRefs = await resolveStartInputs(runtime, clientId, input.inputs);
  const workspacePath = ensureAbsolutePath("workspacePath", input.workspacePath);
  const instance = await resolveInstance(runtime, clientId, workspacePath);
  const active = await runtime.store.findActiveByInstance(runtime.deps.db, instance.instanceId);
  if (active !== null) throw new RunConflictError(instance.instanceId);
  const runId = runtime.deps.ids.next();
  const startNodeValue = startNode(graph);
  if (startNodeValue === null) throw new ValidationError("graph.nodes", "缺少开始节点");
  const startExpert =
    startNodeValue.expertId === null
      ? null
      : await runtime.readExpertOrInvalid(startNodeValue.id, startNodeValue.expertId);
  const now = runtime.deps.clock.now();
  const taskSpacePath = await resolveTaskSpacePath(runtime, workspacePath, now);
  try {
    await runtime.deps.db.transaction(async (tx) => {
      await runtime.store.insertRun(tx, {
        id: runId,
        workflowId: input.workflowId,
        workflowName: workflow.name,
        workflowRevision: workflow.revision,
        graphSnapshot: graph,
        intentMarkdown: input.intentMarkdown,
        harnessId: input.harnessId,
        harnessName: harness.name,
        clientId,
        instanceId: instance.instanceId,
        workspacePath,
        taskSpacePath,
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
        expertName: startExpert?.name ?? null,
        state: "queued",
        now,
      });
      await runtime.store.setCurrentNode(tx, runId, startNodeValue.id, now);
      await runtime.bindForStart(tx, runId, inputRefs, now);
    });
  } catch (error) {
    // 启动窗口内工作流/Harness 被并发删除：外键兜底，映射为 404 而不是 500。
    if (isForeignKeyViolation(error)) {
      const constraint = violationConstraint(error);
      if (constraint === "workflow_run_workflow_id_fkey") {
        throw new NotFoundError("工作流", input.workflowId);
      }
      if (constraint === "workflow_run_harness_id_fkey") {
        throw new NotFoundError("Harness", input.harnessId);
      }
    }
    throw error;
  }
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
  const confirmation = confirmationFromVerdict(row.verdict);
  if (confirmation !== null) {
    // 确认点：pass/reject 都续跑同一 session，不结算节点、不推进。
    await runtime.withLock(run.id, async () => {
      const fresh = await runtime.loadRun(run.id);
      const freshRow = await runtime.store.findNode(runtime.deps.db, run.id, input.nodeId);
      if (freshRow === null || freshRow.state !== "waiting_confirm") {
        throw new InvalidStateError("节点不在 waiting_confirm");
      }
      const latest = confirmationFromVerdict(freshRow.verdict);
      if (latest === null) throw new InvalidStateError("节点不是确认点");
      const sessionId = freshRow.session_id;
      if (sessionId === null || sessionId === "") {
        throw new InvalidStateError("确认点缺少 session，无法续跑");
      }
      await runtime.dispatch(fresh, node, freshRow, {
        resumeSessionId: sessionId,
        confirmation: {
          question: latest.question,
          decision: input.decision,
          comment: input.comment,
          ...(latest.options === undefined ? {} : { options: latest.options }),
        },
      });
    });
    return deps.get(run.id);
  }
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

/** 人工续跑：同一 task 重开 attempt，run_node 回到 dispatched。 */
async function resumeNode(
  input: ResumeNodeInput,
  runtime: RunRuntime,
  deps: CommandsDeps,
): Promise<RunDetail> {
  return runtime.withLock(input.runId, async () => {
    const run = await runtime.loadRun(input.runId);
    const row = await runtime.store.findNode(runtime.deps.db, run.id, input.nodeId);
    if (row === null) throw new NotFoundError("run_node", `${run.id}/${input.nodeId}`);
    if (row.state === "dispatched") return deps.get(run.id);
    if (row.state !== "waiting_resume" || run.state !== "waiting_resume") {
      throw new InvalidStateError("node_not_waiting_resume");
    }
    if (row.task_id === null) throw new InvalidStateError("task_missing");
    const sessionId = row.session_id;
    if (sessionId === null || sessionId === "") throw new InvalidStateError("session_missing");

    const harnessId = run.harness_id;
    if (harnessId === null) throw new InvalidStateError("harness_missing");
    const harness = await runtime.deps.harnessRead.get(harnessId);
    if (!harness.enabled || harness.clientId !== run.client_id) {
      throw new InvalidStateError("instance_not_dispatchable");
    }
    if (!(await runtime.deps.instance.isDispatchable(run.instance_id, run.client_id))) {
      throw new InvalidStateError("instance_not_dispatchable");
    }

    await runtime.deps.scheduler.resumeTask(run.client_id, row.task_id, sessionId);
    const now = runtime.deps.clock.now();
    await runtime.deps.db.transaction(async (tx) => {
      await runtime.store.setNodeResumed(tx, {
        runId: run.id,
        nodeId: row.node_id,
        visit: row.visit,
        now,
      });
      await runtime.store.setRunProgress(tx, run.id, {
        state: "running",
        currentNodeId: row.node_id,
        now,
      });
    });
    return deps.get(run.id);
  });
}

async function cancel(runId: string, runtime: RunRuntime, deps: CommandsDeps, actor?: string): Promise<RunDetail> {  const run = await runtime.loadRun(runId);
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
    stageInput: (input: RunInputUpload): Promise<RunInputStaged> => runtime.stageInput(input),
    deleteStagedInput: (inputId: string): Promise<void> => runtime.deleteStagedInput(inputId),
    decide: (input: DecideInput) => decide(input, runtime, deps),
    resumeNode: (input: ResumeNodeInput) => resumeNode(input, runtime, deps),
    cancel: (runId: string, actor?: string) => cancel(runId, runtime, deps, actor),
  };
}
