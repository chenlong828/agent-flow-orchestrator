import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORCH = "http://127.0.0.1:3100";
const CLIENT = join(import.meta.dir, "../../../../../agent-flow-client");
const FAKE_ACP = join(CLIENT, "tests/fixtures/fake-acp.mjs");
const suffix = `${Date.now().toString(36)}`;
const runRoot = await mkdtemp(join(tmpdir(), `afc-e2e-${suffix}-`));
const workspace = join(runRoot, "workspace");
const stateRoot = join(runRoot, "state");
await mkdir(join(workspace, "docs"), { recursive: true });
await writeFile(join(workspace, "docs", "review.md"), "# review\n");

async function freePort(): Promise<number> {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const port = s.port ?? 0;
  s.stop(true);
  return port;
}
const obsPort = await freePort();

const obsConfig = `[acp]
dsh_home = "${join(runRoot, "dsh-home")}"
permission = "allow"
[state]
root = "${stateRoot}"
[logging]
level = "error"
[capacity]
max_concurrent = 2
[scheduler]
url = "${ORCH}"
token = "TOKEN-${suffix}"
[observability.http]
enabled = true
bind = "127.0.0.1"
port = ${obsPort}
advertise_url = "http://127.0.0.1:${obsPort}/api/v1/observability"
`;
const configPath = join(runRoot, ".config");
await writeFile(configPath, obsConfig);

