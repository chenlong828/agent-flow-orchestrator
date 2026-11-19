import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";
import { createFileStore, systemClock, uuidv7Ids } from "../../../src/core/platform/index.ts";
import { createRunService } from "../../../src/components/run/index.ts";
import type { SchedulerService } from "../../../src/components/scheduler/index.ts";
import type { EnqueueInput, TaskResult } from "../../../src/components/scheduler/types.ts";
import type { WorkflowGraph } from "../../../src/components/workflow/index.ts";

let ctx: TestContext;
const directories: string[] = [];

function graphLinear(expertId: string): WorkflowGraph {
  return {
    stages: [{ id: "s1", name: "设计" }],
    nodes: [
      { id: "n1", type: "start", name: "开始", stageId: "s1", expertId },
      { id: "n2", type: "agent", name: "实现", stageId: "s1", expertId },
      { id: "n3", type: "end", name: "结束", stageId: "s1", expertId },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
    ],
  };
}

function graphReview(expertId: string): WorkflowGraph {
  return {
    stages: [{ id: "s1", name: "设计" }],
    nodes: [
      { id: "n1", type: "start", name: "开始", stageId: "s1", expertId },
      { id: "n2", type: "agent", name: "实现", stageId: "s1", expertId },
      { id: "n3", type: "review", name: "审核", stageId: "s1", expertId },
      { id: "n4", type: "end", name: "结束", stageId: "s1", expertId },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
      { id: "e3", from: "n3", to: "n4", kind: "seq" },
      { id: "e4", from: "n3", to: "n2", kind: "rollback" },
    ],
  };
}

function graphConfirm(expertId: string): WorkflowGraph {
  return {
    stages: [{ id: "s1", name: "设计" }],
    nodes: [
      { id: "n1", type: "start", name: "开始", stageId: "s1", expertId },
      { id: "n2", type: "confirm", name: "确认", stageId: "s1", expertId: null },
      { id: "n3", type: "end", name: "结束", stageId: "s1", expertId },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
      { id: "e3", from: "n2", to: "n1", kind: "rollback" },
    ],
  };
}

