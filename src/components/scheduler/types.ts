import type { SkillPackageRef } from "../../core/kernel/index.ts";

export type TaskState = "queued" | "dispatched" | "done";
export type TaskOutcome = "succeeded" | "failed" | "cancelled" | "timeout";

export type SkillSet = { digest: string; packages: SkillPackageRef[] };

export type TaskDraft = {
  instanceId: string;
  nodeId: string;
  prompt: string;
  timeoutMs: number;
  skillIds: string[];
};

export type EnqueueInput = { tasks: TaskDraft[]; actor?: string };

export type EnqueueResult = {
  taskIds: string[];
  skillSets: { instanceId: string; skillSet: SkillSet }[];
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
  timeoutMs: number;
  skillSet: SkillSet;
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
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  poll(clientId: string, report: ClientReport, options: PollOptions): Promise<DispatchDecision>;
  acceptResult(clientId: string, result: TaskResult): Promise<ResultAck>;
  requestStop(clientId: string): Promise<void>;
  cancelInstances(instanceIds: string[]): Promise<{ requested: number }>;
  inspect(taskId: string): Promise<TaskSnapshot>;
};
