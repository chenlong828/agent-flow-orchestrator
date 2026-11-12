import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { TaskNotFoundError, ValidationError, type Clock } from "../../../src/core/kernel/index.ts";
import { createHarnessNodeDirectory } from "../../../src/components/harness/index.ts";
import { createScheduler } from "../../../src/components/scheduler/index.ts";
import type { TaskDraft } from "../../../src/components/scheduler/index.ts";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

beforeEach(async () => {
  await resetBusinessData();
  ctx = await createTestContext();
});

afterAll(async () => {
  await closeTestDb();
});

function uuidFactory(prefix: string) {
  let count = 0;
  return () => {
    count += 1;
    return `${prefix}-7000-8000-${String(count).padStart(12, "0")}`;
  };
}

const nextInstanceId = uuidFactory("0191f2f0-3333");
const nextTaskId = uuidFactory("0191f2f0-5555");

async function bindNode(clientId: string): Promise<void> {
  const created = await ctx.harnessService.create({
    name: `node-${clientId}`,
    kind: "container",
    address: "127.0.0.1:7800",
    accessMode: "agent",
    concurrencyMax: 4,
    queuePolicy: "fifo",
  });
  await ctx.harnessService.bindClient(created.id, 1, {
    clientId,
    token: `token-${clientId}`,
  });
}

async function enroll(clientId: string): Promise<string> {
  const instanceId = nextInstanceId();
  await ctx.instanceService.enroll({
    instanceId,
    clientId,
    workspacePath: `/work/${instanceId}`,
  });
  return instanceId;
}

function taskSpaceOf(instanceId: string): string {
  return `/work/${instanceId}/.agent-flow/task/0191f2f0-7777-7000-8000-000000000001`;
}

async function createSkill(name: string): Promise<string> {
  const skill = await ctx.skillService.create({
    name,
    categoryCode: "coding",
    description: "执行面调度测试用技能",
  });
  return skill.id;
}

