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
export function createDispatchOps(core: RunCore): DispatchOps {
  const { deps, store, graphFor } = core;

  async function dispatch(
    run: RunRow,
    node: WorkflowNode,
    row: RunNodeRow,
    options: DispatchOptions = {},
  ): Promise<void> {
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
    const enqueued = await deps.scheduler.enqueue({
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
    });
    const firstTaskId = enqueued.taskIds[0];
    if (firstTaskId === undefined) {
      throw new ValidationError("taskIds", "调度器未返回任务 ID");
    }
    const now = deps.clock.now();
    await deps.db.transaction(async (tx) => {
      await store.setNodeDispatched(tx, {
        runId: run.id,
        nodeId: node.id,
        visit: row.visit,
        taskId: firstTaskId,
        now,
      });
      await store.setRunProgress(tx, run.id, { state: "running", currentNodeId: node.id, now });
    });
  }

  async function readExpertOrInvalid(
    nodeId: string,
    expertId: string,
  ): Promise<Awaited<ReturnType<RunCore["deps"]["expertRead"]["get"]>>> {
    try {
      return await deps.expertRead.get(expertId);
    } catch (error) {
      // 图里引用的专家不存在属于「图不可运行」，按启动校验错误返回 400。
      if (error instanceof NotFoundError) {
        throw new ValidationError(`graph.nodes.${nodeId}.expertId`, "专家不存在");
      }
      throw error;
    }
  }

  return { dispatch, readExpertOrInvalid };
}
