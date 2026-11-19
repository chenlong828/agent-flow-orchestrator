import { NotFoundError, ValidationError } from "../../core/kernel/index.ts";
import type { WorkflowNode } from "../workflow/index.ts";
import type { RunCore } from "./core.ts";
import { startNode } from "./graph-checks.ts";
import { resolveEntry } from "./entry.ts";
import { composeNodePrompt, type PromptConfirmation } from "./prompt.ts";
import { signalForNode } from "./signals.ts";
import type { RunNodeRow, RunRow } from "./types.ts";

export type DispatchOptions = {
  resumeSessionId?: string;
  confirmation?: PromptConfirmation;
};

export type DispatchOps = {
  dispatch(run: RunRow, node: WorkflowNode, row: RunNodeRow, options?: DispatchOptions): Promise<void>;
  readExpertOrInvalid(
    nodeId: string,
    expertId: string,
  ): Promise<Awaited<ReturnType<RunCore["deps"]["expertRead"]["get"]>>>;
};

/** 派发原语：组装 prompt、入队并回填 taskId；专家缺失按启动校验错误处理。 */
async function dispatchNode(
  core: RunCore,
  run: RunRow,
  node: WorkflowNode,
  row: RunNodeRow,
  options: DispatchOptions = {},
): Promise<void> {
  const { deps, store, graphFor } = core;
  if (node.expertId === null) {
    throw new ValidationError(`graph.nodes.${node.id}.expertId`, "执行节点必须绑定专家");
  }
  const expert = await deps.expertRead.get(node.expertId);
  const start = startNode(graphFor(run));
  const entry = await resolveEntry(store, deps.db, graphFor(run), run, row);
  const prompt = composeNodePrompt({
    node,
    expert: {
      name: expert.name,
      role: expert.role,
      persona: expert.persona,
      duty: expert.duty,
      verifyOrder: expert.verifyOrder,
      notes: expert.notes,
    },
    taskSpacePath: run.task_space_path,
    ...(entry === undefined ? {} : { entry }),
    ...(start?.id === node.id ? { intentMarkdown: run.intent_markdown } : {}),
    ...(options.confirmation === undefined ? {} : { confirmation: options.confirmation }),
  });
  const resultSignal = signalForNode(node.type);
  const now = deps.clock.now();
  let clientId: string | undefined;
  // 任务行与 run_node.task_id 必须同一次提交：否则被唤醒的 poll 可能读到尚无 task_id 的节点，
  // 导致下发的任务缺 runId（观测面与运行文件面都依赖它）。
  await deps.db.transaction(async (tx) => {
    const enqueued = await deps.scheduler.enqueue(
      {
        tasks: [
          {
            instanceId: run.instance_id,
            nodeId: node.id,
            prompt,
            taskSpacePath: run.task_space_path,
            timeoutMs: deps.defaultTimeoutMs,
            skillIds: expert.skillIds,
            ...(resultSignal === undefined ? {} : { resultSignal }),
            ...(options.resumeSessionId === undefined ? {} : { resumeSessionId: options.resumeSessionId }),
          },
        ],
      },
      { tx },
    );
    const firstTaskId = enqueued.taskIds[0];
    if (firstTaskId === undefined) {
      throw new ValidationError("taskIds", "调度器未返回任务 ID");
    }
    clientId = enqueued.clientIds[0];
    await store.setNodeDispatched(tx, {
      runId: run.id,
      nodeId: node.id,
      visit: row.visit,
      taskId: firstTaskId,
      now,
    });
    await store.setRunProgress(tx, run.id, { state: "running", currentNodeId: node.id, now });
  });
  if (clientId !== undefined) deps.scheduler.notifyClient(clientId);
}

async function readExpertOrInvalid(
  core: RunCore,
  nodeId: string,
  expertId: string,
): Promise<Awaited<ReturnType<RunCore["deps"]["expertRead"]["get"]>>> {
  try {
    return await core.deps.expertRead.get(expertId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new ValidationError(`graph.nodes.${nodeId}.expertId`, "专家不存在");
    }
    throw error;
  }
}

export function createDispatchOps(core: RunCore): DispatchOps {
  return {
    dispatch: (run, node, row, options) => dispatchNode(core, run, node, row, options),
    readExpertOrInvalid: (nodeId, expertId) => readExpertOrInvalid(core, nodeId, expertId),
  };
}
