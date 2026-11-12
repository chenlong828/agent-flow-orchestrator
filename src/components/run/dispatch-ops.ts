import { NotFoundError, ValidationError } from "../../core/kernel/index.ts";
import type { WorkflowNode } from "../workflow/index.ts";
import type { RunCore } from "./core.ts";
import { startNode } from "./graph-checks.ts";
import { composeNodePrompt } from "./prompt.ts";
import type { RunNodeRow, RunRow } from "./types.ts";

export type DispatchOps = {
  dispatch(run: RunRow, node: WorkflowNode, row: RunNodeRow): Promise<void>;
  readExpertOrInvalid(
    nodeId: string,
    expertId: string,
  ): Promise<Awaited<ReturnType<RunCore["deps"]["expertRead"]["get"]>>>;
};

/** 派发原语：组装 prompt、入队并回填 taskId；专家缺失按启动校验错误处理。 */
export function createDispatchOps(core: RunCore): DispatchOps {
  const { deps, store, graphFor } = core;

  async function dispatch(run: RunRow, node: WorkflowNode, row: RunNodeRow): Promise<void> {
    if (node.expertId === null) {
      throw new ValidationError(`graph.nodes.${node.id}.expertId`, "执行节点必须绑定专家");
    }
    const expert = await deps.expertRead.get(node.expertId);
    const workflow = await deps.workflowRead.get(run.workflow_id);
    const start = startNode(graphFor(run));
    const prompt = composeNodePrompt({
      workflowName: workflow.name,
      node,
      expertName: expert.name,
      taskSpacePath: run.task_space_path,
      ...(start?.id === node.id ? { intentMarkdown: run.intent_markdown } : {}),
    });
    const enqueued = await deps.scheduler.enqueue({
      tasks: [
        {
          instanceId: run.instance_id,
          nodeId: node.id,
          prompt,
          taskSpacePath: run.task_space_path,
          timeoutMs: deps.defaultTimeoutMs,
          skillIds: expert.skillIds,
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
