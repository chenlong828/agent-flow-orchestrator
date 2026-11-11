import {
  TaskNotFoundError,
  ValidationError,
} from "../../core/kernel/index.ts";
import { createCancelHandler } from "./control.ts";
import type { SchedulerDeps } from "./deps.ts";
import { createEnqueueHandler } from "./enqueue.ts";
import { snapshot } from "./mappers.ts";
import { createPollHandler } from "./poll.ts";
import { createPresenceTracker } from "./presence.ts";
import { createResultHandler } from "./result.ts";
import { createSchedulerStore } from "./store.ts";
import { createWaiters } from "./waiters.ts";
import { ensureClientId, ensureUuid } from "./validate.ts";
import type {
  SchedulerPresenceRead,
  SchedulerService,
  TaskSnapshot,
} from "./types.ts";

export type { SchedulerDeps } from "./deps.ts";

export type SchedulerHandle = SchedulerService & SchedulerPresenceRead;

export function createScheduler(deps: SchedulerDeps): SchedulerHandle {
  const store = createSchedulerStore(deps.db);
  const waiters = createWaiters();
  const tracker = createPresenceTracker(waiters, deps.clock);

  return {
    enqueue: createEnqueueHandler(deps, store, waiters.notifyAll),
    poll: createPollHandler(deps, store, tracker, waiters),
    acceptResult: createResultHandler(deps, store, waiters.notify),
    requestStop: async (clientId) => tracker.requestStop(ensureClientId(clientId)),
    cancelInstances: createCancelHandler(deps, store, waiters.notifyAll),
    inspect: async (taskId): Promise<TaskSnapshot> => {
      const row = await store.findById(ensureUuid(taskId, "taskId"));
      if (row === null) throw new TaskNotFoundError(taskId);
      return snapshot(row);
    },
    presence: async (clientIds) => {
      if (!Array.isArray(clientIds)) throw new ValidationError("clientIds", "必须是数组");
      return tracker.views(clientIds);
    },
  };
}