function fakeScheduler(): SchedulerService & {
  cancelled: string[];
  enqueued: EnqueueInput[];
  resumed: { taskId: string; sessionId: string }[];
} {
  let counter = 0;
  const tasks = new Map<string, { state: string }>();
  const cancelled: string[] = [];
  const enqueued: EnqueueInput[] = [];
  const resumed: { taskId: string; sessionId: string }[] = [];
  return {
    cancelled,
    enqueued,
    resumed,
    enqueue: async (input: EnqueueInput) => {
      enqueued.push(input);
      return {
        taskIds: input.tasks.map(() => {
          counter += 1;
          const id = `0191f2f0-9999-7000-8000-${String(counter).padStart(12, "0")}`;
          tasks.set(id, { state: "queued" });
          return id;
        }),
        skillSets: [],
      };
    },
    acceptResult: async (_clientId: string, result: TaskResult) => {
      const task = tasks.get(result.taskId);
      if (task !== undefined) task.state = "done";
      return { taskId: result.taskId, accepted: true };
    },
    resumeTask: async (_clientId: string, taskId: string, sessionId: string) => {
      resumed.push({ taskId, sessionId });
      tasks.set(taskId, { state: "queued" });
      return {
        taskId,
        instanceId: "",
        clientId: "",
        nodeId: "",
        attempt: 2,
        state: "queued" as const,
        skillSetDigest: "",
        createdAt: "",
        updatedAt: "",
      };
    },
    inspect: async (taskId: string) => ({
      taskId,
      instanceId: "",
      clientId: "",
      nodeId: "",
      attempt: 1,
      state: (tasks.get(taskId)?.state ?? "queued") as "queued" | "dispatched" | "done",
      skillSetDigest: "",
      createdAt: "",
      updatedAt: "",
    }),
    cancelInstances: async (ids: string[]) => {
      cancelled.push(...ids);
      return { requested: ids.length };
    },
    poll: async () => ({ tasks: [], stop: false, cancelInstances: [], nextPollAfterMs: 0 }),
    requestStop: async () => {},
  } as unknown as SchedulerService & {
    cancelled: string[];
    enqueued: EnqueueInput[];
    resumed: { taskId: string; sessionId: string }[];
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makeHarness(graphOf: (expertId: string) => WorkflowGraph, workspacePath = "/work/run") {
  const expertName = `流程专家-${Math.random().toString(16).slice(2, 8)}`;
  const expert = await ctx.expertService.create({
    name: expertName,
    color: "#336699",
    role: "执行",
  });
  const harnessName = `节点-${Math.random().toString(16).slice(2, 8)}`;
  const harness = await ctx.harnessService.create({
    name: harnessName,
    kind: "container",
    address: "127.0.0.1:7800",
    accessMode: "agent",
    concurrencyMax: 2,
    queuePolicy: "fifo",
  });
  const clientId = `client-${Math.random().toString(16).slice(2, 8)}`;
  await ctx.harnessService.bindClient(harness.id, harness.revision, {
    clientId,
    token: `token-${clientId}`,
  });
  const workflowName = `流程-${Math.random().toString(16).slice(2, 8)}`;
  const workflow = await ctx.workflowService.create({
    name: workflowName,
    type: "研发",
    description: "",
    graph: graphOf(expert.id),
  });
  const directory = await mkdtemp(join(tmpdir(), "agentflow-run-"));
  directories.push(directory);
  const scheduler = fakeScheduler();
  const runService = createRunService({
    db: ctx.db,
    clock: systemClock,
    ids: uuidv7Ids,
    fileStore: createFileStore(directory),
    workflowRead: ctx.workflowRead,
    expertRead: ctx.expertRead,
    harnessRead: ctx.harnessRead,
    instance: ctx.instanceService,
    scheduler,
    defaultTimeoutMs: 60000,
    maxNodeVisits: 5,
  });
  return {
    runService,
    scheduler,
    clientId,
    expertId: expert.id,
    expertName,
    workflowId: workflow.id,
    workflowName,
    harnessId: harness.id,
    harnessName,
  };
}

async function attachLog(
  runService: ReturnType<typeof createRunService>,
  taskId: string,
  bytes?: Uint8Array,
  attempt = 1,
) {
  const data = bytes ?? Bun.gzipSync(new Uint8Array());
  await runService.attachSessionLog({
    clientId: "unused",
    taskId,
    attempt,
    bytes: data,
    sha256: sha256(data),
  });
  return data;
}

async function report(
  runService: ReturnType<typeof createRunService>,
  clientId: string,
  taskId: string,
  status: "succeeded" | "failed" | "cancelled" | "timeout",
  message: string,
  sessionId?: string,
  signals?: NonNullable<TaskResult["signals"]>,
) {
  return runService.handleTaskResult(clientId, {
    taskId,
    attempt: 1,
    status,
    ...(sessionId === undefined ? {} : { sessionId }),
    message,
    truncated: false,
    stopReason: null,
    usage: null,
    ...(signals === undefined ? {} : { signals }),
    error: status === "succeeded" ? null : { class: "runtime", code: "failed", message: "失败" },
  });
}

async function dispatchedTaskId(runService: ReturnType<typeof createRunService>, runId: string) {
  const detail = await runService.get(runId);
  const node = detail.nodes.find((item) => item.state === "dispatched" && item.taskId !== null);
  if (node === undefined || node.taskId === null) throw new Error("没有 dispatched 节点");
  return node.taskId;
}

async function driveSucceeded(
  h: Awaited<ReturnType<typeof makeHarness>>,
  runId: string,
  steps: number,
) {
  for (let index = 0; index < steps; index += 1) {
    const taskId = await dispatchedTaskId(h.runService, runId);
    await attachLog(h.runService, taskId);
    await report(h.runService, h.clientId, taskId, "succeeded", `step-${index}`);
  }
}

beforeEach(async () => {
  await resetBusinessData();
});

afterAll(async () => {
  await closeTestDb();
});

ctx = await createTestContext();

describe("CMP-run 启动与推进", () => {
  test("start 派发首节点；逐节点推进到 end 并结算 succeeded", async () => {
    const h = await makeHarness(graphLinear);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/linear",
      intentMarkdown: "写一个函数",
      actor: null,
    });
    expect(run.state).toBe("running");
    expect(run.taskSpacePath).toMatch(/^\/work\/linear\/task-spaces\/\d{8}-\d{6}$/);
    expect(h.scheduler.enqueued[0]!.tasks[0]!.taskSpacePath).toBe(run.taskSpacePath);
    expect(run.nodes).toHaveLength(1);
    expect(run.nodes[0]!.nodeId).toBe("n1");
    expect(run.nodes[0]!.state).toBe("dispatched");

    await driveSucceeded(h, run.runId, 1);
    let detail = await h.runService.get(run.runId);
    expect(detail.nodes.find((n) => n.nodeId === "n1")?.state).toBe("succeeded");
    expect(detail.nodes.find((n) => n.nodeId === "n2")?.state).toBe("dispatched");

    await driveSucceeded(h, run.runId, 1);
    detail = await h.runService.get(run.runId);
    expect(detail.nodes.find((n) => n.nodeId === "n3")?.state).toBe("dispatched");

    await driveSucceeded(h, run.runId, 1);
    detail = await h.runService.get(run.runId);
    expect(detail.state).toBe("done");
    expect(detail.outcome).toBe("succeeded");
    expect(detail.finalMessage).toBe("step-0");
    expect(detail.archiveState).toBe("pending");
  });

  test("缺日志报结果返回 session_log_missing，任务不结算", async () => {
    const h = await makeHarness(graphLinear);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/missing-log",
      intentMarkdown: "x",
      actor: null,
    });
    const taskId = await dispatchedTaskId(h.runService, run.runId);
    await expect(report(h.runService, h.clientId, taskId, "succeeded", "ok")).rejects.toMatchObject({
      code: "session_log_missing",
    });
    const detail = await h.runService.get(run.runId);
    expect(detail.nodes[0]!.state).toBe("dispatched");
  });

  test("结果里的 sessionId 落到 run_node；失败结果同样记录", async () => {
    const h = await makeHarness(graphLinear, "/work/session");
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/session",
      intentMarkdown: "x",
      actor: null,
    });
    const taskId = await dispatchedTaskId(h.runService, run.runId);
    await attachLog(h.runService, taskId);
    await report(h.runService, h.clientId, taskId, "failed", "执行失败", "session-failed");

    const rows = await ctx.db.query<{ state: string; session_id: string | null }>(
      "select state, session_id from run_node where run_id = $1 and node_id = $2 and visit = 1",
      [run.runId, "n1"],
    );
    expect(rows[0]?.state).toBe("failed");
    expect(rows[0]?.session_id).toBe("session-failed");
    expect((await h.runService.get(run.runId)).outcome).toBe("failed");
  });

  test("同一工作区第二次启动返回 run_conflict", async () => {
    const h = await makeHarness(graphLinear, "/work/conflict");
    await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/conflict",
      intentMarkdown: "x",
      actor: null,
    });
    await expect(
      h.runService.start({
        workflowId: h.workflowId,
        harnessId: h.harnessId,
        workspacePath: "/work/conflict",
        intentMarkdown: "y",
      actor: null,
      }),
    ).rejects.toMatchObject({ code: "run_conflict" });
  });
});

