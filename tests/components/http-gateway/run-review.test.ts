import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";
import {
  completeNextTask,
  createRunFixture,
  getRun,
  gzipLog,
  nextTask,
  readSessionLog,
  reportTask,
  startRun,
  uploadSessionLog,
  driveRun,
} from "../../helpers/run.ts";
import type { WorkflowGraph } from "../../../src/components/workflow/index.ts";

let ctx: TestContext;

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

function verdictMessage(verdict: "pass" | "fail", reason = ""): string {
  return `审核意见如下：\n\n\`\`\`json\n{"verdict":"${verdict}","reason":"${reason}"}\n\`\`\`\n`;
}

async function driveToReview(
  fixture: Awaited<ReturnType<typeof createRunFixture>>,
  runId: string,
): Promise<void> {
  await completeNextTask(ctx, fixture.token, "step-n1");
  await completeNextTask(ctx, fixture.token, "step-n2");
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

describe("SCN-0302 判定、回退与会话日志", () => {
  test("TC-RUN-005 日志上传后可回读，重复上传按后到覆盖返回 created/unchanged/replaced", async () => {
    const fixture = await createRunFixture(ctx, graphReview);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/log-read" });
    const runId = started.body.runId as string;
    const task = (await nextTask(ctx, fixture.token))!;

    const first = gzipLog(['{"type":"message","text":"一"}', '{"type":"result"}']);
    const uploaded = await uploadSessionLog(ctx, fixture.token, task.taskId, 1, first);
    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toMatchObject({
      taskId: task.taskId,
      attempt: 1,
      bytes: first.byteLength,
      stored: "created",
    });

    const read = await readSessionLog(ctx, runId, "n1");
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("application/x-ndjson");
    expect(read.headers.get("content-encoding")).toBe("gzip");
    expect(read.headers.get("content-length")).toBe(String(first.byteLength));
    expect(read.headers.get("x-checksum-sha256")).toBe(uploaded.body.sha256);
    const bytes = new Uint8Array(await read.arrayBuffer());
    expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe(
      '{"type":"message","text":"一"}\n{"type":"result"}\n',
    );

    const again = await uploadSessionLog(ctx, fixture.token, task.taskId, 1, first);
    expect(again.status).toBe(200);
    expect(again.body.stored).toBe("unchanged");

    const second = gzipLog(['{"type":"message","text":"二"}']);
    const replaced = await uploadSessionLog(ctx, fixture.token, task.taskId, 1, second);
    expect(replaced.status).toBe(200);
    expect(replaced.body.stored).toBe("replaced");
    const reread = await readSessionLog(ctx, runId, "n1", "?visit=1&attempt=1");
    expect(reread.status).toBe(200);
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await reread.arrayBuffer())))).toBe(
      '{"type":"message","text":"二"}\n',
    );
  });

  test("TC-RUN-006 review 返回 pass 继续 seq，返回 fail 沿回退边以 visit+1 重跑目标", async () => {
    const passFixture = await createRunFixture(ctx, graphReview);
    const passRun = await startRun(ctx, passFixture, { workspacePath: "/work/review-pass" });
    await driveToReview(passFixture, passRun.body.runId);
    const passTask = (await nextTask(ctx, passFixture.token))!;
    expect(passTask.nodeId).toBe("n3");
    await uploadSessionLog(ctx, passFixture.token, passTask.taskId, 1);
    const passed = await reportTask(
      ctx,
      passFixture.token,
      passTask,
      "succeeded",
      verdictMessage("pass", "可以"),
    );
    expect(passed.status).toBe(200);
    let detail = await getRun(ctx, passRun.body.runId);
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n3").state).toBe("succeeded");
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n3").verdict).toMatchObject({
      verdict: "pass",
    });
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n4").state).toBe("dispatched");
    expect(detail.body.state).toBe("running");

    const failFixture = await createRunFixture(ctx, graphReview);
    const failRun = await startRun(ctx, failFixture, { workspacePath: "/work/review-fail" });
    await driveToReview(failFixture, failRun.body.runId);
    const failTask = (await nextTask(ctx, failFixture.token))!;
    await uploadSessionLog(ctx, failFixture.token, failTask.taskId, 1);
    const failed = await reportTask(
      ctx,
      failFixture.token,
      failTask,
      "succeeded",
      verdictMessage("fail", "需要修改"),
    );
    expect(failed.status).toBe(200);
    detail = await getRun(ctx, failRun.body.runId);
    const reviews = detail.body.nodes.filter((node: any) => node.nodeId === "n3");
    expect(reviews).toHaveLength(2);
    expect(reviews.find((node: any) => node.visit === 1).state).toBe("rejected");
    expect(reviews.find((node: any) => node.visit === 2).state).toBe("queued");
    const agents = detail.body.nodes.filter((node: any) => node.nodeId === "n2");
    expect(agents).toHaveLength(2);
    expect(agents.find((node: any) => node.visit === 2).state).toBe("dispatched");
    expect(detail.body.state).toBe("running");
  });

  test("TC-RUN-007 回退轮次用尽后 run.failed(visit_limit_exceeded)，不再派发新任务", async () => {
    const fixture = await createRunFixture(ctx, graphReview);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/visit-limit" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");
    await completeNextTask(ctx, fixture.token, "n2");

    let lastReport: Awaited<ReturnType<typeof reportTask>> | null = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const reviewTask = (await nextTask(ctx, fixture.token))!;
      expect(reviewTask.nodeId).toBe("n3");
      await uploadSessionLog(ctx, fixture.token, reviewTask.taskId, 1);
      lastReport = await reportTask(
        ctx,
        fixture.token,
        reviewTask,
        "succeeded",
        verdictMessage("fail", `第 ${attempt} 次不通过`),
      );
      if ((await getRun(ctx, runId)).body.state === "done") break;
      await completeNextTask(ctx, fixture.token, `n2-${attempt}`);
    }

    const detail = await getRun(ctx, runId);
    expect(detail.body.state).toBe("done");
    expect(detail.body.outcome).toBe("failed");
    expect(detail.body.error.code).toBe("visit_limit_exceeded");
    expect(lastReport?.status).toBe(200);
    expect(await nextTask(ctx, fixture.token)).toBeNull();
  });

  test("TC-RUN-008 缺日志报结果 409 且不结算；补传后成功；verdict 非法使节点与 run 失败", async () => {
    const fixture = await createRunFixture(ctx, graphReview);
    const started = await startRun(ctx, fixture, { workspacePath: "/work/log-missing" });
    const runId = started.body.runId as string;
    await completeNextTask(ctx, fixture.token, "n1");
    const task = (await nextTask(ctx, fixture.token))!;
    const rejected = await reportTask(ctx, fixture.token, task, "succeeded", "没有日志");
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("session_log_missing");
    let detail = await getRun(ctx, runId);
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n2").state).toBe("dispatched");

    await uploadSessionLog(ctx, fixture.token, task.taskId, 1);
    const retried = await reportTask(ctx, fixture.token, task, "succeeded", "补传后成功");
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({ taskId: task.taskId, accepted: true });
    detail = await getRun(ctx, runId);
    expect(detail.body.nodes.find((node: any) => node.nodeId === "n2").state).toBe("succeeded");

    const badFixture = await createRunFixture(ctx, graphReview);
    const badRun = await startRun(ctx, badFixture, { workspacePath: "/work/verdict-invalid" });
    await driveRun(ctx, badFixture, badRun.body.runId, { steps: 2 });
    const reviewTask = (await nextTask(ctx, badFixture.token))!;
    await uploadSessionLog(ctx, badFixture.token, reviewTask.taskId, 1);
    const badReport = await reportTask(ctx, badFixture.token, reviewTask, "succeeded", "没有 verdict");
    expect(badReport.status).toBe(200);
    const badDetail = await getRun(ctx, badRun.body.runId);
    expect(badDetail.body.outcome).toBe("failed");
    expect(badDetail.body.error.code).toBe("verdict_invalid");
    expect(badDetail.body.nodes.find((node: any) => node.nodeId === "n3").state).toBe("failed");
  });
});