function mutableClock(): { clock: Clock; advance(ms: number): void } {
  let current = new Date("2026-11-11T00:00:00.000Z");
  return {
    clock: { now: () => new Date(current) },
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

function schedulerWith(clock: Clock, options: { maxAttempts?: number; retryDelayMs?: number } = {}) {
  return createScheduler({
    db: ctx.db,
    clock,
    ids: { next: nextTaskId },
    instance: ctx.instanceService,
    packages: ctx.packages,
    node: createHarnessNodeDirectory(ctx.harnessRead),
    maxAttempts: options.maxAttempts ?? 3,
    retryDelayMs: options.retryDelayMs ?? 0,
  });
}

type Running = { taskId: string; instanceId: string; startedAt: string };
type Finished = { taskId: string; attempt: number; finishedAt: string };

function report(free: number, running: Running[] = [], finished: Finished[] = []) {
  return { free, running, finished };
}

function poll(
  scheduler: ReturnType<typeof createScheduler>,
  clientId: string,
  free: number,
  extra: { running?: Running[]; finished?: Finished[] } = {},
) {
  return scheduler.poll(clientId, report(free, extra.running ?? [], extra.finished ?? []), {
    holdMs: 0,
  });
}

describe("任务派发与容量（S-01/S-04/S-05/S-06）", () => {
  test("TC-EXD-001 按容量批量下发，任务快照字段完整", async () => {
    const clientId = "node-dispatch";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("派发技能");
    const taskSpacePath = taskSpaceOf(instanceId);
    const enqueued = await ctx.scheduler.enqueue({
      tasks: [
        { instanceId, nodeId: "n1", prompt: "任务一", taskSpacePath, timeoutMs: 1800000, skillIds: [skillId] },
        { instanceId, nodeId: "n2", prompt: "任务二", taskSpacePath, timeoutMs: 1800000, skillIds: [skillId] },
        { instanceId, nodeId: "n3", prompt: "任务三", taskSpacePath, timeoutMs: 1800000, skillIds: [skillId] },
      ],
    });
    expect(enqueued.taskIds).toHaveLength(3);
    expect(enqueued.skillSets[0]!.skillSet.packages[0]!.packageId).toBe(`${skillId}.1`);

    const decision = await poll(ctx.scheduler, clientId, 2);
    expect(decision.tasks).toHaveLength(2);
    expect(decision.stop).toBe(false);
    expect(decision.nextPollAfterMs).toBe(0);
    expect(decision.tasks[0]).toMatchObject({
      instanceId,
      nodeId: "n1",
      attempt: 1,
      prompt: "任务一",
      workspacePath: `/work/${instanceId}`,
      taskSpacePath,
      timeoutMs: 1800000,
    });
    expect(decision.tasks[0]!.skillSet.digest).toBe(enqueued.skillSets[0]!.skillSet.digest);
    expect(decision.tasks[1]!.taskId).not.toBe(decision.tasks[0]!.taskId);
  });

  test("TC-EXD-008 入队拒绝缺失、空串或非绝对的 taskSpacePath", async () => {
    const clientId = "node-task-space-guard";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("task-space 校验技能");
    const missing = {
      instanceId,
      nodeId: "n1",
      prompt: "缺少 task-space",
      timeoutMs: 1000,
      skillIds: [skillId],
    } as unknown as TaskDraft;
    await expect(ctx.scheduler.enqueue({ tasks: [missing] })).rejects.toMatchObject({
      details: { field: "taskSpacePath" },
    });
    for (const taskSpacePath of ["", " ", "relative/task"]) {
      await expect(
        ctx.scheduler.enqueue({
          tasks: [
            {
              instanceId,
              nodeId: "n1",
              prompt: "非法 task-space",
              taskSpacePath,
              timeoutMs: 1000,
              skillIds: [skillId],
            },
          ],
        }),
      ).rejects.toMatchObject({ details: { field: "taskSpacePath" } });
    }
    expect((await poll(ctx.scheduler, clientId, 1)).tasks).toEqual([]);
  });

  test("TC-EXD-002 容量 0 不下发；超过上限时截断到 10", async () => {
    const clientId = "node-capacity";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("容量技能");
    await ctx.scheduler.enqueue({
      tasks: Array.from({ length: 12 }, (_, index) => ({
        instanceId,
        taskSpacePath: taskSpaceOf(instanceId),
        nodeId: `n${index}`,
        prompt: `任务${index}`,
        timeoutMs: 1000,
        skillIds: [skillId],
      })),
    });

    expect((await poll(ctx.scheduler, clientId, 0)).tasks).toEqual([]);
    expect((await poll(ctx.scheduler, clientId, 3)).tasks).toHaveLength(3);
    expect((await poll(ctx.scheduler, clientId, 50)).tasks).toHaveLength(10);
  });

  test("TC-EXD-003 同实例技能集不一致时入队拒绝，一致时派发同一 digest", async () => {
    const clientId = "node-digest";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const first = await createSkill("技能一");
    const second = await createSkill("技能二");

    await ctx.scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "一", timeoutMs: 1000, skillIds: [first] }],
    });
    const decision = await poll(ctx.scheduler, clientId, 1);
    expect(decision.tasks[0]!.skillSet.packages[0]!.skillId).toBe(first);

    await expect(
      ctx.scheduler.enqueue({
        tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n2", prompt: "二", timeoutMs: 1000, skillIds: [second] }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await ctx.scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n3", prompt: "三", timeoutMs: 1000, skillIds: [first] }],
    });
    const same = await poll(ctx.scheduler, clientId, 1);
    expect(same.tasks[0]!.skillSet.digest).toBe(decision.tasks[0]!.skillSet.digest);
  });

  test("TC-EXD-004 未确认重发：既不在 running 也不在 finished 且无结果时原样重发", async () => {
    const clientId = "node-resend";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("重发技能");
    const enqueued = await ctx.scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "重发", timeoutMs: 1000, skillIds: [skillId] }],
    });
    const taskId = enqueued.taskIds[0]!;

    expect((await poll(ctx.scheduler, clientId, 1)).tasks[0]).toMatchObject({ taskId, attempt: 1 });
    expect((await poll(ctx.scheduler, clientId, 1)).tasks[0]).toMatchObject({ taskId, attempt: 1 });

    const running = [{ taskId, instanceId, startedAt: "2026-11-11T00:00:00.000Z" }];
    expect((await poll(ctx.scheduler, clientId, 0, { running })).tasks).toEqual([]);
    expect(
      (
        await poll(ctx.scheduler, clientId, 1, {
          finished: [{ taskId, attempt: 1, finishedAt: "2026-11-11T00:00:01.000Z" }],
        })
      ).tasks,
    ).toEqual([]);
  });
});

