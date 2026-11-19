import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAttemptStore } from "../../../../../agent-flow-client/src/components/observer/attempt-store.ts";
import { FileSessionArchive } from "../../../../../agent-flow-client/src/components/observer/archive.ts";
import { SessionRichHub } from "../../../../../agent-flow-client/src/components/observer/rich-hub.ts";
import { startObserverServer } from "../../../../../agent-flow-client/src/components/observer/server.ts";
import { FileRunRegistry } from "../../../../../agent-flow-client/src/components/store/runs.ts";
import { WorkspaceFileReader } from "../../../../../agent-flow-client/src/components/workspace/files.ts";
import { createObservabilityClient } from "../../../../src/components/observability-client/index.ts";

const stateRoot = await mkdtemp(join(tmpdir(), "afc-adapter-real-"));
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
const server = startObserverServer({
  config: baseConfig,
  stateRoot,
  attempts,
  rich,
  runs,
  files: new WorkspaceFileReader(),
  archive: new FileSessionArchive({ stateRoot }),
});
const targets = new Map<string, string>();
targets.set("client-1", `http://127.0.0.1:${server.port}/api/v1/observability`);
const client = createObservabilityClient({
  directory: {
    register: (id, url) => void targets.set(id, url),
    resolve: (id) => (targets.has(id) ? { url: targets.get(id) as string } : null),
  },
  credentials: { clientToken: async () => null },
});

try {
  const files = await client.listFiles({ clientId: "client-1", runId: "run-1", root: "task-space", path: "reports" });
  const content = await client.readFile({ clientId: "client-1", runId: "run-1", root: "task-space", path: "reports/a.md" });
  const session = await client.getSession({ clientId: "client-1", sessionId: "s1" });
  const events = await client.listEvents({ clientId: "client-1", sessionId: "s1" });
  const raw = await client.openRaw({ clientId: "client-1", sessionId: "s1" });
  const stream = await client.openEvents({ clientId: "client-1", sessionId: "s1" });
  const reader = stream.getReader();
  const first = await reader.read();
  const streamText = first.value === undefined ? "" : new TextDecoder().decode(first.value);
  await reader.cancel();
  console.log(JSON.stringify({
    files: files.entries.map((item) => item.name),
    content: content.content,
    session: { status: session.status, eventCount: session.eventCount },
    events: events.items.length,
    raw: { sizeBytes: raw.sizeBytes, sha256: raw.sha256, hasEtag: raw.etag !== undefined },
    sse: { hasSnapshot: streamText.includes("event: snapshot"), leaksSessionId: streamText.includes("sessionId"), leaksAttemptId: streamText.includes("attemptId") },
  }));
  await new Response(raw.stream).arrayBuffer();
} finally {
  server.stop(true);
  await rm(stateRoot, { recursive: true, force: true });
}