describe("CMP-run 判定与回退", () => {
  test("review fail 沿回退边重跑目标节点", async () => {
    const h = await makeHarness(graphReview);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/review",
      intentMarkdown: "x",
      actor: null,
    });
    await driveSucceeded(h, run.runId, 2);
    const reviewTask = await dispatchedTaskId(h.runService, run.runId);
    await attachLog(h.runService, reviewTask);
    await report(
      h.runService,
      h.clientId,
      reviewTask,
      "succeeded",
      "审核意见：再改",
      undefined,
      [{
        seq: 1,
        at: "2026-11-18T00:00:00.000Z",
        kind: "review_verdict",
        data: { verdict: "fail", reason: "再改" },
      }],
    );

    const detail = await h.runService.get(run.runId);
    const reviews = detail.nodes.filter((n) => n.nodeId === "n3");
    expect(reviews.find((n) => n.visit === 1)?.state).toBe("rejected");
    expect(reviews.find((n) => n.visit === 2)?.state).toBe("queued");
    const agents = detail.nodes.filter((n) => n.nodeId === "n2");
    expect(agents).toHaveLength(2);
    expect(agents[1]?.visit).toBe(2);
    expect(agents[1]?.state).toBe("dispatched");
    expect(detail.state).toBe("running");

    // 进入原因是机制字段：目标节点与回退路径上的节点都指向被驳回行；
    // prompt 由它渲染出理由，理由正文仍只在被驳回行的 verdict 里。
    expect(agents[1]?.enterReason).toEqual({ kind: "review_fail", from: "n3", fromVisit: 1 });
    expect(reviews.find((n) => n.visit === 2)?.enterReason).toEqual({
      kind: "review_fail",
      from: "n3",
      fromVisit: 1,
    });
    expect(agents[0]?.enterReason).toBeNull();
    const retry = h.scheduler.enqueued.at(-1)!.tasks[0]!;
    expect(retry.prompt).toContain("[本次进入] 节点「审核」判定 fail，本节点被回退重跑。");
    expect(retry.prompt).toContain("驳回理由：再改");
    expect(retry.prompt).not.toContain("第 1 轮");
  });

  test("没有 review_verdict 信号时节点与 run 失败", async () => {
    const h = await makeHarness(graphReview);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/verdict",
      intentMarkdown: "x",
      actor: null,
    });
    await driveSucceeded(h, run.runId, 2);
    const reviewTask = await dispatchedTaskId(h.runService, run.runId);
    await attachLog(h.runService, reviewTask);
    await report(h.runService, h.clientId, reviewTask, "succeeded", '{"verdict":"pass","reason":"message 里的旧出口"}');

    const detail = await h.runService.get(run.runId);
    expect(detail.state).toBe("done");
    expect(detail.outcome).toBe("failed");
    expect(detail.nodes.find((n) => n.nodeId === "n3")?.state).toBe("failed");
  });
});

