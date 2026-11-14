import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, type TestContext } from "../../helpers/app.ts";
import {
  completeNextTask,
  createRunFixture,
  driveRun,
  getRun,
  listRuns,
  nextTask,
  overwriteWorkflowGraph,
  startRun,
  type RunFixture,
} from "../../helpers/run.ts";
import type { WorkflowGraph } from "../../../src/components/workflow/index.ts";

let ctx: TestContext;

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

function graphWithSplit(expertId: string): WorkflowGraph {
  return {
    stages: [{ id: "s1", name: "设计" }],
    nodes: [
      { id: "n1", type: "start", name: "开始", stageId: "s1", expertId },
      { id: "n2", type: "split", name: "拆分", stageId: "s1", expertId },
      { id: "n3", type: "end", name: "结束", stageId: "s1", expertId },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
    ],
  };
}

function graphNoStart(expertId: string): WorkflowGraph {
  const graph = graphLinear(expertId);
  graph.nodes[0] = { ...graph.nodes[0]!, type: "agent", name: "伪开始" };
  return graph;
}

function graphMultiStart(expertId: string): WorkflowGraph {
  return {
    stages: [{ id: "s1", name: "设计" }],
    nodes: [
      { id: "n1", type: "start", name: "开始一", stageId: "s1", expertId },
      { id: "n2", type: "start", name: "开始二", stageId: "s1", expertId },
      { id: "n3", type: "end", name: "结束", stageId: "s1", expertId },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n3", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
    ],
  };
}

function graphMissingExpert(expertId: string): WorkflowGraph {
  const graph = graphLinear(expertId);
  graph.nodes[1] = { ...graph.nodes[1]!, expertId: "0191f2f0-0000-7000-8000-00000000dead" };
  return graph;
}

