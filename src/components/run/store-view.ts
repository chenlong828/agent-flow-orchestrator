import { toIso, toIsoOrNull } from "../../core/kernel/index.ts";
import type { RunNodeRow, RunNodeView, RunRow, RunSummary } from "./types.ts";

function parseJson<T>(value: T | string | null): T | null {
  if (value === null) return null;
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

/** 列表摘要只含契约字段；workspace/task-space 等详情字段在详情响应里补。 */
export function toRunSummary(row: RunRow): RunSummary {
  return {
    runId: row.id,
    workflowId: row.workflow_id,
    workflowRevision: row.workflow_revision,
    harnessId: row.harness_id,
    clientId: row.client_id,
    instanceId: row.instance_id,
    state: row.state,
    outcome: row.outcome,
    currentNodeId: row.current_node_id,
    archiveState: row.archive_state,
    createdAt: toIso(row.created_at),
    startedAt: toIsoOrNull(row.started_at),
    finishedAt: toIsoOrNull(row.finished_at),
  };
}

export function toNodeView(row: RunNodeRow): RunNodeView {
  return {
    nodeId: row.node_id,
    nodeType: row.node_type,
    visit: row.visit,
    state: row.state,
    taskId: row.task_id,
    verdict: parseJson(row.verdict),
    message: row.message ?? "",
    error: parseJson(row.error),
    dispatchedAt: toIsoOrNull(row.dispatched_at),
    finishedAt: toIsoOrNull(row.finished_at),
  };
}
