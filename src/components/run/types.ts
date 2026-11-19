import type { Page, PageQuery } from "../../core/kernel/index.ts";
import type { TaskResult } from "../scheduler/index.ts";
import type { NodeType, WorkflowGraph } from "../workflow/index.ts";

export type RunState = "created" | "running" | "waiting_confirm" | "waiting_resume" | "done";
export type RunOutcome = "succeeded" | "failed" | "cancelled";
export type RunNodeState =
  | "queued"
  | "dispatched"
  | "waiting_confirm"
  | "waiting_resume"
  | "succeeded"
  | "rejected"
  | "failed";
export type ArchiveState = "none" | "pending" | "stored" | "failed";
export type RunArtifactKind = "session_log" | "archive";
export type RunInputMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export type RunInputState = "staged" | "bound";

/** 回退进入原因指针：只记「哪一行的驳回」，理由正文仍以被驳回行的 verdict 为准。 */
export type EnterReason =
  | { kind: "review_fail"; from: string; fromVisit: number }
  | { kind: "confirm_reject"; from: string; fromVisit: number };

export type StartRun = {
  workflowId: string;
  harnessId: string;
  workspacePath: string;
  intentMarkdown: string;
  autoConfirm?: boolean;
  /** 暂存初始资料；缺省/空数组等价于不带图片。顺序即 position。 */
  inputs?: { inputId: string }[];
  actor: string | null;
};

export type RunInputUpload = {
  name: string;
  mediaType?: string;
  bytes: Uint8Array;
};

export type RunInputView = {
  inputId: string;
  name: string;
  mediaType: RunInputMediaType;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
};

export type RunInputStaged = RunInputView;

export type ExecutorRunInputRef = RunInputView & {
  downloadPath: string;
};

export type RunInputContent = {
  stream: ReadableStream<Uint8Array>;
  sizeBytes: number;
  mediaType: RunInputMediaType;
  sha256: string;
  name: string;
};

export type RunNodeView = {
  nodeId: string;
  nodeType: NodeType;
  visit: number;
  state: RunNodeState;
  taskId: string | null;
  verdict: Record<string, unknown> | null;
  enterReason: EnterReason | null;
  message: string;
  error: { code: string; message: string } | null;
  /** 启动时冻结的专家名；confirm 节点为 null。 */
  expertName: string | null;
  dispatchedAt: string | null;
  finishedAt: string | null;
};

export type RunSummary = {
  runId: string;
  /** 启动时工作流 ID；工作流可被删除，此 ID 仍保留用于筛选与追溯。 */
  workflowId: string;
  workflowName: string;
  workflowRevision: number;
  /** 启动时 Harness ID；Harness 可被删除，此 ID 仍保留。 */
  harnessId: string;
  harnessName: string;
  clientId: string;
  instanceId: string;
  state: RunState;
  outcome: RunOutcome | null;
  currentNodeId: string | null;
  archiveState: ArchiveState;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type RunDetail = RunSummary & {
  /** 启动时冻结的工作流图；工作流删除后仍可展示。 */
  graph: WorkflowGraph;
  workspacePath: string;
  taskSpacePath: string;
  autoConfirm: boolean;
  finalMessage: string | null;
  error: { code: string; message: string } | null;
  nodes: RunNodeView[];
};

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
  comment: string | null;
  actor: string | null;
};

export type ResumeNodeInput = {
  runId: string;
  nodeId: string;
  actor: string | null;
};


export type RunFileRoot = "task-space" | "workspace";

export type RunFileEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  sizeBytes: number | null;
  modifiedAt: string;
  hidden: boolean;
  previewable: boolean;
  contentType: string | null;
  language: string | null;
};

export type RunFileListing = {
  runId: string;
  root: RunFileRoot;
  path: string;
  entries: RunFileEntry[];
  truncated: boolean;
  fetchedAt: string;
};