type ApiResult = { status: number; body: any; text: string };
async function api(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const response = await fetch(`${ORCH}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  let body: any = null;
  try { body = text === "" ? null : JSON.parse(text); } catch { /* text */ }
  return { status: response.status, body, text };
}
async function must(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const result = await api(path, init);
  if (result.status >= 300) throw new Error(`${init.method ?? "GET"} ${path} -> ${result.status} ${result.text}`);
  return result;
}
const jsonInit = (method: string, body: unknown, extra: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { "content-type": "application/json", ...extra },
  body: JSON.stringify(body),
});
async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 30_000, interval = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn().catch(() => null);
    if (value !== null) return value;
    await Bun.sleep(interval);
  }
  throw new Error("等待超时");
}
async function runDetail(runId: string): Promise<any> {
  return (await must(`/api/v1/runs/${runId}`)).body;
}
async function getSession(runId: string, nodeId = "n1"): Promise<ApiResult> {
  return api(`/api/v1/runs/${runId}/nodes/${nodeId}/session`);
}
async function getFiles(runId: string, root: string, path: string): Promise<ApiResult> {
  return api(`/api/v1/runs/${runId}/files?root=${root}&path=${encodeURIComponent(path)}`);
}

const expert = (await must("/api/v1/experts", jsonInit("POST", { name: `E2E 专家 ${suffix}`, color: "#336699", role: "执行" }))).body;
const harness = (await must("/api/v1/harnesses", jsonInit("POST", {
  name: `E2E 节点 ${suffix}`, kind: "container", address: "127.0.0.1:7800", accessMode: "agent", concurrencyMax: 4, queuePolicy: "fifo",
}))).body;
await must(`/api/v1/harnesses/${harness.id}/client`, jsonInit("PATCH", { clientId: `e2e-${suffix}`, token: `TOKEN-${suffix}` }, { "if-match": `"${harness.revision}"` }));
const graph = {
  stages: [{ id: "s1", name: "设计" }],
  nodes: [
    { id: "n1", type: "start", name: "开始", stageId: "s1", expertId: expert.id },
    { id: "n2", type: "confirm", name: "确认", stageId: "s1", expertId: null },
    { id: "n3", type: "end", name: "结束", stageId: "s1", expertId: expert.id },
  ],
  edges: [
    { id: "e1", from: "n1", to: "n2", kind: "seq" },
    { id: "e2", from: "n2", to: "n3", kind: "seq" },
  ],
};
const workflow = (await must("/api/v1/workflows", jsonInit("POST", {
  name: `E2E 流程 ${suffix}`, type: "研发", description: "e2e", graph,
}))).body;

console.error("stage: fixtures done");
const env = {
  ...process.env,
  DSH_BIN: FAKE_ACP,
  AF_NODE_BIN: process.execPath,
  HUNDSUN_PUBLIC_API_KEY: "k",
} as Record<string, string>;
delete (env as Record<string, string | undefined>).DSH_HOME;
const child = Bun.spawn(
  [process.execPath, "src/cli.ts", "serve", "--config", configPath, "--state-root", stateRoot],
  { cwd: CLIENT, env, stdout: "pipe", stderr: "pipe" },
);

console.error("stage: client spawned");
const out: Record<string, unknown> = {};
try {
  await waitFor(async () => {
    const health = await fetch(`http://127.0.0.1:${obsPort}/api/v1/observability/health`, { headers: { authorization: `Bearer TOKEN-${suffix}` }, signal: AbortSignal.timeout(2000) }).catch(() => null);
    return health?.ok === true ? true : null;
  }, 20_000);
  console.error("stage: observer healthy");
  out.clientObserver = { port: obsPort };

  // 慢任务：运行中 session 应可用，否则记录 product 404 与 client attempt 的 sessionId。
  console.error("stage: slow run start");
  const slowStart = await must(`/api/v1/workflows/${workflow.id}/runs`, jsonInit("POST", {
    harnessId: harness.id, workspacePath: workspace, intentMarkdown: "SLOW",
  }));
  const slowRunId = slowStart.body.runId as string;
  const slowDetail = await waitFor(async () => {
    const detail = await runDetail(slowRunId);
    const node = detail.nodes.find((item: any) => item.nodeId === "n1");
    return detail.state === "running" && node?.state === "dispatched" ? detail : null;
  }, 25_000);
  console.error("stage: slow dispatched");
  out.slow = { runId: slowRunId, state: slowDetail.state, taskSpacePath: slowDetail.taskSpacePath };
  await mkdir(join(slowDetail.taskSpacePath, "reports"), { recursive: true });
  await writeFile(join(slowDetail.taskSpacePath, "reports", "slow.md"), "# slow\n");
  console.error("stage: slow files/session");
  const directAttempt = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${obsPort}/api/v1/observability/attempts?runId=${slowRunId}&nodeId=n1`, {
      headers: { authorization: `Bearer TOKEN-${suffix}` },
      signal: AbortSignal.timeout(3000),
    });
    const body = await response.json() as any;
    return body.items?.find((item: any) => item.sessionId) ?? null;
  }, 20_000).catch(() => null);
  const directSession = directAttempt?.sessionId === undefined ? null : await fetch(
    `http://127.0.0.1:${obsPort}/api/v1/observability/sessions/${directAttempt.sessionId}`,
    { headers: { authorization: `Bearer TOKEN-${suffix}` }, signal: AbortSignal.timeout(3000) },
  ).catch(() => null);
  const workspaceFiles = await waitFor(async () => {
    const result = await getFiles(slowRunId, "workspace", "docs");
    return result.status === 200 ? result : null;
  }, 15_000).catch(() => getFiles(slowRunId, "workspace", "docs"));
  const taskFiles = await getFiles(slowRunId, "task-space", "reports");
  const productSession = await getSession(slowRunId);
  out.slow.files = { workspace: { status: workspaceFiles.status, entries: workspaceFiles.body?.entries?.map((e: any) => e.name) }, taskSpace: { status: taskFiles.status, entries: taskFiles.body?.entries?.map((e: any) => e.name) } };
  out.slow.productSession = { status: productSession.status, code: productSession.body?.error?.code ?? null };
  out.slow.clientAttempt = { sessionId: directAttempt?.sessionId ?? null, status: directAttempt?.status ?? null };
  out.slow.clientSession = directSession === null ? null : { status: directSession.status, hasSessionId: (await directSession.clone().text()).includes(directAttempt?.sessionId ?? "___") };
  const liveSse = await fetch(`${ORCH}/api/v1/runs/${slowRunId}/nodes/n1/session/events/stream`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  const liveReader = liveSse?.body?.getReader();
  const liveFirst = await liveReader?.read().catch(() => undefined);
  const liveText = liveFirst?.value === undefined ? "" : new TextDecoder().decode(liveFirst.value);
  await liveReader?.cancel().catch(() => undefined);
  out.slow.liveSse = liveSse === null ? null : { status: liveSse.status, hasSnapshot: liveText.includes("event: snapshot"), hasEvent: liveText.includes("event: event"), leaksSessionId: liveText.includes("sessionId") };
  console.error("stage: slow cancel");
  await must(`/api/v1/runs/${slowRunId}/cancel`, jsonInit("POST", {}));
  await waitFor(async () => (await runDetail(slowRunId)).state === "done" ? true : null, 20_000);

  // 正常任务：完成后 session 详情/事件/O-11/raw，confirm pass 后 end。
  console.error("stage: normal run start");
  const normalStart = await must(`/api/v1/workflows/${workflow.id}/runs`, jsonInit("POST", {
    harnessId: harness.id, workspacePath: workspace, intentMarkdown: "NORMAL",
  }));
  const normalRunId = normalStart.body.runId as string;
  const normalDetail = await waitFor(async () => {
    const detail = await runDetail(normalRunId);
    return detail.state === "waiting_confirm" ? detail : null;
  }, 30_000);
  console.error("stage: normal waiting_confirm");
  await mkdir(join(normalDetail.taskSpacePath, "reports"), { recursive: true });
  await writeFile(join(normalDetail.taskSpacePath, "reports", "normal.md"), "# normal\n");
  const normalSession = await getSession(normalRunId);
  const normalEvents = await api(`/api/v1/runs/${normalRunId}/nodes/n1/session/events?limit=50`);
  const normalRaw = await api(`/api/v1/runs/${normalRunId}/nodes/n1/session/raw`);
  console.error("stage: normal session queries");
  const normalSse = await fetch(`${ORCH}/api/v1/runs/${normalRunId}/nodes/n1/session/events/stream`, { signal: AbortSignal.timeout(5000) });
  const normalSseText = await new Response(normalSse.body).text();
  const normalTaskFiles = await getFiles(normalRunId, "task-space", "reports");
  const normalContent = await api(`/api/v1/runs/${normalRunId}/files/content?root=task-space&path=reports/normal.md`);
  console.error("stage: normal queries done");
  out.normal = {
    runId: normalRunId,
    state: normalDetail.state,
    session: { status: normalSession.status, hasSessionId: normalSession.text.includes("sessionId"), code: normalSession.body?.error?.code ?? null, eventCount: normalSession.body?.eventCount ?? null },
    events: { status: normalEvents.status, count: normalEvents.body?.items?.length ?? null, hasTopLevelSessionId: (normalEvents.body?.items ?? []).some((item: any) => "sessionId" in item), hasAnySessionId: normalEvents.text.includes("sessionId"), firstData: normalEvents.body?.items?.[0]?.data ?? null },
    raw: { status: normalRaw.status, code: normalRaw.body?.error?.code ?? null },
    sse: { status: normalSse.status, hasSnapshot: normalSseText.includes("event: snapshot"), hasEnd: normalSseText.includes("event: end"), leaksSessionId: normalSseText.includes("sessionId") },
    files: { status: normalTaskFiles.status, entries: normalTaskFiles.body?.entries?.map((e: any) => e.name) },
    content: { status: normalContent.status, content: normalContent.body?.content ?? null },
  };
  console.error("stage: confirm pass");
  await must(`/api/v1/runs/${normalRunId}/nodes/n2/decision`, jsonInit("POST", { decision: "pass" }));
  const done = await waitFor(async () => {
    const detail = await runDetail(normalRunId);
    return detail.state === "done" ? detail : null;
  }, 30_000);
  out.normal.final = { state: done.state, outcome: done.outcome, currentNodeId: done.currentNodeId };
  console.error("stage: client down check");
  child.kill("SIGTERM");
  await Promise.race([child.exited, Bun.sleep(2500)]);
  if (child.exitCode === null) child.kill("SIGKILL");
  const down = await getSession(normalRunId);
  out.clientDown = { status: down.status, code: down.body?.error?.code ?? null };
} catch (error) {
  out.error = (error as Error).message;
  child.kill("SIGTERM");
  await Promise.race([child.exited, Bun.sleep(2000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
  const stderr = await new Response(child.stderr).text().catch(() => "");
  out.clientStderr = stderr.slice(-2000);
} finally {
  child.kill("SIGTERM");
  await Promise.race([child.exited, Bun.sleep(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
  console.log(JSON.stringify(out, null, 2));
  await rm(runRoot, { recursive: true, force: true });
  process.exit(0);
}
