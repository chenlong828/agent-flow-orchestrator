import { CLIENT_SILENT_MS, RESULT_GRACE_MS } from "../../core/kernel/index.ts";
import type { SchedulerDeps } from "./deps.ts";
import { decideDispatch } from "./dispatch.ts";
import type { PresenceTracker } from "./presence.ts";
import { reconcileUnreported } from "./reconcile.ts";
import type { SchedulerStore } from "./store.ts";
import { ensureClientId, validateReport } from "./validate.ts";
import type { Waiters } from "./waiters.ts";
import type { ClientReport, DispatchDecision, PollOptions } from "./types.ts";

export function createPollHandler(
  deps: SchedulerDeps,
  store: SchedulerStore,
  tracker: PresenceTracker,
  waiters: Waiters,
) {
  const silentMs = deps.silentMs ?? CLIENT_SILENT_MS;
  const resultGraceMs = deps.resultGraceMs ?? RESULT_GRACE_MS;

  async function decideOnce(id: string, report: ClientReport): Promise<DispatchDecision> {
    const targets = await store.cancelTargets(id);
    return decideDispatch({
      clientId: id,
      report,
      now: deps.clock.now(),
      store,
      db: deps.db,
      maxTasksPerPoll: deps.maxTasksPerPoll,
      stopRequested: tracker.get(id)?.stopRequested === true,
      nodeDispatchable: await deps.node.isDispatchable(id),
      cancelInstances: [...new Set(targets.map((item) => item.instanceId))],
    });
  }

  async function reconcile(now: Date): Promise<void> {
    await reconcileUnreported({
      now,
      store,
      db: deps.db,
      presenceOf: (client) => tracker.get(client),
      silentMs,
      resultGraceMs,
      maxAttempts: deps.maxAttempts,
      retryDelayMs: deps.retryDelayMs,
    });
  }

  return async function poll(
    clientId: string,
    report: ClientReport,
    options: PollOptions,
  ): Promise<DispatchDecision> {
    const id = ensureClientId(clientId);
    validateReport(report);
    const holdMs = Number.isFinite(options?.holdMs) ? Math.max(0, options.holdMs) : 0;

    return waiters.singleFlight(id, async () => {
      tracker.touch(id, report.free, report.running.length, options.capabilities ?? []);
      await reconcile(deps.clock.now());
      const first = await decideOnce(id, report);
      if (first.tasks.length > 0 || first.stop || holdMs === 0) return first;
      await waiters.awaitWake(id, holdMs);
      tracker.markPolled(id);
      return decideOnce(id, report);
    });
  };
}
