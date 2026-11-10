import { MAX_TASKS_PER_POLL } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import { envelope } from "./mappers.ts";
import type { SchedulerStore, TaskRow } from "./store.ts";
import type { ClientReport, DispatchDecision } from "./types.ts";

const NO_TASKS: DispatchDecision = {
  tasks: [],
  stop: false,
  cancelInstances: [],
  nextPollAfterMs: 0,
};

function pickByDigest(candidates: TaskRow[]): TaskRow[] {
  const first = candidates[0];
  if (first === undefined) return [];
  return candidates.filter((row) => row.skill_set_digest === first.skill_set_digest);
}

export type DispatchInput = {
  clientId: string;
  report: ClientReport;
  now: Date;
  store: SchedulerStore;
  db: Db;
  maxTasksPerPoll?: number;
  stopRequested: boolean;
  nodeDispatchable: boolean;
  cancelInstances: string[];
};

/** 一次派发裁决：未确认重发在前，新任务在后，总量受容量约束。 */
export async function decideDispatch(input: DispatchInput): Promise<DispatchDecision> {
  const cancelInstances = input.cancelInstances;
  if (input.stopRequested) {
    return { tasks: [], stop: true, cancelInstances, nextPollAfterMs: 0 };
  }
  if (!input.nodeDispatchable) {
    return { ...NO_TASKS, cancelInstances };
  }

  const limit = input.maxTasksPerPoll ?? MAX_TASKS_PER_POLL;
  const dispatched = await input.store.listDispatchedForClient(input.clientId);
  const running = new Set(input.report.running.map((item) => item.taskId));
  const finished = new Set(input.report.finished.map((item) => item.taskId));
  const resent = dispatched.filter((row) => !running.has(row.id) && !finished.has(row.id));

  const capacity = Math.max(0, Math.min(input.report.free, limit) - resent.length);
  const queued = await input.store.listQueuedForClient(input.clientId, input.now);
  const activeDigest = dispatched[0]?.skill_set_digest;
  const fresh = (activeDigest === undefined
    ? pickByDigest(queued)
    : queued.filter((row) => row.skill_set_digest === activeDigest)
  ).slice(0, capacity);

  if (fresh.length > 0) {
    await input.db.transaction((tx) =>
      input.store.markDispatched(tx, fresh.map((row) => row.id), input.clientId, input.now),
    );
  }
  if (resent.length > 0) {
    await input.db.transaction((tx) =>
      input.store.markResent(tx, resent.map((row) => row.id), input.clientId, input.now),
    );
  }

  const picked = [...resent, ...fresh].slice(0, Math.min(input.report.free, limit));
  return {
    tasks: picked.map(envelope),
    stop: false,
    cancelInstances,
    nextPollAfterMs: 0,
  };
}
