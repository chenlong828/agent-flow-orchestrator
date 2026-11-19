import { expect } from "bun:test";
import { call, callRaw, type TestContext } from "./app.ts";
import type { WorkflowGraph } from "../../src/components/workflow/index.ts";

/** 执行面协议版本 3（v3 契约）。 */
export const EXECUTOR_PROTOCOL = { "x-executor-protocol": "3" } as const;

export type RunFixture = {
  expertId: string;
  harnessId: string;
  clientId: string;
  token: string;
  workflowId: string;
};

export type ExecutorTask = {
  taskId: string;
  instanceId: string;
  nodeId: string;
  attempt: number;
  /** 所属 workflow run；手工任务可缺。 */
  runId?: string;
  prompt: string;
  workspacePath: string;
  taskSpacePath: string;
  timeoutMs: number;
  resultSignal?: {
    version: number;
    kind: "review_verdict" | "confirmation_request";
    required: boolean;
    schema: Record<string, unknown>;
  };
  resumeSessionId?: string;
};

let sequence = 0;
function suffix(): string {
  sequence += 1;
  return `${Date.now().toString(36)}-${sequence}`;
}

function execHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, ...EXECUTOR_PROTOCOL, authorization: `Bearer ${token}` };
}

/** 建一套可启动 run 的前置资产：专家、已绑定 client 的节点、保存好的工作流图。 */
export async function createRunFixture(
  ctx: TestContext,
  graphOf: (expertId: string) => WorkflowGraph,
  options: { workflowName?: string } = {},
): Promise<RunFixture> {
  const name = options.workflowName ?? `运行流程-${suffix()}`;
  const expert = await ctx.expertService.create({
    name: `运行专家-${suffix()}`,
    color: "#336699",
    role: "执行",
  });
  const harness = await ctx.harnessService.create({
    name: `运行节点-${suffix()}`,
    kind: "container",
    address: "127.0.0.1:7800",
    accessMode: "agent",
    concurrencyMax: 4,
    queuePolicy: "fifo",
  });
  const clientId = `run-client-${suffix()}`;
  const token = `run-token-${suffix()}`;
  await ctx.harnessService.bindClient(harness.id, harness.revision, { clientId, token });
  const created = await call(ctx.app, "POST", "/api/v1/workflows", {
    body: {
      name,
      type: "研发",
      description: `${name} 说明`,
      graph: graphOf(expert.id),
    },
  });
  expect(created.status).toBe(201);
  return {
    expertId: expert.id,
    harnessId: harness.id,
    clientId,
    token,
    workflowId: created.body.id as string,
  };
}

export function startRun(
  ctx: TestContext,
  fixture: RunFixture,
  input: {
    workspacePath: string;
    intentMarkdown?: string;
    autoConfirm?: boolean;
  },
) {
  return call(ctx.app, "POST", `/api/v1/workflows/${fixture.workflowId}/runs`, {
    body: {
      harnessId: fixture.harnessId,
      workspacePath: input.workspacePath,
      intentMarkdown: input.intentMarkdown ?? "完成这次运行",
      ...(input.autoConfirm === undefined ? {} : { autoConfirm: input.autoConfirm }),
    },
  });
}

export function getRun(ctx: TestContext, runId: string) {
  return call(ctx.app, "GET", `/api/v1/runs/${runId}`);
}

export function listRuns(ctx: TestContext, query = "") {
  return call(ctx.app, "GET", `/api/v1/runs${query}`);
}

export async function pollExecutor(
  ctx: TestContext,
  token: string,
  extra: Record<string, unknown> = {},
) {
  const polled = await call(ctx.app, "POST", "/api/v1/executor/poll", {
    headers: execHeaders(token),
    body: { capacity: { free: 1 }, running: [], finished: [], ...extra },
  });
  expect(polled.status).toBe(200);
  return polled;
}

export async function nextTask(
  ctx: TestContext,
  token: string,
  extra: Record<string, unknown> = {},
): Promise<ExecutorTask | null> {
  const polled = await pollExecutor(ctx, token, extra);
  const tasks = polled.body.tasks as ExecutorTask[];
  expect(tasks.length).toBeLessThanOrEqual(1);
  return tasks[0] ?? null;
}

export function gzipLog(lines: string[] = []): Uint8Array {
  return Bun.gzipSync(new TextEncoder().encode(lines.map((line) => `${line}\n`).join("")));
}