async function expectRejected(
  fixture: RunFixture,
  workspacePath: string,
  code: string,
): Promise<void> {
  const started = await startRun(ctx, fixture, { workspacePath, intentMarkdown: "非法图" });
  expect(started.status).toBe(400);
  expect(started.body.error.code).toBe(code);
  const runs = await listRuns(ctx, `?workflowId=${fixture.workflowId}`);
  expect(runs.body.total).toBe(0);
  expect(await ctx.instanceService.getByBinding(fixture.clientId, workspacePath)).toBeNull();
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

describe("SCN-0301 运行启动与节点推进", () => {
  test("TC-RUN-001 合法图启动：建 run、派发首节点并携带 task-space 与启动诉求", async () => {
    const fixture = await createRunFixture(ctx, graphLinear);
    const workspacePath = "/work/run-start";
    const started = await startRun(ctx, fixture, {
      workspacePath,
      intentMarkdown: "把需求实现成代码",
    });
    expect(started.status).toBe(201);
    const runId = started.body.runId as string;
    expect(started.headers.get("location")).toBe(`/api/v1/runs/${runId}`);

    const detail = await getRun(ctx, runId);
    expect(detail.status).toBe(200);
    expect(detail.body.state).toBe("running");
    expect(detail.body.currentNodeId).toBe("n1");
    expect(detail.body.workspacePath).toBe(workspacePath);
    expect(detail.body.taskSpacePath).toMatch(
      new RegExp(`^${workspacePath}/task-spaces/\\d{8}-\\d{6}$`),
    );
    expect(detail.body.nodes).toHaveLength(1);
    expect(detail.body.nodes[0]).toMatchObject({
      nodeId: "n1",
      nodeType: "start",
      visit: 1,
      state: "dispatched",
    });
    const firstTaskId = detail.body.nodes[0].taskId as string;
    expect(firstTaskId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const task = await nextTask(ctx, fixture.token);
    if (task === null) throw new Error("启动后没有派发任务");
    expect(task.taskId).toBe(firstTaskId);
    expect(task.instanceId).toBe(detail.body.instanceId);
    expect(task.nodeId).toBe("n1");
    expect(task.attempt).toBe(1);
    expect(task.taskSpacePath).toBe(detail.body.taskSpacePath);
    expect(task.prompt).toContain("把需求实现成代码");
    expect(task.prompt).toContain(detail.body.taskSpacePath);
  });

  test("TC-RUN-002 首节点成功结算后自动派发 seq 后继，run 保持 running", async () => {
    const fixture = await createRunFixture(ctx, graphLinear);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/run-advance" });
    const runId = started.body.runId as string;
    const task = (await nextTask(ctx, fixture.token))!;
    await completeNextTask(ctx, fixture.token, "首节点完成");

    const detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("running");
    const startNode = detail.body.nodes.find((node: any) => node.nodeId === "n1");
    const nextNode = detail.body.nodes.find((node: any) => node.nodeId === "n2");
    expect(startNode.state).toBe("succeeded");
    expect(startNode.message).toBe("首节点完成");
    expect(nextNode.state).toBe("dispatched");
    expect(nextNode.taskId).not.toBe(task.taskId);
  });

  test("TC-RUN-003 end 成功后 run=done(succeeded)，最终消息落库且不再派发任务", async () => {
    const fixture = await createRunFixture(ctx, graphLinear);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/run-end" });
    const runId = started.body.runId as string;
    await driveRun(ctx, fixture, runId, {
      messageOf: (task) => (task.nodeId === "n3" ? "最终结果" : `step-${task.nodeId}`),
    });

    const detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("done");
    expect(detail.body.outcome).toBe("succeeded");
    expect(detail.body.currentNodeId).toBe("n3");
    expect(detail.body.finalMessage).toBe("最终结果");
    expect(detail.body.nodes.filter((node: any) => node.nodeId === "n3")).toHaveLength(1);

    const polled = await nextTask(ctx, fixture.token);
    expect(polled).toBeNull();
  });

  test("TC-RUN-004 图非法（无 start / 多 start / 专家缺失 / 含 split）一律 400 且不建 run、不登记实例", async () => {
    const splitFixture = await createRunFixture(ctx, graphWithSplit);
    await expectRejected(splitFixture, "/work/invalid-split", "unsupported_node_type");

    const noStartFixture = await createRunFixture(ctx, graphLinear);
    await overwriteWorkflowGraph(ctx, noStartFixture.workflowId, graphNoStart(noStartFixture.expertId));
    await expectRejected(noStartFixture, "/work/invalid-no-start", "validation_error");

    const multiStartFixture = await createRunFixture(ctx, graphLinear);
    await overwriteWorkflowGraph(
      ctx,
      multiStartFixture.workflowId,
      graphMultiStart(multiStartFixture.expertId),
    );
    await expectRejected(multiStartFixture, "/work/invalid-multi-start", "validation_error");

    const missingExpertFixture = await createRunFixture(ctx, graphLinear);
    await overwriteWorkflowGraph(
      ctx,
      missingExpertFixture.workflowId,
      graphMissingExpert(missingExpertFixture.expertId),
    );
    await expectRejected(missingExpertFixture, "/work/invalid-expert", "validation_error");
  });

  test("启动请求字段校验：缺失 harnessId、空/超长 intent、非布尔 autoConfirm 均 400", async () => {
    const fixture = await createRunFixture(ctx, graphLinear);
    const workspacePath = "/work/request-validation";
    const base = {
      harnessId: fixture.harnessId,
      workspacePath,
      intentMarkdown: "正常诉求",
    };
    const cases: { name: string; body: Record<string, unknown> }[] = [
      { name: "缺 harnessId", body: { ...base, harnessId: undefined } },
      { name: "harnessId 非 UUID", body: { ...base, harnessId: "not-a-uuid" } },
      { name: "空 intent", body: { ...base, intentMarkdown: "   " } },
      { name: "超长 intent", body: { ...base, intentMarkdown: "x".repeat(262145) } },
      { name: "autoConfirm 非布尔", body: { ...base, autoConfirm: "true" } },
    ];
    for (const item of cases) {
      const response = await call(
        ctx.app,
        "POST",
        `/api/v1/workflows/${fixture.workflowId}/runs`,
        { body: item.body },
      );
      expect(response.status, item.name).toBe(400);
      expect(response.body.error.code, item.name).toBe("validation_error");
    }
    const runs = await listRuns(ctx, `?workflowId=${fixture.workflowId}`);
    expect(runs.body.total).toBe(0);
    expect(await ctx.instanceService.getByBinding(fixture.clientId, workspacePath)).toBeNull();
  });
});
