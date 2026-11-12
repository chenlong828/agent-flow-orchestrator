import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, type TestContext } from "../../helpers/app.ts";
import {
  completeNextTask,
  createRunFixture,
  getRun,
  nextTask,
  pollExecutor,
  reportTask,
  startRun,
  uploadSessionLog,
} from "../../helpers/run.ts";
import type { WorkflowGraph } from "../../../src/components/workflow/index.ts";

let ctx: TestContext;

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

function graphConfirmRollback(expertId: string): WorkflowGraph {
  return {
    stages: [{ id: "s1", name: "设计" }],
    nodes: [
      { id: "n1", type: "start", name: "开始", stageId: "s1", expertId },
      { id: "n2", type: "agent", name: "实现", stageId: "s1", expertId },
      { id: "n3", type: "confirm", name: "确认", stageId: "s1", expertId: null },
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

function decide(
  runId: string,
  nodeId: string,
  decision: "pass" | "reject",
  comment?: string,
) {
  return call(ctx.app, "POST", `/api/v1/runs/${runId}/nodes/${nodeId}/decision`, {
    body: { decision, ...(comment === undefined ? {} : { comment }) },
  });
}

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await resetBusinessData();
});

afterAll(async () => {
  await closeTestDb();
});

describe("SCN-0303 人工确认与运行控制", () => {
  test("TC-RUN-009 confirm 节点不产生任务并等待决策，pass 后推进 seq", async () => {
    const fixture = await createRunFixture(ctx, graphConfirm);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/confirm-pass" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1 完成");

    let detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("waiting_confirm");
    expect(detail.body.currentNodeId).toBe("n2");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n2").state).toBe(
      "waiting_confirm",
    );
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n2").taskId).toBeNull();
    expect(await nextTask(ctx, fixture.token)).toBeNull();

    const passed = await decide(runId, "n2", "pass", "同意继续");
    expect(passed.status).toBe(200);
    expect(passed.body.state).toBe("running");
    expect(passed.body.nodes.find((node: any) => node.nodeId === "n2").state).toBe("succeeded");
    expect(passed.body.nodes.find((node: any) => node.nodeId === "n3").state).toBe("dispatched");

    const task = await nextTask(ctx, fixture.token);
    expect(task?.nodeId).toBe("n3");
  });

  test("TC-RUN-010 autoConfirm=true 时 confirm 不等待，直接 approved 并推进", async () => {
    const fixture = await createRunFixture(ctx, graphConfirm);
    const started = await startRun(ctx, fixture, {
      workspacePath: "/work/confirm-auto",
      autoConfirm: true,
    });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1 完成");

    const detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("running");
    expect(detail.body.autoConfirm).toBe(true);
    const confirmNode = detail.body.nodes.find((node: any) => node.nodeId === "n2");
    expect(confirmNode.state).toBe("succeeded");
    expect(confirmNode.message).toBe("auto");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n3").state).toBe("dispatched");
  });

  test("TC-RUN-011 confirm 提交 reject 后节点 rejected，回退边目标以 visit+1 重跑", async () => {
    const fixture = await createRunFixture(ctx, graphConfirmRollback);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/confirm-reject" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1 完成");
    await completeNextTask(ctx, fixture.token, "n2 完成");

    let detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("waiting_confirm");

    const rejected = await decide(runId, "n3", "reject", "返工");
    expect(rejected.status).toBe(200);
    expect(rejected.body.state).toBe("running");
    const confirms = rejected.body.nodes.filter((node: any) => node.nodeId === "n3");
    expect(confirms.find((node: any) => node.visit === 1).state).toBe("rejected");
    const agents = rejected.body.nodes.filter((node: any) => node.nodeId === "n2");
    expect(agents.find((node: any) => node.visit === 2).state).toBe("dispatched");

    detail = await getRun(ctx, runId);
    expect(detail.body.currentNodeId).toBe("n2");
  });

  test("TC-RUN-012 取消下发 cancelInstances 电平、重复取消幂等，非 waiting_confirm 决策 409", async () => {
    const fixture = await createRunFixture(ctx, graphConfirmRollback);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/run-cancel" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1 完成");
    const inflight = (await nextTask(ctx, fixture.token))!;
    expect(inflight.nodeId).toBe("n2");

    const cancelled = await call(ctx.app, "POST", `/api/v1/runs/${runId}/cancel`, {
      body: {},
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.state).toBe("done");
    expect(cancelled.body.outcome).toBe("cancelled");
    expect(cancelled.body.error.code).toBe("cancelled");
    const cancelledNode = cancelled.body.nodes.find((node: any) => node.nodeId === "n2");
    expect(cancelledNode.state).toBe("failed");
    expect(cancelledNode.error.code).toBe("cancelled");

    const again = await call(ctx.app, "POST", `/api/v1/runs/${runId}/cancel`, { body: {} });
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe("cancelled");

    const polled = await pollExecutor(ctx, fixture.token);
    expect(polled.body.cancelInstances).toContain(cancelled.body.instanceId);

    await uploadSessionLog(ctx, fixture.token, inflight.taskId, inflight.attempt);
    const settled = await reportTask(ctx, fixture.token, inflight, "cancelled", "已取消");
    expect(settled.status).toBe(200);
    expect(settled.body.accepted).toBe(true);
    expect(await nextTask(ctx, fixture.token)).toBeNull();

    const rejectedDecision = await decide(runId, "n2", "pass");
    expect(rejectedDecision.status).toBe(409);
    expect(rejectedDecision.body.error.code).toBe("invalid_state");

    expect((await getRun(ctx, runId)).body.nodes).toHaveLength(2);
  });
});
