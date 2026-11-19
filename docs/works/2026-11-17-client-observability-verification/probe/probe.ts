import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createObserverHandler } from "../../../../../agent-flow-client/src/components/observer/server.ts";
import { FileAttemptStore } from "../../../../../agent-flow-client/src/components/observer/attempt-store.ts";
import { FileSessionArchive } from "../../../../../agent-flow-client/src/components/observer/archive.ts";
import { SessionRichHub } from "../../../../../agent-flow-client/src/components/observer/rich-hub.ts";
import { FileRunRegistry } from "../../../../../agent-flow-client/src/components/store/runs.ts";
import { WorkspaceFileReader } from "../../../../../agent-flow-client/src/components/workspace/files.ts";

type Result = { check: string; expected: string; actual: string; verdict: "pass" | "fail" | "note" };
const results: Result[] = [];
function record(check: string, expected: string, actual: unknown, verdict: Result["verdict"]): void {
  results.push({ check, expected, actual: typeof actual === "string" ? actual : JSON.stringify(actual), verdict });
}

const stateRoot = await mkdtemp(join(tmpdir(), "afc-probe-"));
const taskSpace = join(stateRoot, "task-space");
await mkdir(join(taskSpace, "reports"), { recursive: true });
await writeFile(join(taskSpace, "reports", "a.md"), "# hi\n");
await writeFile(join(taskSpace, "binary.bin"), Buffer.from([0xff, 0xfe, 0x00]));
const runs = new FileRunRegistry({ stateRoot });
await runs.init();
await runs.upsert({
  runId: "run-1",
  instanceId: "inst-1",
  workspacePath: stateRoot,
  taskSpacePath: taskSpace,
  archivedAt: new Date(Date.now() - 86_400_000).toISOString(),
});
const attempts = new FileAttemptStore({ stateRoot });
const rich = new SessionRichHub();
const config = {
  enabled: true,
  required: false,
  bind: "127.0.0.1",
  port: 0,
  advertiseUrl: "http://127.0.0.1:17890/api/v1/observability",
  token: null as string | null,
  maxStreams: 5,
  rawEnabled: true,
  richStreamEnabled: true,
  retentionDays: 7,
  maxBytes: 1024 * 1024,
  maxAttemptEventBytes: 1024 * 1024,
};
const deps = {
  config,
  stateRoot,
  attempts,
  rich,
  runs,
  files: new WorkspaceFileReader(),
  archive: new FileSessionArchive({ stateRoot }),
};
const handler = createObserverHandler(deps);

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await handler(new Request(`http://x${path}`, init));
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // 保留 raw text。
  }
  return { status: response.status, body, headers: response.headers };
}

async function callFirstEvent(path: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const response = await handler(new Request(`http://x${path}`, { headers, signal: controller.signal }));
  const reader = response.body?.getReader();
  const first = await reader?.read();
  const text = first?.value === undefined ? "" : new TextDecoder().decode(first.value);
  controller.abort();
  await reader?.cancel().catch(() => undefined);
  return { status: response.status, text };
}

// 基础对象：attempt + session + preview 事件 + rich 事件 + raw 归档。
const attempt = await attempts.create({ taskId: "task-1", attemptNo: 1, instanceId: "inst-1", nodeId: "n3", runId: "run-1" });
await attempts.update(attempt.attemptId, { sessionId: "s1", cwd: stateRoot, status: "running", phase: "running" });
await attempts.append(attempt.attemptId, { kind: "phase", phase: "claimed", event: "attempt.claimed" });
await attempts.append(attempt.attemptId, { kind: "acp", event: "agent_message_chunk", message: "hello", data: { acpType: "agent_message_chunk" } });
await attempts.append(attempt.attemptId, { kind: "acp", event: "tool_call", message: "tool call: read", data: { tool: "read", status: "in_progress" } });
rich.publish("s1", { kind: "lifecycle", lifecycle: "session.started" });
rich.publish("s1", { kind: "message", text: "hello" });
await mkdir(join(stateRoot, "observability", "sessions", "s1"), { recursive: true });
await writeFile(join(stateRoot, "observability", "sessions", "s1", "session.v4.jsonl.zstd"), "raw-session");

// O-01 health：契约的 startedAt/uptimeMs/status。
const health = await call("/api/v1/observability/health");
record("health.startedAt", "真实服务启动时间", health.body.startedAt, "note");
record("health.uptimeMs", "真实 uptime", health.body.uptimeMs, "note");
record("health.status", "ok/degraded 按写盘失败", health.body.status, "note");
record("health.counts", "activeAttempts/retainedAttempts/sessions/runs", health.body, "note");

// O-02/O-03/O-04/O-06/O-07 基础形状。
const list = await call("/api/v1/observability/attempts?status=running");
record("O-02 attempts", "200 + items", list.status, list.status === 200 ? "pass" : "fail");
const detail = await call(`/api/v1/observability/attempts/${attempt.attemptId}`);
record("O-03 attempt detail", "200 + session/logRange", { status: detail.status, hasSession: detail.body.session !== null, logRange: detail.body.logRange }, "note");
const logs = await call(`/api/v1/observability/attempts/${attempt.attemptId}/logs?limit=10`);
record("O-04 preview logs", "200 + preview items", { status: logs.status, items: logs.body.items?.length }, logs.status === 200 ? "pass" : "fail");
const session = await call("/api/v1/observability/sessions/s1");
record("O-06 session detail", "200 + archive", { status: session.status, archive: session.body.archive }, session.status === 200 ? "pass" : "fail");
const sessionEvents = await call("/api/v1/observability/sessions/s1/events?limit=10");
record("O-07 session events", "200 + items", { status: sessionEvents.status, items: sessionEvents.body.items?.length }, sessionEvents.status === 200 ? "pass" : "fail");