describe("CMP-run 人工确认与取消", () => {
  test("confirm 节点等待决策；pass 后继续", async () => {
    const h = await makeHarness(graphConfirm);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/confirm",
      intentMarkdown: "x",
      actor: null,
    });
    await driveSucceeded(h, run.runId, 1);

    let detail = await h.runService.get(run.runId);
    expect(detail.state).toBe("waiting_confirm");
    expect(detail.nodes.find((n) => n.nodeId === "n2")?.state).toBe("waiting_confirm");

    detail = await h.runService.decide({ runId: run.runId, nodeId: "n2", decision: "pass", comment: null, actor: null });
    expect(detail.state).toBe("running");
    expect(detail.nodes.find((n) => n.nodeId === "n2")?.state).toBe("succeeded");
    expect(detail.nodes.find((n) => n.nodeId === "n3")?.state).toBe("dispatched");
  });

  test("人工驳回后重跑：进入原因指向确认行，prompt 渲染驳回意见", async () => {
    const h = await makeHarness(graphConfirm);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/confirm-reject",
      intentMarkdown: "x",
      actor: null,
    });
    await driveSucceeded(h, run.runId, 1);
    const detail = await h.runService.decide({
      runId: run.runId,
      nodeId: "n2",
      decision: "reject",
      comment: "方案与预算冲突，改完再提交",
      actor: "tester",
    });
    expect(detail.state).toBe("running");
    const retry = detail.nodes.find((n) => n.nodeId === "n1" && n.visit === 2);
    expect(retry?.enterReason).toEqual({ kind: "confirm_reject", from: "n2", fromVisit: 1 });
    const task = h.scheduler.enqueued.at(-1)!.tasks[0]!;
    expect(task.prompt).toContain("[本次进入] 人工在「确认」节点驳回，本节点被回退重跑。");
    expect(task.prompt).toContain("驳回意见：方案与预算冲突，改完再提交");
  });

  test("取消把 run 置为 cancelled 并取消实例任务", async () => {
    const h = await makeHarness(graphLinear);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/cancel",
      intentMarkdown: "x",
      actor: null,
    });
    const detail = await h.runService.cancel(run.runId, "tester");
    expect(detail.state).toBe("done");
    expect(detail.outcome).toBe("cancelled");
    expect(h.scheduler.cancelled).toHaveLength(1);
  });
});