export async function uploadSessionLog(
  ctx: TestContext,
  token: string,
  taskId: string,
  attempt: number,
  bytes: Uint8Array = gzipLog(),
) {
  const response = await ctx.app(
    new Request(
      `http://127.0.0.1:3000/api/v1/executor/tasks/${taskId}/session-log?attempt=${attempt}`,
      {
        method: "POST",
        headers: {
          ...execHeaders(token),
          "content-type": "application/x-ndjson",
          "content-encoding": "gzip",
        },
        body: bytes as unknown as BodyInit,
      },
    ),
  );
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

export function reportTask(
  ctx: TestContext,
  token: string,
  task: { taskId: string; attempt: number },
  status: "succeeded" | "failed" | "cancelled" | "timeout",
  message: string,
  options: {
    sessionId?: string;
    signals?: Array<{
      seq: number;
      at: string;
      kind: "review_verdict" | "confirmation_request";
      data: Record<string, unknown>;
    }>;
  } = {},
) {
  return call(ctx.app, "POST", `/api/v1/executor/tasks/${task.taskId}/result`, {
    headers: execHeaders(token),
    body: {
      taskId: task.taskId,
      attempt: task.attempt,
      status,
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      message,
      truncated: false,
      stopReason: status === "succeeded" ? "end_turn" : null,
      usage: null,
      ...(options.signals === undefined ? {} : { signals: options.signals }),
      error:
        status === "succeeded"
          ? null
          : { class: "runtime", code: status, message: message === "" ? status : message },
    },
  });
}

/** 取一个已派发任务、上传日志并回报成功，返回该任务。 */
export async function completeNextTask(
  ctx: TestContext,
  token: string,
  message = "完成",
): Promise<ExecutorTask> {
  const task = await nextTask(ctx, token);
  if (task === null) throw new Error("没有可领取的任务");
  const log = await uploadSessionLog(ctx, token, task.taskId, task.attempt);
  expect(log.status).toBe(200);
  const result = await reportTask(ctx, token, task, "succeeded", message);
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ taskId: task.taskId, accepted: true });
  return task;
}

/** 逐步领取并成功执行，直到 run 终态或达到步数上限。 */
export async function driveRun(
  ctx: TestContext,
  fixture: RunFixture,
  runId: string,
  options: { steps?: number; messageOf?: (task: ExecutorTask) => string } = {},
): Promise<ExecutorTask[]> {
  const done: ExecutorTask[] = [];
  const steps = options.steps ?? 10;
  for (let index = 0; index < steps; index += 1) {
    const detail = await getRun(ctx, runId);
    if (detail.body.state === "done") return done;
    const task = await nextTask(ctx, fixture.token);
    if (task === null) throw new Error("没有可领取的任务");
    const log = await uploadSessionLog(ctx, fixture.token, task.taskId, task.attempt);
    expect(log.status).toBe(200);
    const result = await reportTask(
      ctx,
      fixture.token,
      task,
      "succeeded",
      options.messageOf?.(task) ?? `step-${index}`,
    );
    expect(result.status).toBe(200);
    done.push(task);
  }
  return done;
}

export async function makeArchiveTar(entries: Record<string, string> = { "a.txt": "hello" }): Promise<Uint8Array> {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "agentflow-run-tar-"));
  for (const [name, content] of Object.entries(entries)) {
    await writeFile(join(directory, name), content, "utf8");
  }
  const tarPath = join(directory, "out.tgz");
  const proc = Bun.spawnSync(["tar", "-czf", tarPath, "-C", directory, ...Object.keys(entries)]);
  expect(proc.exitCode).toBe(0);
  return new Uint8Array(await Bun.file(tarPath).arrayBuffer());
}

export async function uploadArchive(
  ctx: TestContext,
  token: string,
  runId: string,
  bytes: Uint8Array,
) {
  const response = await ctx.app(
    new Request(`http://127.0.0.1:3000/api/v1/executor/runs/${runId}/archive`, {
      method: "POST",
      headers: { ...execHeaders(token), "content-type": "application/gzip" },
      body: bytes as unknown as BodyInit,
    }),
  );
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

export async function readSessionLog(
  ctx: TestContext,
  runId: string,
  nodeId: string,
  query = "",
) {
  return callRaw(ctx.app, "GET", `/api/v1/runs/${runId}/nodes/${nodeId}/session-log${query}`, {
    headers: { "accept-encoding": "identity" },
  });
}

/** 把工作流定义直接改成指定图，用于构造「保存校验拦不住、但运行期必须拒绝」的历史数据。 */
export async function overwriteWorkflowGraph(
  ctx: TestContext,
  workflowId: string,
  graph: WorkflowGraph,
): Promise<void> {
  await ctx.db.query("update workflow_definition set graph = $1::text::jsonb where workflow_id = $2", [
    JSON.stringify(graph),
    workflowId,
  ]);
}