describe("结果结算（S-08：失败不自动重派）", () => {
  test("TC-EXR-001 首份结果为准；重复上报 accepted=false；未知 taskId 404", async () => {
    const clientId = "node-result";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("结果技能");
    const enqueued = await ctx.scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "结果", timeoutMs: 1000, skillIds: [skillId] }],
    });
    const taskId = enqueued.taskIds[0]!;
    await poll(ctx.scheduler, clientId, 1);

    expect(
      await ctx.scheduler.acceptResult(clientId, {
        taskId,
        attempt: 1,
        status: "succeeded",
        message: "完成",
        truncated: false,
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 2 },
        error: null,
      }),
    ).toEqual({ taskId, accepted: true });

    expect(
      await ctx.scheduler.acceptResult(clientId, {
        taskId,
        attempt: 1,
        status: "succeeded",
        message: "再次",
        truncated: false,
        stopReason: "end_turn",
        usage: null,
        error: null,
      }),
    ).toEqual({ taskId, accepted: false });

    expect(await ctx.scheduler.inspect(taskId)).toMatchObject({
      state: "done",
      outcome: "succeeded",
    });
    await expect(
      ctx.scheduler.acceptResult(clientId, {
        taskId: "0191f2f0-6666-7000-8000-000000000001",
        attempt: 1,
        status: "succeeded",
        message: "x",
        truncated: false,
        stopReason: null,
        usage: null,
        error: null,
      }),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });

  test("TC-EXR-002 失败与超时结果直接结算，不自动回队", async () => {
    const clientId = "node-fail";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("失败技能");
    const cases = [
      { status: "timeout" as const, error: { class: "timeout" as const, code: "idle_timeout", message: "卡住" } },
      { status: "timeout" as const, error: { class: "timeout" as const, code: "prompt_timeout", message: "太大" } },
      { status: "failed" as const, error: { class: "runtime" as const, code: "runtime_error", message: "崩" } },
      { status: "failed" as const, error: { class: "asset" as const, code: "asset_missing", message: "缺包" } },
      { status: "failed" as const, error: { class: "scheduler" as const, code: "rejected", message: "拒绝" } },
    ];
    for (const item of cases) {
      const enqueued = await ctx.scheduler.enqueue({
        tasks: [
          { instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: item.error.code, timeoutMs: 1000, skillIds: [skillId] },
        ],
      });
      const taskId = enqueued.taskIds[0]!;
      await poll(ctx.scheduler, clientId, 1);
      await ctx.scheduler.acceptResult(clientId, {
        taskId,
        attempt: 1,
        ...item,
        message: "",
        truncated: false,
        stopReason: null,
        usage: null,
      });
      expect(await ctx.scheduler.inspect(taskId)).toMatchObject({ state: "done", outcome: "failed" });
      expect((await poll(ctx.scheduler, clientId, 1)).tasks).toEqual([]);
    }
  });

  test("TC-EXR-003 未回报才回队：超时回队 attempt 递增，用尽后失败", async () => {
    const clientId = "node-unreported";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("未回报技能");
    const { clock, advance } = mutableClock();
    const scheduler = schedulerWith(clock, { maxAttempts: 2 });

    const enqueued = await scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "未回报", timeoutMs: 1000, skillIds: [skillId] }],
    });
    const taskId = enqueued.taskIds[0]!;

    expect((await poll(scheduler, clientId, 1)).tasks[0]).toMatchObject({ taskId, attempt: 1 });

    advance(1000 + 60000 + 1);
    expect((await poll(scheduler, clientId, 1)).tasks[0]).toMatchObject({ taskId, attempt: 2 });
    expect((await scheduler.inspect(taskId)).state).toBe("dispatched");

    advance(1000 + 60000 + 1);
    expect((await poll(scheduler, clientId, 1)).tasks).toEqual([]);
    expect(await scheduler.inspect(taskId)).toMatchObject({ state: "done", outcome: "failed" });
  });

  test("TC-EXR-005 静默回队：其他 client 的 poll 触发失联 client 的任务回队；旧副本结果仍算首份", async () => {
    const silentClient = "node-silent";
    const otherClient = "node-other";
    await bindNode(silentClient);
    await bindNode(otherClient);
    const instanceId = await enroll(silentClient);
    const skillId = await createSkill("静默技能");
    const { clock, advance } = mutableClock();
    const scheduler = schedulerWith(clock, { maxAttempts: 3 });

    const enqueued = await scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "静默", timeoutMs: 600000, skillIds: [skillId] }],
    });
    const taskId = enqueued.taskIds[0]!;
    expect((await poll(scheduler, silentClient, 1)).tasks[0]).toMatchObject({ taskId, attempt: 1 });

    advance(120000 + 1);
    await poll(scheduler, otherClient, 0);
    expect(await scheduler.inspect(taskId)).toMatchObject({ state: "queued", attempt: 2 });

    expect((await poll(scheduler, silentClient, 1)).tasks[0]).toMatchObject({ taskId, attempt: 2 });

    const late = await scheduler.acceptResult(silentClient, {
      taskId,
      attempt: 1,
      status: "succeeded",
      message: "旧副本结果",
      truncated: false,
      stopReason: "end_turn",
      usage: null,
      error: null,
    });
    expect(late).toEqual({ taskId, accepted: true });
    expect(await scheduler.inspect(taskId)).toMatchObject({ state: "done", outcome: "succeeded" });
    expect((await poll(scheduler, silentClient, 1)).tasks).toEqual([]);
  });

  test("TC-EXR-004 workspace 失败只结算同实例其余任务，实例保持可派发（无 blocked）", async () => {
    const clientId = "node-workspace";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("实例失败技能");
    const enqueued = await ctx.scheduler.enqueue({
      tasks: [
        { instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "一", timeoutMs: 1000, skillIds: [skillId] },
        { instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n2", prompt: "二", timeoutMs: 1000, skillIds: [skillId] },
      ],
    });
    await poll(ctx.scheduler, clientId, 2);
    const [first, second] = enqueued.taskIds;

    await ctx.scheduler.acceptResult(clientId, {
      taskId: first!,
      attempt: 1,
      status: "failed",
      message: "",
      truncated: false,
      stopReason: null,
      usage: null,
      error: { class: "workspace", code: "workspace_missing", message: "目录不可写" },
    });

    expect((await ctx.instanceService.get(instanceId))?.state).toBe("active");
    expect(await ctx.scheduler.inspect(second!)).toMatchObject({ state: "done", outcome: "failed" });
    // 不再摘除实例：同工作区下一次显式启动能重新派发，失败会直接暴露在节点上。
    expect((await poll(ctx.scheduler, clientId, 1)).tasks).toEqual([]);
    const retry = await ctx.scheduler.enqueue({
      tasks: [
        { instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n3", prompt: "三", timeoutMs: 1000, skillIds: [skillId] },
      ],
    });
    expect((await poll(ctx.scheduler, clientId, 1)).tasks.map((task) => task.taskId)).toEqual(retry.taskIds);
  });
});