describe("CMP-run 超时续跑", () => {
  test("TC-RUN-017 timeout 带 session 进入 waiting_resume；resumeNode 重开同一 task 并继续", async () => {
    const h = await makeHarness(graphLinear);
    const started = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/run-resume",
      intentMarkdown: "继续执行",
      actor: null,
    });
    const runId = started.runId;

    const n1Task = await dispatchedTaskId(h.runService, runId);
    await attachLog(h.runService, n1Task);
    await report(h.runService, h.clientId, n1Task, "succeeded", "开始完成");

    const n2Task = await dispatchedTaskId(h.runService, runId);
    await attachLog(h.runService, n2Task);
    const waited = await report(h.runService, h.clientId, n2Task, "timeout", "超时", "session-timeout");
    expect(waited.accepted).toBe(true);

    const waiting = await h.runService.get(runId);
    expect(waiting.state).toBe("waiting_resume");
    const waitingNode = waiting.nodes.find((node) => node.nodeId === "n2");
    expect(waitingNode?.state).toBe("waiting_resume");
    expect(waitingNode?.finishedAt).toBeNull();
    expect(waiting.outcome).toBeNull();
    expect(h.scheduler.resumed).toEqual([]);

    const resumed = await h.runService.resumeNode({ runId, nodeId: "n2", actor: null });
    expect(resumed.state).toBe("running");
    expect(resumed.nodes.find((node) => node.nodeId === "n2")?.state).toBe("dispatched");
    expect(h.scheduler.resumed).toEqual([{ taskId: n2Task, sessionId: "session-timeout" }]);

    await attachLog(h.runService, n2Task, undefined, 2);
    const ack = await h.runService.handleTaskResult(h.clientId, {
      taskId: n2Task,
      attempt: 2,
      status: "succeeded",
      message: "继续完成",
      truncated: false,
      stopReason: "end_turn",
      usage: null,
      error: null,
    });
    expect(ack.accepted).toBe(true);

    const after = await h.runService.get(runId);
    expect(after.nodes.find((node) => node.nodeId === "n2")?.state).toBe("succeeded");
    expect(after.nodes.find((node) => node.nodeId === "n3")?.state).toBe("dispatched");
  });

  test("TC-RUN-020 timeout 无 session 仍按现状失败", async () => {
    const h = await makeHarness(graphLinear);
    const started = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/run-timeout-no-session",
      intentMarkdown: "超时",
      actor: null,
    });
    const runId = started.runId;
    const n1Task = await dispatchedTaskId(h.runService, runId);
    await attachLog(h.runService, n1Task);
    await report(h.runService, h.clientId, n1Task, "timeout", "超时");
    const detail = await h.runService.get(runId);
    expect(detail.state).toBe("done");
    expect(detail.outcome).toBe("failed");
    expect(detail.nodes.find((node) => node.nodeId === "n1")?.state).toBe("failed");
  });

  test("TC-RUN-019 waiting_resume 可取消", async () => {
    const h = await makeHarness(graphLinear);
    const started = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/run-cancel-resume",
      intentMarkdown: "取消",
      actor: null,
    });
    const runId = started.runId;
    const n1Task = await dispatchedTaskId(h.runService, runId);
    await attachLog(h.runService, n1Task);
    await report(h.runService, h.clientId, n1Task, "timeout", "超时", "session-cancel");
    expect((await h.runService.get(runId)).state).toBe("waiting_resume");

    const cancelled = await h.runService.cancel(runId, "tester");
    expect(cancelled.state).toBe("done");
    expect(cancelled.outcome).toBe("cancelled");
    expect(cancelled.nodes.find((node) => node.nodeId === "n1")?.state).toBe("failed");
  });
});

