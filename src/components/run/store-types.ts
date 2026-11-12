import type { RunArtifactKind, RunNodeState, RunRow, RunState } from "./types.ts";

export const RUN_COLUMNS = `
  id, workflow_id, workflow_revision, graph_snapshot, intent_markdown, harness_id,
  client_id, instance_id, workspace_path, task_space_path, auto_confirm, state,
  outcome, current_node_id, result->>'finalMessage' as final_message,
  result->'error' as error, archive_state, created_at as started_at,
  finished_at, created_at, updated_at`;

export const NODE_COLUMNS = `
  run_id, node_id, visit, node_type, expert_id, state, task_id, verdict,
  message, error, dispatched_at, finished_at`;

export type NewRunRow = {
  id: string;
  workflowId: string;
  workflowRevision: number;
  graphSnapshot: unknown;
  intentMarkdown: string;
  harnessId: string;
  clientId: string;
  instanceId: string;
  workspacePath: string;
  taskSpacePath: string;
  autoConfirm: boolean;
  now: Date;
  actor: string | null;
};

export type NewNodeRow = {
  runId: string;
  nodeId: string;
  visit: number;
  nodeType: string;
  expertId: string | null;
  state: RunNodeState;
  now: Date;
};

export type NewArtifactRow = {
  id: string;
  runId: string;
  nodeId: string | null;
  visit: number | null;
  attempt: number | null;
  kind: RunArtifactKind;
  storeKey: string;
  sizeBytes: number;
  sha256: string;
  now: Date;
};

export type ArtifactQuery = {
  runId: string;
  kind: RunArtifactKind;
  nodeId?: string;
  visit?: number;
  attempt?: number;
};

export type ArchiveRow = {
  id: string;
  instance_id: string;
  workspace_path: string;
  task_space_path: string;
};

export type RunListQuery = {
  workflowId?: string;
  state?: RunState;
  limit: number;
  offset: number;
};

export type RunRowList = {
  rows: RunRow[];
  total: number;
};
