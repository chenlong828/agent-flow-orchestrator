/** 执行面网关依赖的后端能力；由组合根用 scheduler/制品端口/鉴权实现装配。 */
export type ExecutorPackageRef = {
  packageId: string;
  skillId: string;
  name: string;
  version: string;
  digest: string;
  sizeBytes: number;
  etag: string;
};

export type ExecutorTaskError = {
  class: "workspace" | "asset" | "runtime" | "protocol" | "cancelled" | "timeout" | "scheduler" | "internal";
  code: string;
  message: string;
};

export type ExecutorRunning = {
  taskId: string;
  instanceId: string;
  startedAt: string;
  lastEventAt?: string;
};

export type ExecutorFinished = { taskId: string; attempt: number; finishedAt: string };

export type ExecutorReport = {
  free: number;
  running: ExecutorRunning[];
  finished: ExecutorFinished[];
};

export type ExecutorTask = {
  taskId: string;
  instanceId: string;
  nodeId: string;
  attempt: number;
  prompt: string;
  workspacePath: string;
  timeoutMs: number;
  skillSet: { digest: string; packages: ExecutorPackageRef[] };
};

export type ExecutorDecision = {
  tasks: ExecutorTask[];
  stop: boolean;
  cancelInstances: string[];
  nextPollAfterMs: number;
};

export type ExecutorResult = {
  taskId: string;
  attempt: number;
  status: "succeeded" | "failed" | "cancelled" | "timeout";
  sessionId?: string;
  message: string;
  truncated: boolean;
  stopReason: string | null;
  usage: { inputTokens?: number; outputTokens?: number } | null;
  error: ExecutorTaskError | null;
  startedAt?: string;
  finishedAt?: string;
};

export type ExecutorBackend = {
  resolveClientId(token: string): Promise<string | null>;
  poll(clientId: string, report: ExecutorReport, options: { holdMs: number }): Promise<ExecutorDecision>;
  acceptResult(clientId: string, result: ExecutorResult): Promise<{ taskId: string; accepted: boolean }>;
  describePackage(packageId: string): Promise<ExecutorPackageRef | null>;
  openPackage(packageId: string): Promise<{ ref: ExecutorPackageRef; data: Uint8Array }>;
};

export type ExecutorDeps = {
  backend: ExecutorBackend;
  /** 测试可注入更短的挂起周期；缺省用契约常量。 */
  pollHoldMs?: number;
};