export type RunFileContent = {
  runId: string;
  root: RunFileRoot;
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  contentType: string;
  language: string | null;
  content: string | null;
  truncated: boolean;
  reason: "binary" | "too_large" | null;
  fetchedAt: string;
};

export type RunSessionView = {
  runId: string;
  nodeId: string;
  visit: number;
  status: string;
  cwd: string;
  startedAt: string;
  finishedAt: string | null;
  eventCount: number;
  archive: { status: string; sizeBytes: number | null; sha256: string | null };
};

export type RunSessionEvent = {
  seq: number;
  ts: string;
  kind: string;
  event: string;
  message?: string;
  data?: Record<string, unknown>;
};

export type RunSessionEventPage = {
  items: RunSessionEvent[];
  nextCursor?: string;
  truncatedBefore?: number;
};

export type RunService = {
  start(input: StartRun): Promise<RunDetail>;
  /** 暂存一张图片；返回 inputId。 */
  stageInput(input: RunInputUpload): Promise<RunInputStaged>;
  /** 删除尚未绑定的暂存项；已绑定抛 InvalidStateError。 */
  deleteStagedInput(inputId: string): Promise<void>;
  listInputs(runId: string): Promise<RunInputView[]>;
  readInput(runId: string, inputId: string): Promise<RunInputContent>;
  /** 执行面：校验 run 属于该 client。 */
  listExecutorInputs(clientId: string, runId: string): Promise<ExecutorRunInputRef[]>;
  readExecutorInput(clientId: string, runId: string, inputId: string): Promise<RunInputContent>;
  advance(runId: string): Promise<void>;
  handleTaskResult(clientId: string, result: TaskResult): Promise<{ taskId: string; accepted: boolean }>;
  attachSessionLog(input: SessionLogInput): Promise<{ stored: StoredState }>;
  storeArchive(input: ArchiveInput): Promise<{ stored: StoredState }>;
  archiveRequestsFor(clientId: string): Promise<ArchiveRequest[]>;
  ackArchived(clientId: string, runIds: string[]): Promise<void>;
  decide(input: DecideInput): Promise<RunDetail>;
  resumeNode(input: ResumeNodeInput): Promise<RunDetail>;
  cancel(runId: string, actor?: string): Promise<RunDetail>;
  get(runId: string): Promise<RunDetail>;
  list(query: RunQuery): Promise<Page<RunSummary>>;
  readSessionLog(input: {
    runId: string;
    nodeId: string;
    visit?: number;
    attempt?: number;
  }): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes: number; sha256: string } | null>;
  resumePending(): Promise<{ resumed: number }>;
  listFiles(input: { runId: string; root: RunFileRoot; path: string }): Promise<RunFileListing>;
  readFile(input: { runId: string; root: RunFileRoot; path: string }): Promise<RunFileContent>;
  getSession(input: { runId: string; nodeId: string; visit?: number }): Promise<RunSessionView>;
  listSessionEvents(input: {
    runId: string;
    nodeId: string;
    visit?: number;
    cursor?: string;
    limit?: number;
  }): Promise<RunSessionEventPage>;
  openSessionEvents(input: {
    runId: string;
    nodeId: string;
    visit?: number;
    lastEventId?: string;
  }): Promise<ReadableStream<Uint8Array>>;
  openSessionRaw(input: {
    runId: string;
    nodeId: string;
    visit?: number;
  }): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes: number; sha256: string; etag?: string }>;
  runIdForTask(taskId: string): Promise<string | null>;
};

export type RunRow = {
  id: string;
  workflow_id: string | null;
  workflow_ref_id: string;
  workflow_name: string;
  workflow_revision: number;
  graph_snapshot: WorkflowGraph | string;
  intent_markdown: string;
  harness_id: string | null;
  harness_ref_id: string;
  harness_name: string;
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
  expert_name: string | null;
  state: RunNodeState;
  task_id: string | null;
  session_id: string | null;
  verdict: Record<string, unknown> | string | null;
  enter_reason: EnterReason | string | null;
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
