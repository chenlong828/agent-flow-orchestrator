import type { SkillPackageRef } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";

export type TaskState = "queued" | "dispatched" | "done";
export type TaskOutcome = "succeeded" | "failed" | "cancelled" | "timeout";

export type SkillSet = { digest: string; packages: SkillPackageRef[] };

export type ResultSignalContract = {
  version: number;
  kind: "review_verdict" | "confirmation_request";
  required: boolean;
  schema: Record<string, unknown>;
};

export type TaskSignal = {
  seq: number;
  at: string;
  kind: "review_verdict" | "confirmation_request";
  data: Record<string, unknown>;
};

export type TaskDraft = {
  instanceId: string;
  nodeId: string;
  prompt: string;
  timeoutMs: number;
  skillIds: string[];
  /** v3：run 的 task-space 绝对路径；必填，由上游编排传入。 */
  taskSpacePath: string;
  /** v3 加法：结果信号契约；opaque，调度器只持久化与透传。 */
  resultSignal?: ResultSignalContract;
  /** v3 加法：确认点续跑同一 session；缺省新建。 */
  resumeSessionId?: string;
};

export type EnqueueInput = { tasks: TaskDraft[]; actor?: string };

export type EnqueueOptions = {
  /**
   * 传入时：任务行插入跑在调用方事务内，且本方法**不唤醒**；
   * 由调用方在提交后调 `notifyClient`，保证唤醒时任务行与关联字段同时可见。
   */
  tx?: Db;
};

export type EnqueueResult = {
  taskIds: string[];
  skillSets: { instanceId: string; skillSet: SkillSet }[];
  /** 任务所属 client 的 ID（去重）；传入 `tx` 时由调用方据此唤醒。 */
  clientIds: string[];
};

export type RunningRef = {
  taskId: string;
  instanceId: string;
  startedAt: string;
  lastEventAt?: string;
};

export type FinishedRef = { taskId: string; attempt: number; finishedAt: string };

export type ClientReport = {
  free: number;
  running: RunningRef[];
  finished: FinishedRef[];
};

export type PollOptions = { holdMs: number };

export type TaskEnvelope = {
  taskId: string;
  instanceId: string;
  nodeId: string;
  attempt: number;
  prompt: string;
  workspacePath: string;
  taskSpacePath: string;
  timeoutMs: number;
  skillSet: SkillSet;
  resultSignal?: ResultSignalContract;
  resumeSessionId?: string;
};

export type DispatchDecision = {
  tasks: TaskEnvelope[];
  stop: boolean;
  cancelInstances: string[];
  nextPollAfterMs: number;
};

export type TaskError = {
  class: "workspace" | "asset" | "runtime" | "protocol" | "cancelled" | "timeout" | "scheduler" | "internal";
  code: string;
  message: string;
};

export type TaskResult = {
  taskId: string;
  attempt: number;
  status: "succeeded" | "failed" | "cancelled" | "timeout";
  sessionId?: string;
  message: string;
  truncated: boolean;
  stopReason: string | null;
  usage: { inputTokens?: number; outputTokens?: number } | null;
  error: TaskError | null;
  signals?: TaskSignal[];
  startedAt?: string;
  finishedAt?: string;
};

export type ResultAck = { taskId: string; accepted: boolean };

export type TaskSnapshot = {
  taskId: string;
  instanceId: string;
  clientId: string;
  nodeId: string;
  attempt: number;
  state: TaskState;
  outcome?: TaskOutcome;
  error?: TaskError;
  skillSetDigest: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
};

export type ClientPresenceView = {
  clientId: string;
  lastPollAt: string | null;
  free: number | null;
  running: number;
};

export type SchedulerPresenceRead = {
  presence(clientIds: string[]): Promise<ClientPresenceView[]>;
};

export type SchedulerService = {
  enqueue(input: EnqueueInput, options?: EnqueueOptions): Promise<EnqueueResult>;
  /** 单客户端唤醒；`enqueue` 缺省路径在提交后自动调用，传入 `tx` 时由调用方调用。 */
  notifyClient(clientId: string): void;
  poll(clientId: string, report: ClientReport, options: PollOptions): Promise<DispatchDecision>;
  acceptResult(clientId: string, result: TaskResult): Promise<ResultAck>;
  /** 人工续跑：把 done(timeout) 的同一 task 重开为下一 attempt。 */
  resumeTask(clientId: string, taskId: string, resumeSessionId: string): Promise<TaskSnapshot>;
  requestStop(clientId: string): Promise<void>;
  cancelInstances(instanceIds: string[]): Promise<{ requested: number }>;
  inspect(taskId: string): Promise<TaskSnapshot>;
};
