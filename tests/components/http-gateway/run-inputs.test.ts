import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { call, callRaw, createTestContext, type TestContext } from "../../helpers/app.ts";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import {
  EXECUTOR_PROTOCOL,
  createRunFixture,
  getRun,
  listRuns,
  nextTask,
  pollWithCapabilities,
  startRun,
  uploadRunInput,
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

const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ),
);

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await resetBusinessData();
});

afterAll(async () => {
  await closeTestDb();
});

describe("API-57/58 与 run 初始资料读取", () => {
  test("上传、启动绑定、prompt 清单、产品与执行面读取", async () => {
    const fixture = await createRunFixture(ctx, graphLinear);
    await pollWithCapabilities(ctx, fixture.token);

    const first = await uploadRunInput(ctx, PNG, "01-界面.png");
    const second = await uploadRunInput(ctx, PNG, "02-界面.png");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.inputId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/);

    const started = await startRun(ctx, fixture, {
      workspacePath: "/work/http-inputs",
      intentMarkdown: "按图片实现",
      inputs: [{ inputId: first.body.inputId }, { inputId: second.body.inputId }],
    });
    expect(started.status).toBe(201);
    const runId = started.body.runId as string;

    const listed = await call(ctx.app, "GET", `/api/v1/runs/${runId}/inputs`);
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((item: any) => item.name)).toEqual(["01-界面.png", "02-界面.png"]);

    const content = await callRaw(ctx.app, "GET", `/api/v1/runs/${runId}/inputs/${first.body.inputId}/content`);
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(PNG);

    const task = await nextTask(ctx, fixture.token);
    if (task === null) throw new Error("启动后没有派发任务");
    expect(task.runId).toBe(runId);
    expect(task.prompt).toContain("[初始资料]");
    expect(task.prompt).toContain("01-界面.png");

    const executorList = await call(ctx.app, "GET", `/api/v1/executor/runs/${runId}/inputs`, {
      headers: { ...EXECUTOR_PROTOCOL, authorization: `Bearer ${fixture.token}` },
    });
    expect(executorList.status).toBe(200);
    expect(executorList.body.items.map((item: any) => item.downloadPath)).toEqual([
      `/runs/${runId}/inputs/${first.body.inputId}`,
      `/runs/${runId}/inputs/${second.body.inputId}`,
    ]);

    const downloaded = await callRaw(
      ctx.app,
      "GET",
      `/api/v1/executor/runs/${runId}/inputs/${first.body.inputId}`,
      { headers: { ...EXECUTOR_PROTOCOL, authorization: `Bearer ${fixture.token}` } },
    );
    expect(downloaded.status).toBe(200);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(PNG);
  });

  test("未声明能力时启动返回 client_unsupported，不建 run；暂存项可删除", async () => {
    const fixture = await createRunFixture(ctx, graphLinear);
    const uploaded = await uploadRunInput(ctx, PNG, "03-未声明.png");
    const started = await startRun(ctx, fixture, {
      workspacePath: "/work/http-unsupported",
      intentMarkdown: "x",
      inputs: [{ inputId: uploaded.body.inputId }],
    });
    expect(started.status).toBe(409);
    expect(started.body.error.code).toBe("client_unsupported");
    expect((await listRuns(ctx, `?workflowId=${fixture.workflowId}`)).body.total).toBe(0);
    const removed = await call(ctx.app, "DELETE", `/api/v1/run-inputs/${uploaded.body.inputId}`);
    expect(removed.status).toBe(204);
  });

  test("已绑定项 DELETE 返回 409；未知项 404", async () => {
    const fixture = await createRunFixture(ctx, graphLinear);
    await pollWithCapabilities(ctx, fixture.token);
    const uploaded = await uploadRunInput(ctx, PNG, "04-已绑定.png");
    const started = await startRun(ctx, fixture, {
      workspacePath: "/work/http-bound",
      intentMarkdown: "x",
      inputs: [{ inputId: uploaded.body.inputId }],
    });
    expect(started.status).toBe(201);
    const removed = await call(ctx.app, "DELETE", `/api/v1/run-inputs/${uploaded.body.inputId}`);
    expect(removed.status).toBe(409);
    expect(removed.body.error.code).toBe("invalid_state");

    const unknown = "0191f2f0-9999-7000-8000-000000000099";
    expect((await call(ctx.app, "DELETE", `/api/v1/run-inputs/${unknown}`)).status).toBe(404);
  });

  test("非图片上传被拒", async () => {
    const text = new TextEncoder().encode("not an image");
    const form = new FormData();
    form.append("file", new File([text], "a.txt", { type: "text/plain" }));
    const response = await ctx.app(
      new Request("http://127.0.0.1:3000/api/v1/run-inputs", { method: "POST", body: form }),
    );
    expect(response.status).toBe(400);

    const oversized = new FormData();
    oversized.append(
      "file",
      new File([new Uint8Array(9 * 1024 * 1024) as unknown as BlobPart], "big.png", { type: "image/png" }),
    );
    const tooLarge = await ctx.app(
      new Request("http://127.0.0.1:3000/api/v1/run-inputs", { method: "POST", body: oversized }),
    );
    expect(tooLarge.status).toBe(413);
  });
});
