import type { Db } from "../../core/platform/index.ts";
import type { Presence } from "./presence.ts";
import type { SchedulerStore } from "./store.ts";

export type ReconcileInput = {
  now: Date;
  store: SchedulerStore;
  db: Db;
  presenceOf: (clientId: string) => Presence | undefined;
  silentMs: number;
  resultGraceMs: number;
  maxAttempts: number;
  retryDelayMs: number;
};

/** 未回报重派：静默或超过 timeoutMs + resultGraceMs，且从未收到结果。 */
export async function reconcileUnreported(input: ReconcileInput): Promise<void> {
  const rows = await input.store.listDispatched();
  for (const row of rows) {
    const seen = input.presenceOf(row.client_id);
    const silent =
      seen?.lastPollAt != null &&
      input.now.getTime() - seen.lastPollAt.getTime() > input.silentMs;
    const dispatchedAt =
      row.dispatched_at === null ? null : new Date(row.dispatched_at).getTime();
    const expired =
      dispatchedAt !== null &&
      input.now.getTime() - dispatchedAt > row.timeout_ms + input.resultGraceMs;
    if (!silent && !expired) continue;

    await input.db.transaction(async (tx) => {
      if (row.attempt >= input.maxAttempts) {
        await input.store.settle(tx, {
          id: row.id,
          outcome: "failed",
          error: {
            class: "scheduler",
            code: "dispatch_attempts_exhausted",
            message: "任务在未回报状态下的重派次数已用尽",
          },
          now: input.now,
        });
        return;
      }
      const notBefore = new Date(input.now.getTime() + input.retryDelayMs);
      await input.store.requeue(tx, row.id, input.now, expired ? notBefore : input.now);
    });
  }
}
