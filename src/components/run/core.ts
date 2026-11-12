import { RunNotFoundError } from "../../core/kernel/index.ts";
import type { WorkflowGraph } from "../workflow/index.ts";
import { graphOf } from "./graph-checks.ts";
import { createRunStore, type RunStore } from "./store.ts";
import type { RunDeps } from "./deps.ts";
import type { ErrorView } from "./internal.ts";
import type { RunRow } from "./types.ts";

export type RunCore = {
  deps: RunDeps;
  store: RunStore;
  withLock<T>(runId: string, fn: () => Promise<T>): Promise<T>;
  loadRun(runId: string): Promise<RunRow>;
  graphFor(run: RunRow): WorkflowGraph;
  finish(
    runId: string,
    outcome: "succeeded" | "failed" | "cancelled",
    error: ErrorView,
    finalMessage: string | null,
  ): Promise<void>;
  setWaitingConfirm(runId: string): Promise<void>;
};

/** 共享核心：存储、按 run 串行锁、加载与终态写入。 */
export function createCore(deps: RunDeps): RunCore {
  const store = createRunStore();
  const locks = new Map<string, Promise<unknown>>();

  async function withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(runId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    locks.set(runId, current);
    try {
      return await current;
    } finally {
      if (locks.get(runId) === current) locks.delete(runId);
    }
  }

  async function loadRun(runId: string): Promise<RunRow> {
    const run = await store.findRun(deps.db, runId);
    if (run === null) throw new RunNotFoundError(runId);
    return run;
  }

  function graphFor(run: RunRow): WorkflowGraph {
    return graphOf(run.graph_snapshot);
  }

  async function finish(
    runId: string,
    outcome: "succeeded" | "failed" | "cancelled",
    error: ErrorView,
    finalMessage: string | null,
  ): Promise<void> {
    const now = deps.clock.now();
    await deps.db.transaction((tx) =>
      store.finishRun(tx, runId, { outcome, error, finalMessage, now }),
    );
  }

  async function setWaitingConfirm(runId: string): Promise<void> {
    const run = await loadRun(runId);
    if (run.state === "waiting_confirm") return;
    const now = deps.clock.now();
    await deps.db.transaction((tx) =>
      store.setRunProgress(tx, run.id, {
        state: "waiting_confirm",
        currentNodeId: run.current_node_id,
        now,
      }),
    );
  }

  return { deps, store, withLock, loadRun, graphFor, finish, setWaitingConfirm };
}