describe("停止与取消（S-07）", () => {
  test("TC-EXC-001 停止后不再下发任务，已下发任务不受影响", async () => {
    const clientId = "node-stop";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("停止技能");
    await ctx.scheduler.enqueue({
      tasks: [
        { instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "一", timeoutMs: 1000, skillIds: [skillId] },
        { instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n2", prompt: "二", timeoutMs: 1000, skillIds: [skillId] },
      ],
    });
    const first = await poll(ctx.scheduler, clientId, 1);
    expect(first.tasks).toHaveLength(1);

    await ctx.scheduler.requestStop(clientId);
    const stopped = await poll(ctx.scheduler, clientId, 1);
    expect(stopped.stop).toBe(true);
    expect(stopped.tasks).toEqual([]);
    expect((await ctx.scheduler.inspect(first.tasks[0]!.taskId)).state).toBe("dispatched");
  });

  test("TC-EXC-002 取消在跑任务：持续下发 cancelInstances 直到结算为 cancelled", async () => {
    const clientId = "node-cancel-running";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("取消技能");
    const enqueued = await ctx.scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "取消", timeoutMs: 1000, skillIds: [skillId] }],
    });
    const taskId = enqueued.taskIds[0]!;
    await poll(ctx.scheduler, clientId, 1);

    expect((await ctx.scheduler.cancelInstances([instanceId])).requested).toBe(1);

    const running = [{ taskId, instanceId, startedAt: "2026-11-11T00:00:00.000Z" }];
    expect((await poll(ctx.scheduler, clientId, 0, { running })).cancelInstances).toEqual([
      instanceId,
    ]);

    await ctx.scheduler.acceptResult(clientId, {
      taskId,
      attempt: 1,
      status: "cancelled",
      message: "",
      truncated: false,
      stopReason: null,
      usage: null,
      error: { class: "cancelled", code: "cancelled_by_scheduler", message: "已取消" },
    });
    expect(await ctx.scheduler.inspect(taskId)).toMatchObject({ state: "done", outcome: "cancelled" });
    expect((await poll(ctx.scheduler, clientId, 0)).cancelInstances).toEqual([]);
  });

  test("TC-EXC-003 取消未下发任务直接结算为 cancelled，且不再下发", async () => {
    const clientId = "node-cancel-queued";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("排队取消技能");
    const enqueued = await ctx.scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "排队", timeoutMs: 1000, skillIds: [skillId] }],
    });
    const taskId = enqueued.taskIds[0]!;

    await ctx.scheduler.cancelInstances([instanceId]);
    expect(await ctx.scheduler.inspect(taskId)).toMatchObject({ state: "done", outcome: "cancelled" });
    expect((await poll(ctx.scheduler, clientId, 1)).tasks).toEqual([]);
  });

  test("TC-EXC-004 重复停止与取消幂等", async () => {
    const clientId = "node-idempotent";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("幂等技能");
    await ctx.scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "幂等", timeoutMs: 1000, skillIds: [skillId] }],
    });
    await ctx.scheduler.requestStop(clientId);
    await ctx.scheduler.requestStop(clientId);
    expect((await poll(ctx.scheduler, clientId, 1)).stop).toBe(true);

    expect((await ctx.scheduler.cancelInstances([instanceId])).requested).toBe(1);
    expect((await ctx.scheduler.cancelInstances([instanceId])).requested).toBe(0);
  });
});

