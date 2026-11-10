import { ValidationError } from "../../core/kernel/index.ts";
import type { SchedulerDeps } from "./deps.ts";
import type { SchedulerStore } from "./store.ts";
import { ensureUuid } from "./validate.ts";

export function createCancelHandler(
  deps: SchedulerDeps,
  store: SchedulerStore,
  notifyAll: () => void,
) {
  return async function cancelInstances(instanceIds: string[]): Promise<{ requested: number }> {
    if (!Array.isArray(instanceIds) || instanceIds.length === 0) {
      throw new ValidationError("instanceIds", "必须是非空 UUID 数组");
    }
    const ids = [...new Set(instanceIds.map((id) => ensureUuid(id, "instanceIds")))];
    const now = deps.clock.now();
    const requested = await deps.db.transaction(async (tx) => {
      const cancelled = await store.cancelQueuedByInstances(tx, ids, now);
      const marked = await store.requestCancelDispatched(tx, ids, now);
      return cancelled + marked;
    });
    notifyAll();
    return { requested };
  };
}