describe("CMP-run 制品与归档", () => {
  test("日志同键重传：created / unchanged / replaced", async () => {
    const h = await makeHarness(graphLinear);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/log",
      intentMarkdown: "x",
      actor: null,
    });
    const taskId = await dispatchedTaskId(h.runService, run.runId);
    const empty = Bun.gzipSync(new Uint8Array());
    const first = await h.runService.attachSessionLog({
      clientId: h.clientId,
      taskId,
      attempt: 1,
      bytes: empty,
      sha256: sha256(empty),
    });
    expect(first.stored).toBe("created");
    const again = await h.runService.attachSessionLog({
      clientId: h.clientId,
      taskId,
      attempt: 1,
      bytes: empty,
      sha256: sha256(empty),
    });
    expect(again.stored).toBe("unchanged");
    const other = Bun.gzipSync(new TextEncoder().encode('{"v":1}\n'));
    const replaced = await h.runService.attachSessionLog({
      clientId: h.clientId,
      taskId,
      attempt: 1,
      bytes: other,
      sha256: sha256(other),
    });
    expect(replaced.stored).toBe("replaced");
  });

  test("run 终态后返回归档指令；上传后 archive_state=stored", async () => {
    const h = await makeHarness(graphLinear);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/archive",
      intentMarkdown: "x",
      actor: null,
    });
    await driveSucceeded(h, run.runId, 3);
    const detail = await h.runService.get(run.runId);
    expect(detail.outcome).toBe("succeeded");

    const requests = await h.runService.archiveRequestsFor(h.clientId);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.taskSpacePath).toBe(detail.taskSpacePath);
    expect(requests[0]!.workspacePath).toBe("/work/archive");

    const directory = await mkdtemp(join(tmpdir(), "agentflow-archive-"));
    directories.push(directory);
    await writeFile(join(directory, "a.txt"), "hello", "utf8");
    const tarPath = join(directory, "out.tgz");
    const proc = Bun.spawnSync(["tar", "-czf", tarPath, "-C", directory, "a.txt"]);
    expect(proc.exitCode).toBe(0);
    const bytes = new Uint8Array(await Bun.file(tarPath).arrayBuffer());
    const stored = await h.runService.storeArchive({
      clientId: h.clientId,
      runId: run.runId,
      bytes,
      sha256: sha256(bytes),
    });
    expect(stored.stored).toBe("created");
    expect((await h.runService.get(run.runId)).archiveState).toBe("stored");
    expect(await h.runService.archiveRequestsFor(h.clientId)).toHaveLength(0);
  });

  test("归档损坏返回 invalid_archive", async () => {
    const h = await makeHarness(graphLinear);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/bad-archive",
      intentMarkdown: "x",
      actor: null,
    });
    await driveSucceeded(h, run.runId, 3);
    const bad = new Uint8Array([1, 2, 3]);
    await expect(
      h.runService.storeArchive({
        clientId: h.clientId,
        runId: run.runId,
        bytes: bad,
        sha256: sha256(bad),
      }),
    ).rejects.toMatchObject({ code: "invalid_archive" });
  });
});

describe("CMP-run 归档电平（取消与超时）", () => {
  test("从未有成功节点的取消 run 不下发归档请求", async () => {
    const h = await makeHarness(graphLinear);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/cancel-archive",
      intentMarkdown: "x",
      actor: null,
    });
    await h.runService.cancel(run.runId, "tester");
    const detail = await h.runService.get(run.runId);
    expect(detail.state).toBe("done");
    expect(detail.outcome).toBe("cancelled");
    expect(detail.archiveState).toBe("none");
    expect(await h.runService.archiveRequestsFor(h.clientId)).toHaveLength(0);
  });

  test("已有成功节点的取消 run 仍需归档", async () => {
    const h = await makeHarness(graphLinear);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/cancel-after-success",
      intentMarkdown: "x",
      actor: null,
    });
    await driveSucceeded(h, run.runId, 1);
    await h.runService.cancel(run.runId, "tester");
    const detail = await h.runService.get(run.runId);
    expect(detail.archiveState).toBe("pending");
    const requests = await h.runService.archiveRequestsFor(h.clientId);
    expect(requests.map((item) => item.runId)).toEqual([run.runId]);
  });

  test("pending 超过阈值后降级为 failed 并停止下发", async () => {
    const h = await makeHarness(graphLinear);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/archive-ttl",
      intentMarkdown: "x",
      actor: null,
    });
    await driveSucceeded(h, run.runId, 3);
    expect((await h.runService.get(run.runId)).archiveState).toBe("pending");

    const expiring = createRunService({
      db: ctx.db,
      clock: { now: () => new Date(Date.now() + 11 * 60 * 1000) },
      ids: uuidv7Ids,
      fileStore: createFileStore(await mkdtemp(join(tmpdir(), "agentflow-ttl-"))),
      workflowRead: ctx.workflowRead,
      expertRead: ctx.expertRead,
      harnessRead: ctx.harnessRead,
      instance: ctx.instanceService,
      scheduler: h.scheduler,
      defaultTimeoutMs: 60000,
      maxNodeVisits: 5,
    });
    expect(await expiring.archiveRequestsFor(h.clientId)).toHaveLength(0);
    expect((await h.runService.get(run.runId)).archiveState).toBe("failed");
  });
});
