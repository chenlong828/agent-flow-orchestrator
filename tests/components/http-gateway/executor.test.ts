import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, callRaw, createTestContext, type TestContext } from "../../helpers/app.ts";

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
const nextInstanceId = uuidFactory("0191f2f0-7777");

async function bindNode(clientId: string): Promise<string> {
  const created = await ctx.harnessService.create({
    name: `node-${clientId}`,
    kind: "container",
    address: "10.0.4.11:7801",
    accessMode: "agent",
    concurrencyMax: 4,
    queuePolicy: "fifo",
  });
  const token = `token-${clientId}`;
  await ctx.harnessService.bindClient(created.id, 1, { clientId, token });
  return token;
}

async function enroll(clientId: string): Promise<string> {
  const instanceId = nextInstanceId();
  await ctx.instanceService.enroll({ instanceId, clientId, workspacePath: `/work/${instanceId}` });
  return instanceId;
}

async function createSkill(name: string): Promise<string> {
  const skill = await ctx.skillService.create({
    name,
    categoryCode: "coding",
    description: "执行面路由测试技能",
  });
  return skill.id;
}

const PROTOCOL = { "x-executor-protocol": "2" } as const;

function exec(token: string, headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, ...PROTOCOL, authorization: `Bearer ${token}` };
}

async function enqueueOne(clientId: string, instanceId: string, skillId: string, prompt = "执行面任务") {
  const result = await ctx.scheduler.enqueue({
    tasks: [{ instanceId, nodeId: "n1", prompt, timeoutMs: 1800000, skillIds: [skillId] }],
  });
  return result.taskIds[0]!;
}

describe("执行面协议与凭据闸门", () => {
  test("TC-EXV-001 版本 2 + 有效 Bearer 可访问三个端点并回显 X-Request-Id", async () => {
    const clientId = "exec-gate-ok";
    const token = await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("闸门技能");
    await enqueueOne(clientId,instanceId, skillId);

    const polled = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: exec(token, { "x-request-id": "req-1" }),
      body: { capacity: { free: 1 }, running: [], finished: [] },
    });
    expect(polled.status).toBe(200);
    expect(polled.headers.get("x-request-id")).toBe("req-1");
    expect(polled.body.tasks).toHaveLength(1);
    const taskId = polled.body.tasks[0].taskId as string;
    expect(polled.body.tasks[0].skillSet.packages[0].downloadUrl).toBe(
      `/api/v1/executor/skill-packages/${skillId}.1`,
    );

    const result = await call(ctx.app, "POST", `/api/v1/executor/tasks/${taskId}/result`, {
      headers: exec(token),
      body: {
        taskId,
        attempt: 1,
        status: "succeeded",
        message: "完成",
        truncated: false,
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 2 },
        error: null,
      },
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ taskId, accepted: true });

    const pkg = await callRaw(
      ctx.app,
      "GET",
      `/api/v1/executor/skill-packages/${skillId}.1`,
      { headers: exec(token) },
    );
    expect(pkg.status).toBe(200);
    expect(pkg.headers.get("x-checksum-sha256")).toMatch(/^[0-9a-f]{64}$/);
    expect(pkg.headers.get("etag")).toContain("sha256-");
  });

  test("TC-EXV-002 版本不匹配 400 unsupported_protocol；未知请求字段 400 validation_error", async () => {
    const clientId = "exec-gate-version";
    const token = await bindNode(clientId);
    const body = { capacity: { free: 0 }, running: [], finished: [] };

    const variants: Record<string, string>[] = [
      { authorization: `Bearer ${token}` },
      { authorization: `Bearer ${token}`, "x-executor-protocol": "1" },
      { authorization: `Bearer ${token}`, "x-executor-protocol": '"2"' },
    ];
    for (const headers of variants) {
      const response = await call(ctx.app, "POST", "/api/v1/executor/poll", { headers, body });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("unsupported_protocol");
    }

    const unknownField = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: exec(token),
      body: { ...body, extra: true },
    });
    expect(unknownField.status).toBe(400);
    expect(unknownField.body.error.code).toBe("validation_error");
  });

  test("TC-EXV-003 缺失或无效 Bearer 返回 401，响应不含凭据", async () => {
    const missing = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: { "x-executor-protocol": "2" },
      body: { capacity: { free: 0 }, running: [], finished: [] },
    });
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("unauthorized");

    const invalid = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: exec("not-a-token"),
      body: { capacity: { free: 0 }, running: [], finished: [] },
    });
    expect(invalid.status).toBe(401);
    expect(JSON.stringify(invalid.body)).not.toContain("not-a-token");
  });

  test("TC-EXV-004 结果体超过 262144 字节返回 413，任务不结算", async () => {
    const clientId = "exec-gate-large";
    const token = await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("超限技能");
    const taskId = await enqueueOne(clientId, instanceId, skillId);
    await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: exec(token),
      body: { capacity: { free: 1 }, running: [], finished: [] },
    });

    const large = await call(ctx.app, "POST", `/api/v1/executor/tasks/${taskId}/result`, {
      headers: exec(token),
      body: {
        taskId,
        attempt: 1,
        status: "succeeded",
        message: "x".repeat(270000),
        truncated: false,
        stopReason: null,
        usage: null,
        error: null,
      },
    });
    expect(large.status).toBe(413);
    expect(large.body.error.code).toBe("payload_too_large");
    expect((await ctx.scheduler.inspect(taskId)).state).toBe("dispatched");
  });
});

