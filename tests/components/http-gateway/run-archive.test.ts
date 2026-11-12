import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";
import {
  createRunFixture,
  driveRun,
  getRun,
  makeArchiveTar,
  pollExecutor,
  startRun,
  uploadArchive,
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

async function finishedRun(workspacePath: string) {
  const fixture = await createRunFixture(ctx, graphLinear);
  const started = await startRun(ctx, fixture, { workspacePath });
  const runId = started.body.runId as string;
  await driveRun(ctx, fixture, runId, { messageOf: (task) => `done-${task.nodeId}` });
  const detail = await getRun(ctx, runId);
  expect(detail.body.state).toBe("done");
  expect(detail.body.outcome).toBe("succeeded");
  expect(detail.body.archiveState).toBe("pending");
  return { fixture, runId, detail: detail.body };
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

describe("SCN-0304 运行归档", () => {
  test("TC-RUN-013 终态下发 archiveRequests，上传后 archivedRuns 确认并停止下发", async () => {
    const { fixture, runId, detail } = await finishedRun("/work/archive-ack");

    const polled = await pollExecutor(ctx, fixture.token);
    expect(polled.body.archiveRequests).toEqual([
      {
        runId,
        instanceId: detail.instanceId,
        workspacePath: detail.workspacePath,
        taskSpacePath: detail.taskSpacePath,
      },
    ]);

    const tar = await makeArchiveTar({ "intent.md": "任务" });
    const stored = await uploadArchive(ctx, fixture.token, runId, tar);
    expect(stored.status).toBe(200);
    expect(stored.body).toMatchObject({ runId, bytes: tar.byteLength, stored: "created" });
    expect((await getRun(ctx, runId)).body.archiveState).toBe("stored");

    const acked = await pollExecutor(ctx, fixture.token, { archivedRuns: [runId] });
    expect(acked.body.archiveRequests).toEqual([]);
    const after = await pollExecutor(ctx, fixture.token);
    expect(after.body.archiveRequests).toEqual([]);
  });

  test("TC-RUN-014 归档落到 history/<instanceId>/<runId>/，含 task-space.tar.gz 与各节点日志副本", async () => {
    const { fixture, runId, detail } = await finishedRun("/work/archive-layout");
    const tar = await makeArchiveTar({ "intent.md": "任务", "result.md": "结果" });
    const stored = await uploadArchive(ctx, fixture.token, runId, tar);
    expect(stored.status).toBe(200);

    const directory = join(ctx.archiveRoot, "history", detail.instanceId, runId);
    const archiveFile = Bun.file(join(directory, "task-space.tar.gz"));
    expect(await archiveFile.exists()).toBe(true);
    expect(Array.from(new Uint8Array(await archiveFile.arrayBuffer()))).toEqual(Array.from(tar));

    const logs = await readdir(join(directory, "logs"));
    expect(logs.sort()).toEqual([
      "n1-1-a1.jsonl.gz",
      "n2-1-a1.jsonl.gz",
      "n3-1-a1.jsonl.gz",
    ]);
    for (const name of logs) {
      expect(await Bun.file(join(directory, "logs", name)).exists()).toBe(true);
    }
  });

  test("TC-RUN-015 重复上传按后到覆盖，stored 区分 created/replaced/unchanged", async () => {
    const { fixture, runId } = await finishedRun("/work/archive-repeat");
    const tar = await makeArchiveTar({ "version.txt": "v1" });
    const created = await uploadArchive(ctx, fixture.token, runId, tar);
    expect(created.body.stored).toBe("created");

    const unchanged = await uploadArchive(ctx, fixture.token, runId, tar);
    expect(unchanged.body.stored).toBe("unchanged");

    const replacedTar = await makeArchiveTar({ "version.txt": "v2", "extra.md": "x" });
    const replaced = await uploadArchive(ctx, fixture.token, runId, replacedTar);
    expect(replaced.body.stored).toBe("replaced");

    const detail = await getRun(ctx, runId);
    expect(detail.body.archiveState).toBe("stored");
    const directory = join(ctx.archiveRoot, "history", detail.body.instanceId, runId);
    const files = await readdir(directory);
    expect(files.sort()).toEqual(["logs", "task-space.tar.gz"]);
    expect(
      Array.from(new Uint8Array(await Bun.file(join(directory, "task-space.tar.gz")).arrayBuffer())),
    ).toEqual(Array.from(replacedTar));
  });

  test("TC-RUN-016 未知 run/非本 client 404、损坏包 400、超限 413，均不落盘不改状态", async () => {
    const { fixture, runId, detail } = await finishedRun("/work/archive-invalid");
    const directory = join(ctx.archiveRoot, "history", detail.instanceId, runId);

    const unknown = await uploadArchive(
      ctx,
      fixture.token,
      crypto.randomUUID(),
      await makeArchiveTar(),
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("run_not_found");

    const other = await ctx.harnessService.create({
      name: `其它节点-${Date.now().toString(36)}`,
      kind: "container",
      address: "127.0.0.1:7801",
      accessMode: "agent",
      concurrencyMax: 1,
      queuePolicy: "fifo",
    });
    const otherClient = `other-client-${Date.now().toString(36)}`;
    await ctx.harnessService.bindClient(other.id, other.revision, {
      clientId: otherClient,
      token: `other-token-${otherClient}`,
    });
    const foreign = await uploadArchive(
      ctx,
      `other-token-${otherClient}`,
      runId,
      await makeArchiveTar(),
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("run_not_found");

    const corrupted = await uploadArchive(ctx, fixture.token, runId, new Uint8Array([1, 2, 3]));
    expect(corrupted.status).toBe(400);
    expect(corrupted.body.error.code).toBe("invalid_archive");

    const oversize = await ctx.app(
      new Request(`http://127.0.0.1:3000/api/v1/executor/runs/${runId}/archive`, {
        method: "POST",
        headers: {
          "x-executor-protocol": "3",
          authorization: `Bearer ${fixture.token}`,
          "content-type": "application/gzip",
          "content-length": String(512 * 1024 * 1024 + 1),
        },
        body: new Uint8Array([1, 2, 3]) as unknown as BodyInit,
      }),
    );
    expect(oversize.status).toBe(413);
    const oversizeBody = (await oversize.json()) as { error: { code: string } };
    expect(oversizeBody.error.code).toBe("payload_too_large");

    expect(await Bun.file(directory).exists()).toBe(false);
    expect((await getRun(ctx, runId)).body.archiveState).toBe("pending");
  });
});