describe("长轮询", () => {
  test("TC-EXD-007 无任务挂起到周期结束返回空批；新任务入队唤醒等待", async () => {
    const clientId = "node-hold";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("长轮询技能");

    const emptyStart = Date.now();
    const empty = await ctx.scheduler.poll(clientId, report(1), { holdMs: 40 });
    expect(empty.tasks).toEqual([]);
    expect(Date.now() - emptyStart).toBeGreaterThanOrEqual(30);

    const waiting = ctx.scheduler.poll(clientId, report(1), { holdMs: 1000 });
    await Bun.sleep(20);
    await ctx.scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "唤醒", timeoutMs: 1000, skillIds: [skillId] }],
    });
    const woken = await waiting;
    expect(woken.tasks).toHaveLength(1);
  });
});

describe("节点门禁与观测", () => {
  test("TC-EXD-005 节点停用时不下发，恢复后继续派发", async () => {
    const clientId = "node-gate";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("门禁技能");
    await ctx.scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "门禁", timeoutMs: 1000, skillIds: [skillId] }],
    });

    const harness = await ctx.harnessRead.getByClientId(clientId);
    await ctx.harnessService.setEnabled(harness!.id, harness!.revision, false);
    expect((await poll(ctx.scheduler, clientId, 1)).tasks).toEqual([]);

    await ctx.harnessService.setEnabled(harness!.id, harness!.revision + 1, true);
    expect((await poll(ctx.scheduler, clientId, 1)).tasks).toHaveLength(1);
  });

  test("TC-EXD-006 presence 返回最近 poll、free 与在跑数；未 poll 为 null", async () => {
    const clientId = "node-presence";
    await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("观测技能");
    await ctx.scheduler.enqueue({
      tasks: [{ instanceId, taskSpacePath: taskSpaceOf(instanceId), nodeId: "n1", prompt: "观测", timeoutMs: 1000, skillIds: [skillId] }],
    });

    expect(await ctx.scheduler.presence([clientId])).toEqual([
      { clientId, lastPollAt: null, free: null, running: 0 },
    ]);
    const decision = await poll(ctx.scheduler, clientId, 2);
    const view = (await ctx.scheduler.presence([clientId]))[0]!;
    expect(view.free).toBe(2);
    expect(view.running).toBe(0);
    expect(view.lastPollAt).not.toBeNull();
    expect(decision.tasks).toHaveLength(1);
  });
});