describe("执行面制品供给", () => {
  test("TC-EXK-001 下载 zip 带长度、ETag 与 sha256，字节与任务快照一致", async () => {
    const clientId = "exec-pkg-ok";
    const token = await bindNode(clientId);
    const instanceId = await enroll(clientId);
    const skillId = await createSkill("制品下载");
    const taskId = await enqueueOne(clientId, instanceId, skillId);
    const polled = await call(ctx.app, "POST", "/api/v1/executor/poll", {
      headers: exec(token),
      body: { capacity: { free: 1 }, running: [], finished: [] },
    });
    const packages = polled.body.tasks[0].skillSet.packages as {
      packageId: string;
      digest: string;
      sizeBytes: number;
    }[];
    const item = packages[0]!;

    const response = await callRaw(
      ctx.app,
      "GET",
      `/api/v1/executor/skill-packages/${item.packageId}`,
      { headers: exec(token) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(Number(response.headers.get("content-length"))).toBe(item.sizeBytes);
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(response.headers.get("x-checksum-sha256")).toBe(item.digest.replace(/^sha256:/, ""));

    const bytes = await response.arrayBuffer();
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
    expect(digest).toBe(item.digest.replace(/^sha256:/, ""));
    expect(await ctx.scheduler.inspect(taskId)).toMatchObject({ state: "dispatched" });
  });

  test("TC-EXK-002 If-None-Match 命中返回 304；不同包 ETag 不同", async () => {
    const clientId = "exec-pkg-etag";
    const token = await bindNode(clientId);
    const instanceId = await enroll(clientId);

    const first = await createSkill("ETag 一");
    const firstRef = await ctx.packages.currentForSkill(first);
    const notModified = await call(
      ctx.app,
      "GET",
      `/api/v1/executor/skill-packages/${firstRef.packageId}`,
      { headers: exec(token, { "if-none-match": firstRef.etag }) },
    );
    expect(notModified.status).toBe(304);

    const full = await callRaw(
      ctx.app,
      "GET",
      `/api/v1/executor/skill-packages/${firstRef.packageId}`,
      { headers: exec(token) },
    );
    expect(full.status).toBe(200);

    const second = await createSkill("ETag 二");
    const secondRef = await ctx.packages.currentForSkill(second);
    expect(secondRef.etag).not.toBe(firstRef.etag);
    void instanceId;
  });

  test("TC-EXK-003 未知 packageId 返回 404 package_not_found", async () => {
    const clientId = "exec-pkg-missing";
    const token = await bindNode(clientId);
    const response = await call(
      ctx.app,
      "GET",
      "/api/v1/executor/skill-packages/0191f2f0-8888-7000-8000-000000000001.9",
      { headers: exec(token) },
    );
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("package_not_found");
  });

  test("TC-EXK-004 Skill 升级后旧 packageId 返回 404，新包摘要变化", async () => {
    const clientId = "exec-pkg-upgrade";
    const token = await bindNode(clientId);
    const skillId = await createSkill("升级制品");
    const before = await ctx.packages.currentForSkill(skillId);

    const draft = await ctx.skillDraftService.createDraft(skillId);
    await ctx.skillDraftService.saveDraft(draft.id, 1, {
      name: "升级制品",
      categoryCode: "coding",
      description: "执行面路由测试技能",
      body: "## 新版本\n\n内容",
    });
    const after = await ctx.packages.currentForSkill(skillId);
    expect(after.digest).not.toBe(before.digest);

    const stale = await call(ctx.app, "GET", `/api/v1/executor/skill-packages/${before.packageId}`, {
      headers: exec(token),
    });
    expect(stale.status).toBe(404);

    const fresh = await callRaw(
      ctx.app,
      "GET",
      `/api/v1/executor/skill-packages/${after.packageId}`,
      { headers: exec(token) },
    );
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("etag")).not.toBe(before.etag);
  });
});
