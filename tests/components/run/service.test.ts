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
    ],
  };
}

function fakeScheduler(): SchedulerService & { cancelled: string[]; enqueued: EnqueueInput[] } {
  let counter = 0;
  const tasks = new Map<string, { state: string }>();
  const cancelled: string[] = [];
  const enqueued: EnqueueInput[] = [];
  return {
    cancelled,
    enqueued,
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
  } as unknown as SchedulerService & { cancelled: string[]; enqueued: EnqueueInput[] };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makeHarness(graphOf: (expertId: string) => WorkflowGraph, workspacePath = "/work/run") {
  const expert = await ctx.expertService.create({
    name: `流程专家-${Math.random().toString(16).slice(2, 8)}`,
    color: "#336699",
    role: "执行",
  });
  const harness = await ctx.harnessService.create({
    name: `节点-${Math.random().toString(16).slice(2, 8)}`,
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
  const workflow = await ctx.workflowService.create({
    name: `流程-${Math.random().toString(16).slice(2, 8)}`,
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
    workflowId: workflow.id,
    harnessId: harness.id,
  };
}

async function attachLog(
  runService: ReturnType<typeof createRunService>,
  taskId: string,
  bytes?: Uint8Array,
) {
  const data = bytes ?? Bun.gzipSync(new Uint8Array());
  await runService.attachSessionLog({
    clientId: "unused",
    taskId,
    attempt: 1,
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
) {
  return runService.handleTaskResult(clientId, {
    taskId,
    attempt: 1,
    status,
    message,
    truncated: false,
    stopReason: null,
    usage: null,
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
    });
    expect(run.state).toBe("running");
    expect(run.taskSpacePath).toBe(`/work/linear/.agent-flow/task/${run.runId}`);
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
    });
    const taskId = await dispatchedTaskId(h.runService, run.runId);
    await expect(report(h.runService, h.clientId, taskId, "succeeded", "ok")).rejects.toMatchObject({
      code: "session_log_missing",
    });
    const detail = await h.runService.get(run.runId);
    expect(detail.nodes[0]!.state).toBe("dispatched");
  });

  test("同一工作区第二次启动返回 run_conflict", async () => {
    const h = await makeHarness(graphLinear, "/work/conflict");
    await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/conflict",
      intentMarkdown: "x",
    });
    await expect(
      h.runService.start({
        workflowId: h.workflowId,
        harnessId: h.harnessId,
        workspacePath: "/work/conflict",
        intentMarkdown: "y",
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
    });
    await driveSucceeded(h, run.runId, 2);
    const reviewTask = await dispatchedTaskId(h.runService, run.runId);
    await attachLog(h.runService, reviewTask);
    await report(
      h.runService,
      h.clientId,
      reviewTask,
      "succeeded",
      '```json\n{"verdict":"fail","reason":"再改"}\n```',
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
  });

  test("verdict 非法时节点与 run 失败", async () => {
    const h = await makeHarness(graphReview);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/verdict",
      intentMarkdown: "x",
    });
    await driveSucceeded(h, run.runId, 2);
    const reviewTask = await dispatchedTaskId(h.runService, run.runId);
    await attachLog(h.runService, reviewTask);
    await report(h.runService, h.clientId, reviewTask, "succeeded", "没有 JSON");

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
    });
    await driveSucceeded(h, run.runId, 1);

    let detail = await h.runService.get(run.runId);
    expect(detail.state).toBe("waiting_confirm");
    expect(detail.nodes.find((n) => n.nodeId === "n2")?.state).toBe("waiting_confirm");

    detail = await h.runService.decide({ runId: run.runId, nodeId: "n2", decision: "pass" });
    expect(detail.state).toBe("running");
    expect(detail.nodes.find((n) => n.nodeId === "n2")?.state).toBe("succeeded");
    expect(detail.nodes.find((n) => n.nodeId === "n3")?.state).toBe("dispatched");
  });

  test("取消把 run 置为 cancelled 并取消实例任务", async () => {
    const h = await makeHarness(graphLinear);
    const run = await h.runService.start({
      workflowId: h.workflowId,
      harnessId: h.harnessId,
      workspacePath: "/work/cancel",
      intentMarkdown: "x",
    });
    const detail = await h.runService.cancel(run.runId, "tester");
    expect(detail.state).toBe("done");
    expect(detail.outcome).toBe("cancelled");
    expect(h.scheduler.cancelled).toHaveLength(1);
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
