import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, type TestContext } from "../../helpers/app.ts";
import {
  completeNextTask,
  createRunFixture,
  getRun,
  nextTask,
  reportTask,
  startRun,
  uploadSessionLog,
} from "../../helpers/run.ts";
import type { WorkflowGraph } from "../../../src/components/workflow/index.ts";

let ctx: TestContext;

function graphAgent(expertId: string): WorkflowGraph {
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

function decide(runId: string, nodeId: string, decision: "pass" | "reject", comment?: string) {
  return call(ctx.app, "POST", `/api/v1/runs/${runId}/nodes/${nodeId}/decision`, {
    body: { decision, ...(comment === undefined ? {} : { comment }) },
  });
}

function resumeNode(runId: string, nodeId: string) {
  return call(ctx.app, "POST", `/api/v1/runs/${runId}/nodes/${nodeId}/resume`);
}

function reviewSignal(verdict: "pass" | "fail", reason: string) {
  return [{
    seq: 1,
    at: "2026-11-18T00:00:00.000Z",
    kind: "review_verdict" as const,
    data: { verdict, reason },
  }];
}

function confirmationSignal(question: string, comment: string) {
  return [{
    seq: 1,
    at: "2026-11-18T00:00:00.000Z",
    kind: "confirmation_request" as const,
    data: { question, context: comment, options: ["允许", "拒绝"] },
  }];
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

describe("执行面结果信号与确认点", () => {
  test("review 节点只认 review_verdict 信号，message 只作叙述", async () => {
    const fixture = await createRunFixture(ctx, graphReview);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/signal-review" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");
    await completeNextTask(ctx, fixture.token, "n2");

    const reviewTask = (await nextTask(ctx, fixture.token))!;
    expect(reviewTask.nodeId).toBe("n3");
    expect(reviewTask.resultSignal?.kind).toBe("review_verdict");
    expect(reviewTask.confirmation).toMatchObject({ kind: "confirmation_request", required: false });
    await uploadSessionLog(ctx, fixture.token, reviewTask.taskId, 1);
    const reported = await reportTask(ctx, fixture.token, reviewTask, "succeeded", "只有自然语言，没有 JSON", {
      sessionId: "session-review-signal",
      signals: reviewSignal("pass", "信号通过"),
    });
    expect(reported.status).toBe(200);

    let detail = await getRun(ctx, runId);
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n3").verdict).toMatchObject({
      verdict: "pass",
      reason: "信号通过",
    });
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n3").state).toBe("succeeded");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n4").state).toBe("dispatched");
  });

  test("review_verdict fail 走回退；信号非法时不再回退 message JSON", async () => {
    const fixture = await createRunFixture(ctx, graphReview);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/signal-review-fail" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");
    await completeNextTask(ctx, fixture.token, "n2");

    const reviewTask = (await nextTask(ctx, fixture.token))!;
    await uploadSessionLog(ctx, fixture.token, reviewTask.taskId, 1);
    await reportTask(ctx, fixture.token, reviewTask, "succeeded", "signal fail", {
      signals: reviewSignal("fail", "回退原因"),
    });
    let detail = await getRun(ctx, runId);
    const reviews = detail.body.nodes.filter((node: any) => node.nodeId === "n3");
    expect(reviews.find((node: any) => node.visit === 1).state).toBe("rejected");
    expect(reviews.find((node: any) => node.visit === 2).state).toBe("queued");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n2" && node.visit === 2).state).toBe("dispatched");

    // 信号非法但 message 合法：不再解析 message，节点与 run 失败。
    await completeNextTask(ctx, fixture.token, "n2-again");
    const reviewAgain = (await nextTask(ctx, fixture.token))!;
    await uploadSessionLog(ctx, fixture.token, reviewAgain.taskId, 1);
    await reportTask(ctx, fixture.token, reviewAgain, "succeeded", '{"verdict":"pass","reason":"message 通过"}', {
      signals: [{ seq: 1, at: "2026-11-18T00:00:00.000Z", kind: "review_verdict", data: { verdict: "bogus" } }],
    });
    detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("done");
    expect(detail.body.outcome).toBe("failed");
    expect(detail.body.error.code).toBe("verdict_invalid");
    expect(detail.body.nodes.filter((node: any) => node.nodeId === "n3").at(-1).state).toBe("failed");
  });

  test("agent 的 confirmation_request 暂停在 waiting_confirm，pass 用 resumeSessionId 续跑同一节点", async () => {
    const fixture = await createRunFixture(ctx, graphAgent);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/signal-confirm" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");

    const agentTask = (await nextTask(ctx, fixture.token))!;
    expect(agentTask.nodeId).toBe("n2");
    expect(agentTask.resultSignal?.kind).toBe("confirmation_request");
    expect(agentTask.confirmation).toBeUndefined();
    await uploadSessionLog(ctx, fixture.token, agentTask.taskId, 1);
    const paused = await reportTask(ctx, fixture.token, agentTask, "succeeded", "需要人确认", {
      sessionId: "session-confirm-1",
      signals: confirmationSignal("是否允许修改契约？", "需要你拍板"),
    });
    expect(paused.status).toBe(200);

    let detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("waiting_confirm");
    expect(detail.body.currentNodeId).toBe("n2");
    const waiting = detail.body.nodes.find((node: any) => node.nodeId === "n2");
    expect(waiting.state).toBe("waiting_confirm");
    expect(waiting.verdict).toMatchObject({ kind: "confirmation_request", question: "是否允许修改契约？" });
    expect(await nextTask(ctx, fixture.token)).toBeNull();

    const passed = await decide(runId, "n2", "pass", "允许，按加法字段发布");
    expect(passed.status).toBe(200);
    expect(passed.body.state).toBe("running");

    const continuation = (await nextTask(ctx, fixture.token))!;
    expect(continuation.nodeId).toBe("n2");
    expect(continuation.resumeSessionId).toBe("session-confirm-1");
    expect(continuation.taskId).not.toBe(agentTask.taskId);
    expect(continuation.prompt).toContain("[人工确认]");
    expect(continuation.prompt).toContain("允许，按加法字段发布");

    detail = await getRun(ctx, runId);
    const continued = detail.body.nodes.find((node: any) => node.nodeId === "n2");
    expect(continued.state).toBe("dispatched");
    expect(continued.taskId).toBe(continuation.taskId);
    expect(continued.visit).toBe(1);
    expect(continued.sessionId).toBeUndefined();

    await uploadSessionLog(ctx, fixture.token, continuation.taskId, 1);
    await reportTask(ctx, fixture.token, continuation, "succeeded", "继续完成");
    detail = await getRun(ctx, runId);
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n2").state).toBe("succeeded");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n3").state).toBe("dispatched");
  });

  test("confirmation_request 的 reject 也续跑同一节点，把拒绝意见带回模型", async () => {
    const fixture = await createRunFixture(ctx, graphAgent);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/signal-confirm-reject" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");

    const agentTask = (await nextTask(ctx, fixture.token))!;
    await uploadSessionLog(ctx, fixture.token, agentTask.taskId, 1);
    await reportTask(ctx, fixture.token, agentTask, "succeeded", "需要人确认", {
      sessionId: "session-confirm-reject",
      signals: confirmationSignal("是否允许删除表？", "删除不可逆"),
    });

    const rejected = await decide(runId, "n2", "reject", "不允许删除，改用软删除");
    expect(rejected.status).toBe(200);
    expect(rejected.body.state).toBe("running");

    const continuation = (await nextTask(ctx, fixture.token))!;
    expect(continuation.resumeSessionId).toBe("session-confirm-reject");
    expect(continuation.prompt).toContain("人工决定：拒绝");
    expect(continuation.prompt).toContain("不允许删除，改用软删除");

    const detail = await getRun(ctx, runId);
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n2").state).toBe("dispatched");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n2").visit).toBe(1);
  });
});