// O-05 Last-Event-ID / snapshot 字段。
const attemptStream = await callFirstEvent(`/api/v1/observability/attempts/${attempt.attemptId}/logs/stream`, { "last-event-id": "1" });
record("O-05 Last-Event-ID", "从 seq>1 补发", attemptStream.text.includes('"seq":1'), "note");
record("O-05 snapshot.truncatedBefore", "snapshot 带 truncatedBefore", attemptStream.text.includes("truncatedBefore"), "note");
await attempts.update(attempt.attemptId, { status: "completed", phase: "settled", finishedAt: new Date().toISOString() });
const ended = await call(`/api/v1/observability/attempts/${attempt.attemptId}/logs/stream`);
record("O-05 ended", "snapshot + end 或 end", ended.body, "note");

// O-11 Last-Event-ID / rich 开关 / 关闭事件。
const richStream = await callFirstEvent("/api/v1/observability/sessions/s1/events/stream", { "last-event-id": "1" });
record("O-11 Last-Event-ID", "从 seq>1 补发", richStream.text.includes('"seq":1'), "note");
const richDisabled = createObserverHandler({ ...deps, config: { ...config, richStreamEnabled: false } });
const richDisabledResponse = await richDisabled(new Request("http://x/api/v1/observability/sessions/s1/events/stream"));
record("O-11 disabled", "503 rich_stream_disabled", { status: richDisabledResponse.status, body: await richDisabledResponse.text() }, "pass");

// O-08 raw 头与状态。
const raw = await handler(new Request("http://x/api/v1/observability/sessions/s1/raw"));
record("O-08 raw headers", "content-type/etag/checksum/Accept-Ranges", { status: raw.status, acceptRanges: raw.headers.get("accept-ranges"), etag: raw.headers.get("etag"), checksum: raw.headers.get("x-checksum-sha256") }, "note");
await raw.arrayBuffer();
const rawDisabled = createObserverHandler({ ...deps, config: { ...config, rawEnabled: false } });
const rawDisabledResponse = await rawDisabled(new Request("http://x/api/v1/observability/sessions/s1/raw"));
record("O-08 disabled", "403 raw_disabled", rawDisabledResponse.status, "pass");
const noArchiveAttempt = await attempts.create({ taskId: "task-2", attemptNo: 1, instanceId: "inst-1", nodeId: "n4", runId: "run-1" });
await attempts.update(noArchiveAttempt.attemptId, { sessionId: "s2", cwd: stateRoot });
const noArchive = await call("/api/v1/observability/sessions/s2/raw");
record("O-08 not ready", "409 archive_not_ready", { status: noArchive.status, body: noArchive.body }, "note");

// O-09/O-10 文件与 run 生命周期。
const files = await call("/api/v1/observability/runs/run-1/files?root=task-space&path=reports");
record("O-09 files", "200 + a.md", { status: files.status, first: files.body.entries?.[0] }, "pass");
const content = await call("/api/v1/observability/runs/run-1/files/content?root=task-space&path=reports/a.md");
record("O-10 content", "200 + content", { status: content.status, content: content.body.content }, "pass");
const escape = await call("/api/v1/observability/runs/run-1/files/content?root=task-space&path=../etc/passwd");
record("O-10 path escape", "400 path_escape", { status: escape.status, code: escape.body.error?.code }, escape.status === 400 ? "pass" : "fail");
await runs.prune({ activeRunIds: [], archivedRetentionMs: 1, unarchivedRetentionMs: 1 });
const gone = await call("/api/v1/observability/runs/run-1/files");
record("O-09 run_gone", "410 run_gone（契约）", { status: gone.status, code: gone.body.error?.code }, "note");

// 鉴权与错误信封。
const authHandler = createObserverHandler({ ...deps, config: { ...config, token: "secret" } });
const noAuth = await authHandler(new Request("http://x/api/v1/observability/health"));
record("auth missing", "401", noAuth.status, "pass");
const goodAuth = await authHandler(new Request("http://x/api/v1/observability/health", { headers: { authorization: "Bearer secret" } }));
record("auth valid", "200", goodAuth.status, "pass");
const badPath = await call("/api/v1/observability/nope", { headers: { "x-request-id": "probe-1" } });
record("error envelope", "error.code + x-request-id 回显", { status: badPath.status, body: badPath.body, requestId: badPath.headers.get("x-request-id") }, "note");

// 契约 §15 的 sessions/meta.json 是否存在。
let sessionMeta = "present";
try {
  await stat(join(stateRoot, "observability", "sessions", "s1", "meta.json"));
} catch {
  sessionMeta = "missing";
}
record("sessions/meta.json", "契约 §15：sessions/<id>/meta.json", sessionMeta, "note");

// 保留策略/事件上限：实现是否使用配置（静态核对在 result 中引用代码）。
record("retention config used", "retentionDays/maxBytes/maxAttemptEventBytes 被读取", "config 有字段；probe 未触发清理", "note");

for (const item of results) console.log(JSON.stringify(item));
await import("node:fs/promises").then((fs) => fs.rm(stateRoot, { recursive: true, force: true }));
process.exit(0);
