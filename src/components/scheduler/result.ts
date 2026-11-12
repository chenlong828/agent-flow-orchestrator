import { TaskNotFoundError, ValidationError } from "../../core/kernel/index.ts";
import type { SchedulerDeps } from "./deps.ts";
import type { SchedulerStore } from "./store.ts";
import { ensureClientId, ensureUuid, toTaskError } from "./validate.ts";
import type { ResultAck, TaskError, TaskOutcome, TaskResult } from "./types.ts";

function outcomeOf(result: TaskResult): TaskOutcome {
  const statuses = ["succeeded", "failed", "cancelled", "timeout"] as const;
  if (!statuses.includes(result.status)) {
    throw new ValidationError("status", "不在闭集内");
  }
  if (result.status === "succeeded" && result.error != null) {
    throw new ValidationError("error", "succeeded 时必须是 null");
  }
  if (result.status !== "succeeded" && result.error == null) {
    throw new ValidationError("error", "失败/超时/取消时必须提供 error");
  }
  if (result.status === "succeeded") return "succeeded";
  if (result.status === "cancelled") return "cancelled";
  return "failed";
}

export function createResultHandler(
  deps: SchedulerDeps,
  store: SchedulerStore,
  notify: (clientId: string) => void,
) {
  return async function acceptResult(clientId: string, result: TaskResult): Promise<ResultAck> {
    const client = ensureClientId(clientId);
    const taskId = ensureUuid(result?.taskId, "taskId");
    const outcome = outcomeOf(result);
    const error: TaskError | null = result.error == null ? null : toTaskError(result.error);

    const row = await store.findById(taskId);
    if (row === null || row.client_id !== client) throw new TaskNotFoundError(taskId);
    if (row.state === "done") return { taskId, accepted: false };

    const now = deps.clock.now();
    await deps.db.transaction((tx) => store.settle(tx, { id: taskId, outcome, error, now }));

    // 工作区类失败不再摘除实例：失败即终态、不自动重派，下一次 run 直接重跑并在节点上暴露同一错误。
    // 同一实例的其余排队任务仍需结算，避免同批 fan-out 逐个失败。
    if (result.status === "failed" && error?.class === "workspace") {
      await deps.db.transaction((tx) => store.settleQueuedByInstance(tx, row.instance_id, now));
    }
    notify(client);
    return { taskId, accepted: true };
  };
}
