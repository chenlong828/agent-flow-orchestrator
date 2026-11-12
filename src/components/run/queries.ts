import { normalizePageQuery } from "../../core/kernel/index.ts";
import type { Page } from "../../core/kernel/index.ts";
import { advanceLocked } from "./advance.ts";
import { nodeById } from "./graph-checks.ts";
import type { ErrorView } from "./internal.ts";
import type { RunDetail, RunQuery, RunRow, RunSummary } from "./types.ts";
import type { RunRuntime } from "./runtime.ts";
import { applyResult } from "./results.ts";
import { toNodeView, toRunSummary } from "./store.ts";

function errorView(value: unknown): ErrorView {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof parsed !== "object" || parsed === null) return null;
  const code = (parsed as { code?: unknown }).code;
  const message = (parsed as { message?: unknown }).message;
  return {
    code: typeof code === "string" ? code : "internal",
    message: typeof message === "string" ? message : "",
  };
}

function detailOf(run: RunRow, nodes: Parameters<typeof toNodeView>[0][]): RunDetail {
  return {
    ...toRunSummary(run),
    workspacePath: run.workspace_path,
    taskSpacePath: run.task_space_path,
    autoConfirm: run.auto_confirm,
    finalMessage: run.final_message,
    error: errorView(run.error),
    nodes: nodes.map(toNodeView),
  };
}

async function resumePending(runtime: RunRuntime): Promise<{ resumed: number }> {
  const runs = await runtime.store.listActive(runtime.deps.db);
  let resumed = 0;
  for (const run of runs) {
    if (run.current_node_id === null) continue;
    const row = await runtime.store.findNode(runtime.deps.db, run.id, run.current_node_id);
    if (row === null) continue;
    if (row.state === "waiting_confirm") continue;
    if (row.state === "dispatched" && row.task_id !== null) {
      const snapshot = await runtime.deps.scheduler.inspect(row.task_id);
      if (snapshot.state !== "done") continue;
      const status =
        snapshot.outcome === "succeeded"
          ? "succeeded"
          : snapshot.outcome === "cancelled"
            ? "cancelled"
            : snapshot.outcome === "timeout"
              ? "timeout"
              : "failed";
      const node = nodeById(runtime.graphFor(run), row.node_id);
      if (node === null) continue;
      const fresh = await runtime.loadRun(run.id);
      await applyResult(runtime, fresh, row, {
        status,
        message: "",
        error:
          snapshot.outcome === "succeeded" || snapshot.outcome === "cancelled"
            ? null
            : { code: "recovered", message: "重启对账补结算" },
      });
      if ((await runtime.loadRun(run.id)).state !== "done") await advanceLocked(runtime, run.id);
      resumed += 1;
      continue;
    }
    await advanceLocked(runtime, run.id);
    resumed += 1;
  }
  return { resumed };
}

export function createQueries(runtime: RunRuntime) {
  return {
    async get(runId: string): Promise<RunDetail> {
      const run = await runtime.loadRun(runId);
      return detailOf(run, await runtime.store.listNodes(runtime.deps.db, run.id));
    },

    async list(query: RunQuery): Promise<Page<RunSummary>> {
      const page = normalizePageQuery(query.page.limit, query.page.offset);
      const { rows, total } = await runtime.store.listRuns(runtime.deps.db, {
        ...(query.workflowId === undefined ? {} : { workflowId: query.workflowId }),
        ...(query.state === undefined ? {} : { state: query.state }),
        limit: page.limit,
        offset: page.offset,
      });
      return { items: rows.map(toRunSummary), total, limit: page.limit, offset: page.offset };
    },

    resumePending: () => resumePending(runtime),
  };
}