describe("review 节点的应急确认", () => {
  test("review 确认后 waiting_confirm；pass 续跑同一 session，评审仍自行提交 verdict", async () => {
    const fixture = await createRunFixture(ctx, graphReview);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/review-confirm-pass" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");
    await completeNextTask(ctx, fixture.token, "n2");

    const reviewTask = (await nextTask(ctx, fixture.token))!;
    expect(reviewTask.nodeId).toBe("n3");
    expect(reviewTask.confirmation).toMatchObject({ kind: "confirmation_request", required: false });
    await uploadSessionLog(ctx, fixture.token, reviewTask.taskId, 1);
    const paused = await reportTask(ctx, fixture.token, reviewTask, "succeeded", "需要澄清契约口径", {
      sessionId: "session-review-confirm-pass",
      signals: confirmationSignal("口径按 A 还是 B 解读？", "两种解读都成立，直接决定 verdict"),
    });
    expect(paused.status).toBe(200);

    let detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("waiting_confirm");
    const waiting = detail.body.nodes.find((node: any) => node.nodeId === "n3");
    expect(waiting.state).toBe("waiting_confirm");
    expect(waiting.verdict).toMatchObject({
      kind: "confirmation_request",
      question: "口径按 A 还是 B 解读？",
    });
    expect(waiting.verdict.verdict).toBeUndefined();
    expect(await nextTask(ctx, fixture.token)).toBeNull();

    const passed = await decide(runId, "n3", "pass", "按 A 解读");
    expect(passed.status).toBe(200);
    expect(passed.body.state).toBe("running");

    const continuation = (await nextTask(ctx, fixture.token))!;
    expect(continuation.nodeId).toBe("n3");
    expect(continuation.resumeSessionId).toBe("session-review-confirm-pass");
    expect(continuation.prompt).toContain("[人工确认]");
    expect(continuation.prompt).toContain("按 A 解读");
    expect(continuation.resultSignal?.kind).toBe("review_verdict");
    expect(continuation.confirmation?.kind).toBe("confirmation_request");

    await uploadSessionLog(ctx, fixture.token, continuation.taskId, 1);
    await reportTask(ctx, fixture.token, continuation, "succeeded", "评审完成", {
      signals: reviewSignal("pass", "口径已按 A 澄清"),
    });
    detail = await getRun(ctx, runId);
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n3").state).toBe("succeeded");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n4").state).toBe("dispatched");
  });

  test("review 确认的 reject 只作评审输入：续跑后 verdict fail 仍按回退边推进", async () => {
    const fixture = await createRunFixture(ctx, graphReview);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/review-confirm-reject" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");
    await completeNextTask(ctx, fixture.token, "n2");

    const reviewTask = (await nextTask(ctx, fixture.token))!;
    await uploadSessionLog(ctx, fixture.token, reviewTask.taskId, 1);
    await reportTask(ctx, fixture.token, reviewTask, "succeeded", "需要澄清契约口径", {
      sessionId: "session-review-confirm-reject",
      signals: confirmationSignal("证据文件以哪一版为准？", "没有它无法判定"),
    });

    const rejected = await decide(runId, "n3", "reject", "以第二版为准");
    expect(rejected.status).toBe(200);
    const continuation = (await nextTask(ctx, fixture.token))!;
    expect(continuation.resumeSessionId).toBe("session-review-confirm-reject");
    expect(continuation.prompt).toContain("人工决定：拒绝");
    expect(continuation.prompt).toContain("以第二版为准");

    await uploadSessionLog(ctx, fixture.token, continuation.taskId, 1);
    await reportTask(ctx, fixture.token, continuation, "succeeded", "评审完成", {
      signals: reviewSignal("fail", "第二版缺少测试结论"),
    });
    const detail = await getRun(ctx, runId);
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n3" && node.visit === 1).state).toBe("rejected");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n2" && node.visit === 2).state).toBe("dispatched");
  });

  test("review 同时回 confirm 与 verdict 时确认优先：先暂停，不结算 verdict", async () => {
    const fixture = await createRunFixture(ctx, graphReview);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/review-confirm-both" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");
    await completeNextTask(ctx, fixture.token, "n2");

    const reviewTask = (await nextTask(ctx, fixture.token))!;
    await uploadSessionLog(ctx, fixture.token, reviewTask.taskId, 1);
    await reportTask(ctx, fixture.token, reviewTask, "succeeded", "先确认再判定", {
      sessionId: "session-review-confirm-both",
      signals: [
        {
          seq: 1,
          at: "2026-11-18T00:00:00.000Z",
          kind: "confirmation_request" as const,
          data: { question: "口径按 A 还是 B？" },
        },
        {
          seq: 2,
          at: "2026-11-18T00:00:01.000Z",
          kind: "review_verdict" as const,
          data: { verdict: "pass", reason: "提前给出的结论" },
        },
      ],
    });

    const detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("waiting_confirm");
    const node = detail.body.nodes.find((item: any) => item.nodeId === "n3" && item.visit === 1);
    expect(node.state).toBe("waiting_confirm");
    expect(node.verdict).toMatchObject({ kind: "confirmation_request", question: "口径按 A 还是 B？" });
    expect(node.verdict.verdict).toBeUndefined();
    expect(detail.body.nodes.find((item: any) => item.nodeId === "n4")).toBeUndefined();
  });

  test("review 确认无答复保持 waiting_confirm，不自动 pass；取消后不产生 verdict", async () => {
    const fixture = await createRunFixture(ctx, graphReview);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/review-confirm-cancel" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");
    await completeNextTask(ctx, fixture.token, "n2");

    const reviewTask = (await nextTask(ctx, fixture.token))!;
    await uploadSessionLog(ctx, fixture.token, reviewTask.taskId, 1);
    await reportTask(ctx, fixture.token, reviewTask, "succeeded", "需要澄清契约口径", {
      sessionId: "session-review-confirm-cancel",
      signals: confirmationSignal("口径按 A 还是 B 解读？", "两种解读都成立"),
    });

    const detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("waiting_confirm");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n3").state).toBe("waiting_confirm");
    expect(await nextTask(ctx, fixture.token)).toBeNull();

    const cancelled = await call(ctx.app, "POST", `/api/v1/runs/${runId}/cancel`, { body: {} });
    expect(cancelled.status).toBe(200);
    const after = await getRun(ctx, runId);
    expect(after.body.state).toBe("done");
    expect(after.body.outcome).toBe("cancelled");
    const node = after.body.nodes.find((node: any) => node.nodeId === "n3" && node.visit === 1);
    expect(node.state).toBe("failed");
    expect(node.error.code).toBe("cancelled");
    expect(node.verdict).toBeNull();
    expect(await nextTask(ctx, fixture.token)).toBeNull();
  });
});

