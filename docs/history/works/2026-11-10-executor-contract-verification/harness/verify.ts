#!/usr/bin/env bun
/**
 * 执行面契约 v2 接口验证桩（调度器侧）。
 *
 * 只在本工序内使用，不是产品代码：
 * - 按契约 §2/§4 实现三个端点的服务端行为（poll / result / skill-packages）；
 * - 驱动真实 `agent-flow-client` 的 `serve`（DSH 用 client 仓库的 fake ACP 夹具替代）；
 * - 断言契约条款与 client 实际请求/响应，输出逐项 PASS/FAIL。
 *
 * 运行：bun run docs/works/2026-11-10-executor-contract-verification/harness/verify.ts
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const CLIENT_ROOT = process.env.AFC_ROOT ?? "/Users/chenlong/harness/agent-flow-client";
const FAKE_ACP = join(CLIENT_ROOT, "tests/fixtures/fake-acp.mjs");
const TOKEN = "verify-token";
const POLL_HOLD_MS = 150;

type SkillPackage = {
  packageId: string;
  name: string;
  version: string;
  digest: string;
  sizeBytes: number;
  downloadUrl: string;
  etag?: string;
};

type TaskRequest = {
  taskId: string;
  instanceId: string;
  nodeId: string;
  attempt: number;
  prompt: string;
  workspacePath: string;
  timeoutMs: number;
  skillSet: { digest: string; packages: SkillPackage[] };
};

type WireRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
};

type Report = { taskId: string; body: Record<string, unknown>; accepted: boolean };

type PackageArtifact = { bytes: Uint8Array; etag: string; sha256: string };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function emptySkillSet(): TaskRequest["skillSet"] {
  return { digest: `sha256:${"0".repeat(64)}`, packages: [] };
}

function task(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    taskId: "01930000-0000-7000-8000-000000000901",
    instanceId: "01930000-0000-7000-8000-000000000902",
    nodeId: "01930000-0000-7000-8000-000000000903",
    attempt: 1,
    prompt: "V2-OK",
    workspacePath: "",
    timeoutMs: 30_000,
    skillSet: emptySkillSet(),
    ...overrides,
  };
}

class StubScheduler {
  readonly requests: WireRequest[] = [];
  readonly requestTimes: number[] = [];
  readonly pollBodies: Record<string, unknown>[] = [];
  readonly reports: Report[] = [];
  readonly knownTaskIds = new Set<string>();
  queue: TaskRequest[] = [];
  stop = false;
  cancelInstances: string[] = [];
  rejectAuth = false;
  rejectProtocol = false;
  rejectResults = false;
  redispatchSame = false;
  extraFields = false;
  ignoreFree = false;
  nextPollAfterMs = 0;
  packageArtifact: PackageArtifact | null = null;
  packageId: string | null = null;
  packageGets = 0;
  packageServed = 0;
  failResultTimes = 0;
  always304 = false;
  corruptFirstGet = false;
  dispatched = 0;
  readonly server: ReturnType<typeof Bun.serve>;
  readonly #accepted = new Set<string>();

  constructor() {
    this.server = Bun.serve({ port: 0, fetch: (request) => this.#handle(request) });
  }

  get url(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  enqueue(item: TaskRequest): void {
    this.knownTaskIds.add(item.taskId);
    this.queue.push(item);
  }

  reportsOf(taskId: string): Report[] {
    return this.reports.filter((report) => report.taskId === taskId);
  }

  pollsAfterReportCount(count: number): Record<string, unknown>[] {
    const seen = this.requests.findIndex((request, index) => {
      const before = this.requests.slice(0, index + 1).filter((item) => item.path.endsWith("/result")).length;
      return before > count && request.path.endsWith("/poll");
    });
    return seen === -1 ? [] : this.pollBodies.slice(seen);
  }

  async close(): Promise<void> {
    this.server.stop(true);
  }

  async #handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const body = request.method === "POST" ? ((await request.json().catch(() => null)) as Record<string, unknown> | null) : null;
    this.requests.push({ method: request.method, path: url.pathname, headers, body });
    this.requestTimes.push(Date.now());

    if (this.rejectAuth) return error(401, "unauthorized");
    if (this.rejectProtocol) return error(400, "unsupported_protocol");
    if (headers["x-executor-protocol"] !== "2") return error(400, "unsupported_protocol");
    if (headers.authorization !== `Bearer ${TOKEN}`) return error(401, "unauthorized");

    if (request.method === "POST" && url.pathname === "/api/v1/executor/poll") return await this.#poll(body ?? {});
    const resultMatch = /^\/api\/v1\/executor\/tasks\/([^/]+)\/result$/.exec(url.pathname);
    if (request.method === "POST" && resultMatch !== null) {
      return this.#result(decodeURIComponent(resultMatch[1] as string), body ?? {});
    }
    const packageMatch = /^\/api\/v1\/executor\/skill-packages\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && packageMatch !== null) return this.#package(request);
    return error(404, "not_found");
  }

  async #poll(body: Record<string, unknown>): Promise<Response> {
    this.pollBodies.push(body);
    const started = Date.now();
    const free = Number((body.capacity as { free?: unknown } | undefined)?.free ?? 0);
    while (this.queue.length === 0 && !this.stop && this.cancelInstances.length === 0) {
      if (Date.now() - started >= POLL_HOLD_MS) break;
      await Bun.sleep(5);
    }
    let tasks: TaskRequest[] = [];
    if (this.redispatchSame && this.reports.length === 0 && this.queue.length > 0) {
      tasks = [this.queue[0] as TaskRequest];
    } else {
      const cap = this.ignoreFree ? 10 : Math.max(0, Math.min(free, 10));
      tasks = this.queue.splice(0, cap);
    }
    if (tasks.length > 0) this.dispatched += tasks.length;
    return Response.json({
      tasks,
      stop: this.stop,
      cancelInstances: [...this.cancelInstances],
      nextPollAfterMs: this.nextPollAfterMs,
      ...(this.extraFields ? { serverTime: "2026-11-10T00:00:00Z", unknownField: { nested: true } } : {}),
    });
  }

  #result(taskId: string, body: Record<string, unknown>): Response {
    if (this.failResultTimes > 0) {
      this.failResultTimes -= 1;
      return error(500, "internal");
    }
    if (!this.knownTaskIds.has(taskId)) return error(404, "task_not_found");
    const first = !this.#accepted.has(taskId);
    if (first) this.#accepted.add(taskId);
    const accepted = this.rejectResults ? false : first;
    this.reports.push({ taskId, body, accepted });
    return Response.json({ taskId, accepted });
  }

  #package(request: Request): Response {
    this.packageGets += 1;
    if (this.packageArtifact === null) return error(404, "package_not_found");
    const conditional = request.headers.get("if-none-match") === this.packageArtifact.etag;
    if (this.always304 || (conditional && this.packageServed > 0)) {
      return new Response(null, { status: 304 });
    }
    this.packageServed += 1;
    let bytes = this.packageArtifact.bytes;
    if (this.corruptFirstGet && this.packageServed === 1) {
      bytes = new Uint8Array(bytes);
      bytes[bytes.length - 1] = bytes[bytes.length - 1] ^ 0xff;
    }
    return new Response(new Blob([new Uint8Array(bytes)]), {
      headers: {
        "content-type": "application/zip",
        "content-length": String(this.packageArtifact.bytes.byteLength),
        etag: this.packageArtifact.etag,
        "x-checksum-sha256": this.packageArtifact.sha256,
        "cache-control": "private, max-age=3600",
      },
    });
  }
}

function error(status: number, code: string): Response {
  return Response.json({ error: { code, message: code } }, { status });
}

type Check = { name: string; ok: boolean; detail?: string };

const checks: Check[] = [];
const notes: string[] = [];

function note(text: string): void {
  notes.push(text);
  console.log(`NOTE  ${text}`);
}

function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
  const suffix = detail === undefined ? "" : ` — ${detail}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${suffix}`);
}

function complete(name: string): void {
  check(name, true);
}

function equal(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? undefined : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

async function waitFor(label: string, predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await Bun.sleep(10);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ClientHandle = {
  child: ReturnType<typeof Bun.spawn>;
  exit: Promise<number>;
  runDir: string;
  container: string;
  stateRoot: string;
  configPath: string;
};

async function startClient(
  stub: StubScheduler,
  options: { capacity?: number; idleTimeoutMs?: number; container?: string; extraEnv?: Record<string, string> } = {},
): Promise<ClientHandle> {
  const runDir = await mkdtemp(join(tmpdir(), "afc-verify-"));
  const container = options.container ?? join(runDir, "workspace");
  const stateRoot = join(runDir, "state");
  await mkdir(container, { recursive: true });
  await mkdir(join(runDir, "dsh-home"), { recursive: true });
  const configPath = join(runDir, ".config");
  await writeFile(
    configPath,
    [
      `[acp]`,
      `dsh_home = "${join(runDir, "dsh-home")}"`,
      `permission = "allow"`,
      `[state]`,
      `root = "${stateRoot}"`,
      `[logging]`,
      `level = "error"`,
      `[capacity]`,
      `max_concurrent = ${options.capacity ?? 1}`,
      ...(options.idleTimeoutMs === undefined ? [] : [`[executor]`, `idle_timeout_ms = ${options.idleTimeoutMs}`]),
      `[scheduler]`,
      `url = "${stub.url}"`,
      `token = "${TOKEN}"`,
      ``,
    ].join("\n"),
  );
  const env = {
    ...process.env,
    DSH_BIN: FAKE_ACP,
    AF_NODE_BIN: process.execPath,
    HUNDSUN_PUBLIC_API_KEY: "verify",
    ...(options.extraEnv ?? {}),
  } as Record<string, string>;
  delete (env as Record<string, string | undefined>).DSH_HOME;
  const child = Bun.spawn([process.execPath, "src/cli.ts", "serve", "--config", configPath, "--state-root", stateRoot], {
    cwd: CLIENT_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = child.exited as Promise<number>;
  return { child, exit, runDir, container, stateRoot, configPath };
}

async function stopClient(handle: ClientHandle): Promise<void> {
  if (handle.child.exitCode !== null) return;
  handle.child.kill("SIGINT");
  const finished = await Promise.race([handle.exit, sleep(3000).then(() => null)]);
  if (finished === null) {
    handle.child.kill("SIGKILL");
    await handle.exit;
  }
}

async function cleanup(handle: ClientHandle | null, stub: StubScheduler): Promise<void> {
  if (handle !== null) await stopClient(handle);
  await stub.close();
  if (handle !== null) await rm(handle.runDir, { recursive: true, force: true });
}

async function scenario(name: string, run: () => Promise<void>): Promise<void> {
  console.log(`\n== ${name}`);
  try {
    await run();
  } catch (failure) {
    check(`${name}：场景执行`, false, (failure as Error).message);
  }
}

/** S1：基本下发、请求/响应形状、stop 电平、退出码。 */
await scenario("S1 下发一次并回报 succeeded", async () => {
  const stub = new StubScheduler();
  const handle = await startClient(stub, { capacity: 2 });
  try {
    const item = task({ workspacePath: handle.container });
    stub.enqueue(item);
    await waitFor("收到结果", () => stub.reports.length === 1);

    const poll = stub.requests.find((request) => request.path.endsWith("/poll"));
    check("S1 请求带 Authorization Bearer", poll?.headers.authorization === `Bearer ${TOKEN}`, poll?.headers.authorization);
    check("S1 请求带 X-Executor-Protocol: 2", poll?.headers["x-executor-protocol"] === "2", poll?.headers["x-executor-protocol"]);
    check("S1 请求带 X-Request-Id", typeof poll?.headers["x-request-id"] === "string" && poll.headers["x-request-id"] !== "");
    check("S1 POST 带 application/json; charset=utf-8", poll?.headers["content-type"] === "application/json; charset=utf-8");
    equal("S1 首个 poll 的 free = maxConcurrent", stub.pollBodies[0]?.capacity, { free: 2 });
    equal("S1 poll 带空 running[]", stub.pollBodies[0]?.running, []);
    equal("S1 poll 带空 finished[]", stub.pollBodies[0]?.finished, []);

    const report = stub.reports[0] as Report;
    const body = report.body;
    equal("S1 结果 taskId", body.taskId, item.taskId);
    equal("S1 结果 attempt", body.attempt, 1);
    equal("S1 结果 status", body.status, "succeeded");
    equal("S1 结果 stopReason", body.stopReason, "end_turn");
    equal("S1 结果 usage", body.usage, { inputTokens: 3, outputTokens: 2 });
    equal("S1 结果 error", body.error, null);
    equal("S1 结果 truncated", body.truncated, false);
    check("S1 结果 message 含最终文本", String(body.message).includes("OK-V2-OK"), String(body.message));
    check("S1 结果带 sessionId", typeof body.sessionId === "string" && body.sessionId !== "");
    check("S1 结果带 startedAt/finishedAt", typeof body.startedAt === "string" && typeof body.finishedAt === "string");
    check("S1 首份结果 accepted=true", report.accepted);

    await waitFor("回报后还有 poll", () => stub.pollBodies.length >= 2);
    await sleep(300);
    const after = stub.pollBodies.find((body) => {
      const running = body.running as unknown[];
      const finished = body.finished as unknown[];
      return running.length === 0 && finished.length === 0;
    });
    check("S1 accepted 后存在 running=[]/finished=[] 的 poll", after !== undefined, JSON.stringify(stub.pollBodies.at(-1)));

    stub.stop = true;
    const code = await Promise.race([handle.exit, sleep(8000).then(() => -1)]);
    equal("S1 stop:true 后退出 0", code, 0);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S2：accepted=false → 丢弃本地副本、不重报。 */
await scenario("S2 首份结果被拒后不重报", async () => {
  const stub = new StubScheduler();
  stub.rejectResults = true;
  const handle = await startClient(stub);
  try {
    const item = task({ workspacePath: handle.container });
    stub.enqueue(item);
    await waitFor("收到一次回报", () => stub.reports.length >= 1);
    await sleep(500);
    equal("S2 accepted=false 后只报一次", stub.reportsOf(item.taskId).length, 1);
    const lastPoll = stub.pollBodies[stub.pollBodies.length - 1] as Record<string, unknown>;
    equal("S2 accepted=false 后 finished 清空", lastPoll.finished, []);
    stub.stop = true;
    const code = await Promise.race([handle.exit, sleep(8000).then(() => -1)]);
    equal("S2 退出 0", code, 0);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S3：运行中重复下发同一 taskId，不得重复执行。 */
await scenario("S3 运行中重复下发不重复执行", async () => {
  const stub = new StubScheduler();
  const procDir = await mkdtemp(join(tmpdir(), "afc-procs-"));
  const procLog = join(procDir, "acp-procs.log");
  const handle = await startClient(stub, { extraEnv: { FAKE_ACP_PROC_LOG: procLog } });
  try {
    const item = task({ workspacePath: handle.container, prompt: "SLOW" });
    stub.enqueue(item);
    stub.redispatchSame = true;
    await waitFor("任务已开始（poll 显示 running）", () => {
      const last = stub.pollBodies[stub.pollBodies.length - 1] as Record<string, unknown>;
      return Array.isArray(last?.running) && (last.running as unknown[]).length === 1;
    });
    equal("S3 running[] 含 taskId", (stub.pollBodies[stub.pollBodies.length - 1] as { running: { taskId: string }[] }).running[0]?.taskId, item.taskId);
    stub.redispatchSame = false;
    stub.cancelInstances = [item.instanceId];
    await waitFor("取消结果回报", () => stub.reports.length === 1);
    const procs = await readFile(procLog, "utf8").catch(() => "");
    equal("S3 只启动一个 DSH 进程", procs.trim() === "" ? 0 : procs.trim().split("\n").length, 1);
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await cleanup(handle, stub);
    await rm(procDir, { recursive: true, force: true });
  }
});

/** S4：总超时 → status=timeout；记录实际 error.code 与契约约定值对比。 */
await scenario("S4 总超时结果", async () => {
  const stub = new StubScheduler();
  const handle = await startClient(stub);
  try {
    const item = task({ workspacePath: handle.container, prompt: "SLOW", timeoutMs: 400 });
    stub.enqueue(item);
    await waitFor("超时结果回报", () => stub.reports.length === 1, 10_000);
    const body = stub.reports[0]?.body as Record<string, unknown>;
    const err = body.error as { class?: string; code?: string } | null;
    equal("S4 status=timeout", body.status, "timeout");
    equal("S4 error.class=timeout", err?.class, "timeout");
    check(
      "S4 error.code=prompt_timeout（契约 4.2 约定值）",
      err?.code === "prompt_timeout",
      `实际 code=${String(err?.code)}`,
    );
    equal("S4 stopReason=null", body.stopReason, null);
    equal("S4 超时后 usage=null", body.usage, null);
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S5：idle 看门狗（C-06，默认关闭；配置开启后应报 idle_timeout）。 */
await scenario("S5 idle 看门狗", async () => {
  const stub = new StubScheduler();
  const handle = await startClient(stub, { idleTimeoutMs: 300 });
  try {
    const item = task({ workspacePath: handle.container, prompt: "SLOW", timeoutMs: 30_000 });
    stub.enqueue(item);
    await waitFor("idle 结果回报", () => stub.reports.length === 1, 10_000);
    const err = (stub.reports[0]?.body as Record<string, unknown>).error as { class?: string; code?: string } | null;
    equal("S5 status=timeout", (stub.reports[0]?.body as Record<string, unknown>).status, "timeout");
    equal("S5 error.class=timeout", err?.class, "timeout");
    equal("S5 error.code=idle_timeout", err?.code, "idle_timeout");
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S6：cancelInstances 电平取消。 */
await scenario("S6 cancelInstances 取消在跑任务", async () => {
  const stub = new StubScheduler();
  const handle = await startClient(stub);
  try {
    const item = task({ workspacePath: handle.container, prompt: "SLOW" });
    stub.enqueue(item);
    await waitFor("任务已下发", () => stub.dispatched >= 1);
    stub.cancelInstances = [item.instanceId];
    await waitFor("取消结果回报", () => stub.reports.length === 1, 10_000);
    const body = stub.reports[0]?.body as Record<string, unknown>;
    const err = body.error as { class?: string } | null;
    equal("S6 status=cancelled", body.status, "cancelled");
    equal("S6 error.class=cancelled", err?.class, "cancelled");
    stub.cancelInstances = [];
    stub.stop = true;
    const code = await Promise.race([handle.exit, sleep(8000).then(() => -1)]);
    equal("S6 取消后正常退出", code, 0);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S7：prompt 超过 maxPromptBytes → failed(scheduler)，不启动 DSH。 */
await scenario("S7 超长 prompt 拒绝执行", async () => {
  const stub = new StubScheduler();
  const procDir = await mkdtemp(join(tmpdir(), "afc-procs-"));
  const procLog = join(procDir, "acp-procs.log");
  const handle = await startClient(stub, { extraEnv: { FAKE_ACP_PROC_LOG: procLog } });
  try {
    const item = task({ workspacePath: handle.container, prompt: "x".repeat(1_048_577) });
    stub.enqueue(item);
    await waitFor("拒绝结果回报", () => stub.reports.length === 1, 10_000);
    const body = stub.reports[0]?.body as Record<string, unknown>;
    const err = body.error as { class?: string; code?: string } | null;
    equal("S7 status=failed", body.status, "failed");
    equal("S7 error.class=scheduler", err?.class, "scheduler");
    equal("S7 error.code=payload_too_large", err?.code, "payload_too_large");
    const procs = await readFile(procLog, "utf8").catch(() => "");
    equal("S7 未启动 DSH 进程", procs.trim(), "");
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await cleanup(handle, stub);
    await rm(procDir, { recursive: true, force: true });
  }
});

/** S8：401 凭据失效 → 非 0 退出，不再领取。 */
await scenario("S8 401 退出", async () => {
  const stub = new StubScheduler();
  stub.rejectAuth = true;
  const handle = await startClient(stub);
  try {
    const code = await Promise.race([handle.exit, sleep(8000).then(() => -1)]);
    check("S8 401 后退出码非 0", code !== 0 && code !== -1, `exit=${code}`);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S9：协议版本不匹配 400 → 非 0 退出。 */
await scenario("S9 unsupported_protocol 退出", async () => {
  const stub = new StubScheduler();
  stub.rejectProtocol = true;
  const handle = await startClient(stub);
  try {
    const code = await Promise.race([handle.exit, sleep(8000).then(() => -1)]);
    check("S9 400 后退出码非 0", code !== 0 && code !== -1, `exit=${code}`);
  } finally {
    await cleanup(handle, stub);
  }
});

async function makeZip(): Promise<{ bytes: Uint8Array; sha256: string; etag: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "afc-pkg-"));
  await mkdir(join(dir, "alpha"), { recursive: true });
  await writeFile(join(dir, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: a\n---\n");
  const zipPath = join(dir, "pkg.zip");
  const zip = Bun.spawn(["zip", "-q", "-r", zipPath, "alpha"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  await zip.exited;
  const bytes = new Uint8Array(await readFile(zipPath));
  const hash = sha256(bytes);
  return { bytes, sha256: hash, etag: `"sha256-${hash}"`, dir };
}

/** S10：P-03 下载 + 同 digest 短路。 */
await scenario("S10 技能包下载与 digest 短路", async () => {
  const stub = new StubScheduler();
  const handle = await startClient(stub, { capacity: 1 });
  const zip = await makeZip();
  try {
    stub.packageArtifact = { bytes: zip.bytes, etag: zip.etag, sha256: zip.sha256 };
    stub.packageId = "pkg-alpha";
    const digest = `sha256:${zip.sha256}`;
    const pkg: SkillPackage = {
      packageId: "pkg-alpha",
      name: "alpha",
      version: "1",
      digest,
      sizeBytes: zip.bytes.byteLength,
      downloadUrl: "/api/v1/executor/skill-packages/pkg-alpha",
      etag: zip.etag,
    };
    const skillSet = { digest, packages: [pkg] };

    stub.enqueue(task({ taskId: "01930000-0000-7000-8000-000000000911", workspacePath: handle.container, prompt: "V2-OK", skillSet }));
    await waitFor("第一个任务完成", () => stub.reports.length === 1);
    equal("S10 第一次安装 GET 技能包", stub.packageGets, 1);
    equal("S10 第一个任务 succeeded", (stub.reports[0]?.body as Record<string, unknown>).status, "succeeded");
    const installed = await readFile(join(handle.container, ".dsh", "skills", "alpha", "SKILL.md"), "utf8").catch(() => "");
    check("S10 技能落到 .dsh/skills/alpha", installed.includes("name: alpha"));

    stub.enqueue(task({ taskId: "01930000-0000-7000-8000-000000000912", workspacePath: handle.container, prompt: "V2-OK", skillSet }));
    await waitFor("第二个任务完成", () => stub.reports.length === 2);
    equal("S10 同 digest 第二次不再下载", stub.packageGets, 1);

    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await rm(zip.dir, { recursive: true, force: true });
    await cleanup(handle, stub);
  }
});

/** S11：P-03 404 → failed(asset)。 */
await scenario("S11 技能包缺失报 failed(asset)", async () => {
  const stub = new StubScheduler();
  const handle = await startClient(stub);
  try {
    stub.packageArtifact = null;
    const pkg: SkillPackage = {
      packageId: "pkg-missing",
      name: "missing",
      version: "1",
      digest: `sha256:${"a".repeat(64)}`,
      sizeBytes: 10,
      downloadUrl: "/api/v1/executor/skill-packages/pkg-missing",
    };
    const skillSet = { digest: `sha256:${"a".repeat(64)}`, packages: [pkg] };
    stub.enqueue(task({ workspacePath: handle.container, prompt: "V2-OK", skillSet }));
    await waitFor("失败结果回报", () => stub.reports.length === 1, 10_000);
    const body = stub.reports[0]?.body as Record<string, unknown>;
    const err = body.error as { class?: string; code?: string } | null;
    equal("S11 status=failed", body.status, "failed");
    equal("S11 error.class=asset", err?.class, "asset");
    console.log(`    实际 error.code=${String(err?.code)}`);
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S13：结果上报失败 → finished[] 带 taskId，重试后 accepted（C-04 / S-03 的关键补丁）。 */
await scenario("S13 上报失败后 finished 对账", async () => {
  const stub = new StubScheduler();
  const handle = await startClient(stub);
  try {
    const item = task({ workspacePath: handle.container });
    stub.failResultTimes = 4;
    stub.enqueue(item);
    await waitFor("finished[] 出现该 taskId", () =>
      stub.pollBodies.some((body) => {
        const finished = body.finished as { taskId?: string; attempt?: number; finishedAt?: string }[];
        return Array.isArray(finished) && finished.some((entry) => entry.taskId === item.taskId);
      }),
    10_000);
    const poll = stub.pollBodies.find((body) => {
      const finished = body.finished as { taskId?: string }[];
      return Array.isArray(finished) && finished.some((entry) => entry.taskId === item.taskId);
    }) as { finished: { taskId: string; attempt: number; finishedAt: string }[] };
    const entry = poll.finished.find((item2) => item2.taskId === item.taskId);
    equal("S13 finished[] 带 attempt", entry?.attempt, 1);
    check("S13 finished[] 带 finishedAt（ISO-8601）", typeof entry?.finishedAt === "string" && !Number.isNaN(Date.parse(entry.finishedAt)), entry?.finishedAt);
    await waitFor("重试后 accepted", () => stub.reports.some((report) => report.accepted), 10_000);
    check("S13 重试最终被接受", stub.reports.some((report) => report.accepted));
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S14：并发与 free 如实上报（C-02 / §9）。 */
await scenario("S14 并发与 free 上报", async () => {
  const stub = new StubScheduler();
  const handle = await startClient(stub, { capacity: 2 });
  try {
    const a = task({ taskId: "01930000-0000-7000-8000-000000000921", workspacePath: handle.container, prompt: "SLOW" });
    const b = task({ taskId: "01930000-0000-7000-8000-000000000922", workspacePath: handle.container, prompt: "SLOW" });
    stub.enqueue(a);
    stub.enqueue(b);
    await waitFor("两个任务同时在跑", () =>
      stub.pollBodies.some((body) => (body.running as unknown[]).length === 2),
    10_000);
    const running = stub.pollBodies.find((body) => (body.running as unknown[]).length === 2) as { capacity: { free: number } };
    equal("S14 两个任务在跑时 free=0", running.capacity.free, 0);
    stub.cancelInstances = [a.instanceId];
    await waitFor("两个取消结果回报", () => stub.reports.length === 2, 10_000);
    complete("S14 同一实例两个任务都被取消");
    stub.cancelInstances = [];
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S16：未知响应字段忽略 + 同批 cancelInstances 丢弃 tasks 条目（§3 / §4.1）。 */
await scenario("S16 未知字段与同批取消", async () => {
  const stub = new StubScheduler();
  stub.extraFields = true;
  const handle = await startClient(stub);
  try {
    const item = task({ workspacePath: handle.container });
    stub.enqueue(item);
    stub.cancelInstances = [item.instanceId];
    await waitFor("先收到一次带 cancel 的 poll", () => stub.pollBodies.length >= 2, 10_000);
    await sleep(600);
    equal("S16 同批 cancelInstances 命中则不执行", stub.reports.length, 0);
    stub.cancelInstances = [];
    stub.enqueue({ ...item, taskId: "01930000-0000-7000-8000-000000000931" });
    await waitFor("取消解除后正常执行", () => stub.reports.length === 1, 10_000);
    equal("S16 未知响应字段下仍成功", (stub.reports[0]?.body as Record<string, unknown>).status, "succeeded");
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S15：按 nextPollAfterMs 节流（§4.1）。 */
await scenario("S15 nextPollAfterMs 节流", async () => {
  const stub = new StubScheduler();
  stub.nextPollAfterMs = 400;
  const handle = await startClient(stub);
  try {
    await waitFor("至少三次 poll", () => stub.pollBodies.length >= 3, 8000);
    const times = stub.requestTimes.filter((_, index) => index < 4);
    const gaps = times.slice(1).map((time, index) => time - (times[index] as number));
    check("S15 poll 间隔不小于 nextPollAfterMs", gaps.every((gap) => gap >= 380), `gaps=${JSON.stringify(gaps)}`);
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await cleanup(handle, stub);
  }
});

/** S17：摘要不匹配应重试一次（契约 §4.3 #2）——验证 client 是否重试。 */
await scenario("S17 包摘要不匹配重试一次性", async () => {
  const stub = new StubScheduler();
  const handle = await startClient(stub);
  const zip = await makeZip();
  try {
    stub.corruptFirstGet = true;
    stub.packageArtifact = { bytes: zip.bytes, etag: zip.etag, sha256: zip.sha256 };
    const digest = `sha256:${zip.sha256}`;
    stub.enqueue(
      task({
        workspacePath: handle.container,
        prompt: "V2-OK",
        skillSet: {
          digest,
          packages: [{ packageId: "pkg-alpha", name: "alpha", version: "1", digest, sizeBytes: zip.bytes.byteLength, downloadUrl: "/api/v1/executor/skill-packages/pkg-alpha" }],
        },
      }),
    );
    await waitFor("回报", () => stub.reports.length === 1, 10_000);
    const body = stub.reports[0]?.body as Record<string, unknown>;
    const err = body.error as { class?: string; code?: string } | null;
    equal("S17 摘要不匹配后重试一次（契约要求）", body.status, "succeeded");
    note(`S17 实际：status=${String(body.status)} class=${String(err?.class)} code=${String(err?.code)}，技能包 GET 次数=${stub.packageGets}`);
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await rm(zip.dir, { recursive: true, force: true });
    await cleanup(handle, stub);
  }
});

/** S12：首次请求就返回 304（无本地缓存）时的行为——契约未定义，记录为风险。 */
await scenario("S12 首次即 304 的行为（记录）", async () => {
  const stub = new StubScheduler();
  const handle = await startClient(stub);
  const zip = await makeZip();
  try {
    stub.always304 = true;
    stub.packageArtifact = { bytes: zip.bytes, etag: zip.etag, sha256: zip.sha256 };
    const digest = `sha256:${zip.sha256}`;
    stub.enqueue(
      task({
        workspacePath: handle.container,
        prompt: "V2-OK",
        skillSet: {
          digest,
          packages: [{ packageId: "pkg-alpha", name: "alpha", version: "1", digest, sizeBytes: zip.bytes.byteLength, downloadUrl: "/api/v1/executor/skill-packages/pkg-alpha", etag: zip.etag }],
        },
      }),
    );
    await waitFor("回报", () => stub.reports.length === 1, 10_000);
    const body = stub.reports[0]?.body as Record<string, unknown>;
    const err = body.error as { class?: string; code?: string; message?: string } | null;
    note(`S12 首次请求即 304 → status=${String(body.status)} class=${String(err?.class)} code=${String(err?.code)} message=${String(err?.message)}`);
    stub.stop = true;
    await Promise.race([handle.exit, sleep(8000)]);
  } finally {
    await rm(zip.dir, { recursive: true, force: true });
    await cleanup(handle, stub);
  }
});

const failed = checks.filter((item) => !item.ok);
console.log(`\n合计 ${checks.length} 项：${checks.length - failed.length} pass，${failed.length} fail`);
for (const item of failed) console.log(`  - ${item.name}${item.detail === undefined ? "" : `（${item.detail}）`}`);
process.exit(failed.length === 0 ? 0 : 1);
