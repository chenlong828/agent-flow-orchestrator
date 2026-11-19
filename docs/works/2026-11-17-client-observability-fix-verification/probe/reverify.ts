import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAttemptStore } from "../../../../../agent-flow-client/src/components/observer/attempt-store.ts";
import { FileSessionArchive } from "../../../../../agent-flow-client/src/components/observer/archive.ts";
import { ObservationRecorder } from "../../../../../agent-flow-client/src/components/observer/recorder.ts";
import { SessionRichHub } from "../../../../../agent-flow-client/src/components/observer/rich-hub.ts";
import { startObserverServer } from "../../../../../agent-flow-client/src/components/observer/server.ts";
import { FileRunRegistry } from "../../../../../agent-flow-client/src/components/store/runs.ts";
import { WorkspaceFileReader } from "../../../../../agent-flow-client/src/components/workspace/files.ts";

const stateRoot = await mkdtemp(join(tmpdir(), "afc-reverify-"));
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
for (let i = 1; i <= 3; i += 1) {
  await attempts.append(attempt.attemptId, { kind: "acp", event: `event-${i}`, message: `m${i}` });
  rich.publish("s1", { kind: "message", text: `m${i}` });
}
await mkdir(join(stateRoot, "observability", "sessions", "s1"), { recursive: true });
await writeFile(join(stateRoot, "observability", "sessions", "s1", "session.v4.jsonl.zstd"), "raw-session");

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
const server = startObserverServer({
  config,
  stateRoot,
  attempts,
  rich,
  runs,
  files: new WorkspaceFileReader(),
  archive: new FileSessionArchive({ stateRoot }),
});
const base = `http://127.0.0.1:${server.port}/api/v1/observability`;
const out: Record<string, unknown> = {};

try {
  await Bun.sleep(20);
  const health = await (await fetch(`${base}/health`)).json() as any;
  out.health = { uptimeMs: health.uptimeMs, startedAt: health.startedAt, status: health.status };

  // CF-04: O-05 Last-Event-ID=1 只补 seq>1；运行中流只读首帧，不能等结束。
  const sseController = new AbortController();
  const sse = await fetch(`${base}/attempts/${attempt.attemptId}/logs/stream`, {
    headers: { "last-event-id": "1" },
    signal: sseController.signal,
  });
  const sseReader = sse.body?.getReader();
  const sseFirst = await sseReader?.read();
  const sseText = sseFirst?.value === undefined ? "" : new TextDecoder().decode(sseFirst.value);
  sseController.abort();
  await sseReader?.cancel().catch(() => undefined);
  const snapshotLine = sseText.split("\n").find((line) => line.startsWith("data: ") && line.includes('"events"'));
  const snapshot = snapshotLine === undefined ? null : JSON.parse(snapshotLine.slice(6));
  out.lastEventId = { status: sse.status, seqs: snapshot?.events?.map((item: any) => item.seq), truncatedBefore: snapshot?.truncatedBefore };

  // CF-03: run tombstone → 410。
  await runs.prune({ activeRunIds: [], archivedRetentionMs: 1, unarchivedRetentionMs: 1 });
  const gone = await fetch(`${base}/runs/run-1/files`);
  out.runGone = { status: gone.status, body: await gone.json() };

  // CF-07: raw Accept-Ranges。
  const raw = await fetch(`${base}/sessions/s1/raw`);
  out.raw = { status: raw.status, acceptRanges: raw.headers.get("accept-ranges"), checksum: raw.headers.get("x-checksum-sha256") };
  await raw.arrayBuffer();

  // CF-19: 16.5s 长 SSE 应收到 heartbeat 且不被 idle 切断。
  const controller = new AbortController();
  const long = await fetch(`${base}/sessions/s1/events/stream`, { signal: controller.signal });
  const reader = long.body?.getReader();
  let text = "";
  const deadline = Date.now() + 16_500;
  let closedEarly = false;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader?.read(),
      Bun.sleep(remaining).then(() => "timeout" as const),
    ]);
    if (result === "timeout") break;
    if (result === undefined || result.done) { closedEarly = true; break; }
    text += new TextDecoder().decode(result.value);
  }
  controller.abort();
  await reader?.cancel().catch(() => undefined);
  out.longSse = { closedEarly, heartbeat: (text.match(/event: heartbeat/g) ?? []).length, bytes: text.length };
  // CF-13: ended snapshot + end。
  await attempts.update(attempt.attemptId, { status: "completed", phase: "settled", finishedAt: new Date().toISOString() });
  const ended = await fetch(`${base}/attempts/${attempt.attemptId}/logs/stream`);
  const endedText = await ended.text();
  out.ended = { hasSnapshot: endedText.includes("event: snapshot"), hasEnd: endedText.includes("event: end") };

} catch (error) {
  out.error = (error as Error).message;
} finally {
  server.stop(true);
}

// CF-08: recorder 写 session meta。
const recorderRoot = join(stateRoot, "recorder");
await mkdir(recorderRoot, { recursive: true });
const recorderAttempts = new FileAttemptStore({ stateRoot: recorderRoot });
const recorder = new ObservationRecorder({ stateRoot: recorderRoot, attempts: recorderAttempts, rich: new SessionRichHub() });
const id = await recorder.startAttempt({ taskId: "t2", attemptNo: 1, instanceId: "i2", nodeId: "n4", runId: "run-2" });
if (id !== null) {
  await recorder.session(id, "s2", "/ws");
  await recorder.settle(id, {
    taskId: "t2", attempt: 1, status: "succeeded", message: "ok", truncated: false,
    stopReason: "end_turn", usage: null, error: null, sessionId: "s2",
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  });
  const metaPath = join(recorderRoot, "observability", "sessions", "s2", "meta.json");
  const exists = await stat(metaPath).then(() => true).catch(() => false);
  out.sessionMeta = exists ? JSON.parse(await readFile(metaPath, "utf8")) : "missing";
}

console.log(JSON.stringify(out));
await rm(stateRoot, { recursive: true, force: true });
process.exit(0);
