import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";

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
const nextInstanceId = uuidFactory("0191f2f0-9999");

const harnessBody = (name: string) => ({
  name,
  kind: "container",
  address: "10.0.4.11:7801",
  accessMode: "agent",
  concurrencyMax: 4,
  queuePolicy: "fifo",
});

async function createHarness(name: string): Promise<{ id: string; revision: number }> {
  const response = await call(ctx.app, "POST", "/api/v1/harnesses", { body: harnessBody(name) });
  expect(response.status).toBe(201);
  return { id: response.body.id, revision: response.body.revision };
}

async function bind(id: string, revision: number, clientId: string, token: string) {
  return call(ctx.app, "PATCH", `/api/v1/harnesses/${id}/client`, {
    headers: withRevision(revision),
    body: { clientId, token },
  });
}

describe("节点登记与派发门禁", () => {
  test("TC-EXN-001 绑定/解绑：同 clientId 冲突 409，解绑幂等", async () => {
    const first = await createHarness("节点一");
    const bound = await bind(first.id, first.revision, "node-reg", "token-reg");
    expect(bound.status).toBe(200);
    expect(bound.body.clientId).toBe("node-reg");
    expect(bound.body.clientToken).toBe("token-reg");
    expect(bound.body.revision).toBe(first.revision + 1);

    const second = await createHarness("节点二");
    const conflict = await bind(second.id, second.revision, "node-reg", "token-other");
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("binding_conflict");
    expect(JSON.stringify(conflict.body)).not.toContain("token-other");

    const unbound = await call(ctx.app, "PATCH", `/api/v1/harnesses/${first.id}/client`, {
      headers: withRevision(bound.body.revision),
      body: { clientId: null },
    });
    expect(unbound.status).toBe(200);
    expect(unbound.body.clientId).toBeNull();
    expect(unbound.body.clientToken).toBeNull();

    const again = await call(ctx.app, "PATCH", `/api/v1/harnesses/${first.id}/client`, {
      headers: withRevision(unbound.body.revision),
      body: { clientId: null },
    });
    expect(again.status).toBe(200);
  });

  test("TC-EXN-002 节点停用后不下发新任务，在跑任务仍可结算；启用后恢复派发", async () => {
    const node = await createHarness("节点停用");
    const token = "token-disabled";
    await bind(node.id, node.revision, "node-disabled", token);
    const instanceId = nextInstanceId();
    await ctx.instanceService.enroll({
      instanceId,
      clientId: "node-disabled",
      workspacePath: `/work/${instanceId}`,
    });
    const skill = await ctx.skillService.create({
      name: "停用技能",
      categoryCode: "coding",
      description: "节点停用测试技能",
    });
    await ctx.scheduler.enqueue({
      tasks: [
        {
          instanceId,
          nodeId: "n1",
          prompt: "停用一",
          timeoutMs: 1000,
          skillIds: [skill.id],
        },
        {
          instanceId,
          nodeId: "n2",
          prompt: "停用二",
          timeoutMs: 1000,
          skillIds: [skill.id],
        },
      ],
    });

    const headers = {
      "x-executor-protocol": "3",
      authorization: `Bearer ${token}`,
    };
    const first = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers,
      body: { capacity: { free: 1 }, running: [], finished: [] },
    });
    expect(first.body.tasks).toHaveLength(1);
    const runningTask = first.body.tasks[0];

    const current = await ctx.harnessRead.getByClientId("node-disabled");
    const disabled = await call(ctx.app, "PATCH", `/api/v1/harnesses/${node.id}/enabled`, {
      headers: withRevision(current!.revision),
      body: { enabled: false },
    });
    expect(disabled.status).toBe(200);

    const blocked = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers,
      body: {
        capacity: { free: 1 },
        running: [
          {
            taskId: runningTask.taskId,
            instanceId,
            startedAt: "2026-11-11T00:00:00.000Z",
          },
        ],
        finished: [],
      },
    });
    expect(blocked.body.tasks).toEqual([]);
    expect(blocked.body.stop).toBe(false);

    const settled = await call(
      ctx.app,
      "POST",
      `/api/v1/executor/tasks/${runningTask.taskId}/result`,
      {
        headers,
        body: {
          taskId: runningTask.taskId,
          attempt: 1,
          status: "succeeded",
          message: "停用前跑完",
          truncated: false,
          stopReason: "end_turn",
          usage: null,
          error: null,
        },
      },
    );
    expect(settled.status).toBe(200);
    expect(settled.body.accepted).toBe(true);

    const enabled = await call(ctx.app, "PATCH", `/api/v1/harnesses/${node.id}/enabled`, {
      headers: withRevision(current!.revision + 1),
      body: { enabled: true },
    });
    expect(enabled.status).toBe(200);
    const resumed = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers,
      body: { capacity: { free: 1 }, running: [], finished: [] },
    });
    expect(resumed.body.tasks).toHaveLength(1);
  });

  test("TC-EXN-004 创建/更新不接受 clientId；绑定缺 If-Match 返回 428", async () => {
    const created = await call(ctx.app, "POST", "/api/v1/harnesses", {
      body: { ...harnessBody("节点字段"), clientId: "node-x" },
    });
    expect(created.status).toBe(400);
    expect(created.body.error.code).toBe("validation_error");

    const harness = await createHarness("节点更新");
    const updated = await call(ctx.app, "PUT", `/api/v1/harnesses/${harness.id}`, {
      headers: withRevision(harness.revision),
      body: { ...harnessBody("节点更新"), clientId: "node-y" },
    });
    expect(updated.status).toBe(400);

    const missing = await call(ctx.app, "PATCH", `/api/v1/harnesses/${harness.id}/client`, {
      body: { clientId: "node-y", token: "token-y" },
    });
    expect(missing.status).toBe(428);
  });
});