describe("超时节点继续跑", () => {
  test("TC-RUN-018 agent 超时进入 waiting_resume；resume 用同一 taskId 的下一 attempt 继续", async () => {
    const fixture = await createRunFixture(ctx, graphAgent);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/timeout-resume" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");

    const agentTask = (await nextTask(ctx, fixture.token))!;
    expect(agentTask.nodeId).toBe("n2");
    await uploadSessionLog(ctx, fixture.token, agentTask.taskId, 1);
    const reported = await reportTask(ctx, fixture.token, agentTask, "timeout", "执行超时", {
      sessionId: "session-timeout-resume",
    });
    expect(reported.status).toBe(200);

    let detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("waiting_resume");
    const waiting = detail.body.nodes.find((node: any) => node.nodeId === "n2");
    expect(waiting.state).toBe("waiting_resume");
    expect(waiting.finishedAt).toBeNull();
    expect(waiting.taskId).toBe(agentTask.taskId);
    expect(await nextTask(ctx, fixture.token)).toBeNull();

    const resumed = await resumeNode(runId, "n2");
    expect(resumed.status).toBe(200);
    expect(resumed.body.state).toBe("running");

    const continuation = (await nextTask(ctx, fixture.token))!;
    expect(continuation.taskId).toBe(agentTask.taskId);
    expect(continuation.attempt).toBe(2);
    expect(continuation.resumeSessionId).toBe("session-timeout-resume");
    expect(continuation.prompt).toBe(agentTask.prompt);

    await uploadSessionLog(ctx, fixture.token, continuation.taskId, 2);
    const done = await reportTask(ctx, fixture.token, continuation, "succeeded", "继续完成");
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ taskId: agentTask.taskId, accepted: true });

    detail = await getRun(ctx, runId);
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n2").state).toBe("succeeded");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n3").state).toBe("dispatched");
  });
});
