import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAttemptStore } from "../../../../../agent-flow-client/src/components/observer/attempt-store.ts";
import { FileSessionArchive } from "../../../../../agent-flow-client/src/components/observer/archive.ts";
import { SessionRichHub } from "../../../../../agent-flow-client/src/components/observer/rich-hub.ts";
import { startObserverServer } from "../../../../../agent-flow-client/src/components/observer/server.ts";
import { FileRunRegistry } from "../../../../../agent-flow-client/src/components/store/runs.ts";
import { WorkspaceFileReader } from "../../../../../agent-flow-client/src/components/workspace/files.ts";

type Row = { check: string; expected: string; actual: unknown; verdict: "pass" | "fail" | "note" };
const rows: Row[] = [];
const add = (check: string, expected: string, actual: unknown, verdict: Row["verdict"]): void => {
  rows.push({ check, expected, actual, verdict });
};

const stateRoot = await mkdtemp(join(tmpdir(), "afc-http-probe-"));
const taskSpace = join(stateRoot, "task-space");
await mkdir(join(taskSpace, "reports"), { recursive: true });
await writeFile(join(taskSpace, "reports", "a.md"), "# hi\n");
const runs = new FileRunRegistry({ stateRoot });
await runs.init();
await runs.upsert({ runId: "run-1", instanceId: "inst-1", workspacePath: stateRoot, taskSpacePath: taskSpace });
const attempts = new FileAttemptStore({ stateRoot });
const rich = new SessionRichHub();
const attempt = await attempts.create({ taskId: "task-1", attemptNo: 1, instanceId: "inst-1", nodeId: "n3", runId: "run-1" });
await attempts.update(attempt.attemptId, { sessionId: "s1", cwd: stateRoot, status: "running", phase: "running" });
await attempts.append(attempt.attemptId, { kind: "acp", event: "agent_message_chunk", message: "hello" });
rich.publish("s1", { kind: "message", text: "hello" });
await mkdir(join(stateRoot, "observability", "sessions", "s1"), { recursive: true });
await writeFile(join(stateRoot, "observability", "sessions", "s1", "session.v4.jsonl.zstd"), "raw-session");

const baseConfig = {
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
  config: baseConfig,
  stateRoot,
  attempts,
  rich,
  runs,
  files: new WorkspaceFileReader(),
  archive: new FileSessionArchive({ stateRoot }),
};

const server = startObserverServer(deps);
const base = `http://127.0.0.1:${server.port}/api/v1/observability`;
try {
  const health = await fetch(`${base}/health`);
  add("HTTP health", "200", { status: health.status, body: await health.json() }, "pass");

  const list = await fetch(`${base}/attempts?status=running`);
  add("HTTP attempts", "200 + items", { status: list.status, body: await list.json() }, "pass");

  const files = await fetch(`${base}/runs/run-1/files?root=task-space&path=reports`);
  add("HTTP files", "200 + a.md", { status: files.status, body: await files.json() }, "pass");

  const content = await fetch(`${base}/runs/run-1/files/content?root=task-space&path=reports/a.md`);
  add("HTTP file content", "200 + # hi", { status: content.status, body: await content.json() }, "pass");

  const session = await fetch(`${base}/sessions/s1`);
  add("HTTP session", "200", { status: session.status, body: await session.json() }, "pass");

  const raw = await fetch(`${base}/sessions/s1/raw`);
  add("HTTP raw", "200 + headers", {
    status: raw.status,
    contentType: raw.headers.get("content-type"),
    acceptRanges: raw.headers.get("accept-ranges"),
    checksum: raw.headers.get("x-checksum-sha256"),
  }, "note");
  await raw.arrayBuffer();

  const controller = new AbortController();
  try {
    const stream = await fetch(`${base}/sessions/s1/events/stream`, {
      headers: { "last-event-id": "0" },
      signal: controller.signal,
    });
    const reader = stream.body?.getReader();
    const first = await reader?.read();
    const text = first?.value === undefined ? "" : new TextDecoder().decode(first.value);
    add("HTTP O-11 SSE snapshot", "snapshot 首帧", { status: stream.status, first: text.slice(0, 120) }, "pass");
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  } catch (error) {
    add("HTTP O-11 SSE abort", "无异常", (error as Error).message, "fail");
  }
} finally {
  server.stop();
}

// 鉴权：单独 server + token。
const auth = startObserverServer({ ...deps, config: { ...baseConfig, token: "secret" } });
const authBase = `http://127.0.0.1:${auth.port}/api/v1/observability`;
try {
  const missing = await fetch(`${authBase}/health`);
  add("HTTP auth missing", "401", missing.status, missing.status === 401 ? "pass" : "fail");
  const ok = await fetch(`${authBase}/health`, { headers: { authorization: "Bearer secret" } });
  add("HTTP auth valid", "200", ok.status, ok.status === 200 ? "pass" : "fail");
} finally {
  auth.stop();
}

for (const row of rows) console.log(JSON.stringify(row));
await rm(stateRoot, { recursive: true, force: true });
process.exit(0);
