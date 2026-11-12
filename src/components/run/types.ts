import type { Page, PageQuery } from "../../core/kernel/index.ts";
import type { TaskResult } from "../scheduler/types.ts";
import type { NodeType, WorkflowGraph } from "../workflow/index.ts";

export type RunState = "created" | "running" | "waiting_confirm" | "done";
export type RunOutcome = "succeeded" | "failed" | "cancelled";
export type RunNodeState =
  | "queued"
  | "dispatched"
  | "waiting_confirm"
  | "succeeded"
  | "rejected"
  | "failed";
export type ArchiveState = "none" | "pending" | "stored" | "failed";
export type RunArtifactKind = "session_log" | "archive";

export type StartRun = {
  workflowId: string;
  harnessId: string;
  workspacePath: string;
  intentMarkdown: string;
  autoConfirm?: boolean;
  actor?: string;
};

export type RunNodeView = {
  nodeId: string;
  nodeType: NodeType;
  visit: number;
  state: RunNodeState;
  taskId: string | null;
  verdict: Record<string, unknown> | null;
  message: string;
  error: { code: string; message: string } | null;
  dispatchedAt: string | null;
  finishedAt: string | null;
};

export type RunDetail = {
  runId: string;
  workflowId: string;
  workflowRevision: number;
  harnessId: string;
  clientId: string;
  instanceId: string;
  workspacePath: string;
  taskSpacePath: string;
  autoConfirm: boolean;
  state: RunState;
  outcome: RunOutcome | null;
  currentNodeId: string | null;
  archiveState: ArchiveState;
  nodes: RunNodeView[];
  finalMessage: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type RunSummary = Omit<RunDetail, "nodes" | "finalMessage">;

export type RunQuery = { workflowId?: string; state?: RunState; page: PageQuery };

export type ArchiveRequest = {
  runId: string;
  instanceId: string;
  workspacePath: string;
  taskSpacePath: string;
};

export type SessionLogInput = {
  clientId: string;
  taskId: string;
  attempt: number;
  bytes: Uint8Array;
  sha256: string;
};

export type ArchiveInput = {
  clientId: string;
  runId: string;
  bytes: Uint8Array;
  sha256: string;
};

export type StoredState = "created" | "replaced" | "unchanged";

export type DecideInput = {
  runId: string;
  nodeId: string;
  decision: "pass" | "reject";
  comment?: string;
  actor?: string;
};

export type RunService = {
  start(input: StartRun): Promise<RunDetail>;
  advance(runId: string): Promise<void>;
  handleTaskResult(clientId: string, result: TaskResult): Promise<{ taskId: string; accepted: boolean }>;
  attachSessionLog(input: SessionLogInput): Promise<{ stored: StoredState }>;
  storeArchive(input: ArchiveInput): Promise<{ stored: StoredState }>;
  archiveRequestsFor(clientId: string): Promise<ArchiveRequest[]>;
  ackArchived(clientId: string, runIds: string[]): Promise<void>;
  decide(input: DecideInput): Promise<RunDetail>;
  cancel(runId: string, actor?: string): Promise<RunDetail>;
  get(runId: string): Promise<RunDetail>;
  list(query: RunQuery): Promise<Page<RunSummary>>;
  readSessionLog(input: {
    runId: string;
    nodeId: string;
    visit?: number;
    attempt?: number;
  }): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes: number } | null>;
  resumePending(): Promise<{ resumed: number }>;
};

export type RunRow = {
  id: string;
  workflow_id: string;
  workflow_revision: number;
  graph_snapshot: WorkflowGraph | string;
  intent_markdown: string;
  harness_id: string;
  client_id: string;
  instance_id: string;
  workspace_path: string;
  task_space_path: string;
  auto_confirm: boolean;
  state: RunState;
  outcome: RunOutcome | null;
  current_node_id: string | null;
  final_message: string | null;
  error: { code: string; message: string } | string | null;
  archive_state: ArchiveState;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type RunNodeRow = {
  run_id: string;
  node_id: string;
  visit: number;
  node_type: NodeType;
  expert_id: string | null;
  state: RunNodeState;
  task_id: string | null;
  verdict: Record<string, unknown> | string | null;
  message: string | null;
  error: { code: string; message: string } | string | null;
  dispatched_at: Date | string | null;
  finished_at: Date | string | null;
};

export type RunArtifactRow = {
  id: string;
  run_id: string;
  node_id: string | null;
  visit: number | null;
  attempt: number | null;
  kind: RunArtifactKind;
  store_key: string;
  size_bytes: number;
  sha256: string;
  created_at: Date | string;
};
