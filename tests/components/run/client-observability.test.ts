import { describe, expect, test } from "bun:test";
import { SessionNotLinkedError } from "../../../src/core/kernel/index.ts";
import { createClientObservabilityQueries } from "../../../src/components/run/client-observability.ts";
import type { RunRuntime } from "../../../src/components/run/runtime.ts";

const run = { id: "run-1", client_id: "client-1" };
const node = {
  run_id: "run-1",
  node_id: "n3",
  visit: 2,
  session_id: "s1",
  task_id: "task-1",
};

function runtimeWith(overrides: { sessionId?: string | null } = {}): RunRuntime {
  const currentNode = { ...node, session_id: overrides.sessionId === undefined ? node.session_id : overrides.sessionId };
  return {
    deps: {
      clock: { now: () => new Date("2026-11-17T12:00:00Z") },
      db: {},
      clientFiles: {
        listFiles: async () => ({
          entries: [
            { name: "a.md", type: "file", sizeBytes: 5, modifiedAt: "2026-11-17T11:00:00Z" },
            { name: ".secret.txt", type: "file", sizeBytes: 2, modifiedAt: "2026-11-17T11:00:00Z" },
          ],
          truncated: false,
        }),
        readFile: async () => ({
          name: "big.ts",
          sizeBytes: 2_000_000,
          modifiedAt: "2026-11-17T11:00:00Z",
          content: "const a = 1;",
          encoding: "utf-8" as const,
          binary: false,
          truncated: true,
        }),
      },
      clientSessions: {
        findSession: async () => null,
        getSession: async () => ({
          sessionId: "s1",
          attemptId: "a1",
          instanceId: "i1",
          nodeId: "n3",
          runId: "run-1",
          cwd: "/ws",
          status: "running",
          startedAt: "2026-11-17T11:00:00Z",
          finishedAt: null,
          eventCount: 2,
          archive: { status: "pending", sizeBytes: null, sha256: null },
        }),
        listEvents: async () => ({
          items: [
            { seq: 1, ts: "t", sessionId: "s1", attemptId: "a1", kind: "acp", event: "agent_message_chunk", message: "hi", data: { sessionId: "s1", attemptId: "a1", acpType: "x" } },
          ],
          nextCursor: "1",
        }),
        openEvents: async () => new Response("event: snapshot\n\n").body as ReadableStream<Uint8Array>,
        openRaw: async () => ({
          stream: new Response("raw").body as ReadableStream<Uint8Array>,
          sizeBytes: 3,
          sha256: "abc",
          etag: '"sha256-abc"',
        }),
      },
    },
    loadRun: async () => run,
    store: {
      findNode: async () => currentNode,
      findNodeByTask: async (_db: unknown, taskId: string) => (taskId === "task-1" ? currentNode : null),
    },
  } as unknown as RunRuntime;
}

describe("run client 观测查询", () => {
  test("文件映射 path/hidden/language/truncated", async () => {
    const queries = createClientObservabilityQueries(runtimeWith());
    const listing = await queries.listFiles({ runId: "run-1", root: "task-space", path: "" });
    expect(listing.entries[0]).toMatchObject({
      name: "a.md",
      path: "a.md",
      hidden: false,
      language: "markdown",
      contentType: "text/markdown; charset=utf-8",
    });
    expect(listing.entries[1]?.hidden).toBe(true);
    const content = await queries.readFile({ runId: "run-1", root: "task-space", path: "big.ts" });
    expect(content).toMatchObject({ truncated: true, reason: "too_large", language: "typescript" });
  });

  test("session 详情/事件不泄露 sessionId/attemptId", async () => {
    const queries = createClientObservabilityQueries(runtimeWith());
    const session = await queries.getSession({ runId: "run-1", nodeId: "n3" });
    expect(session).not.toHaveProperty("sessionId");
    expect(session).toMatchObject({ runId: "run-1", nodeId: "n3", visit: 2, status: "running" });
    const page = await queries.listSessionEvents({ runId: "run-1", nodeId: "n3" });
    expect(page.items[0]).not.toHaveProperty("sessionId");
    expect(page.items[0]).not.toHaveProperty("attemptId");
    expect(page.items[0]?.data).toEqual({ acpType: "x" });
    const runId = await queries.runIdForTask("task-1");
    expect(runId).toBe("run-1");
    expect(await queries.runIdForTask("unknown")).toBeNull();
  });


  test("运行中 session_id 为空时用 task_id 反查 O-02", async () => {
    const runtime = runtimeWith({ sessionId: null });
    const sessions = (runtime as any).deps.clientSessions;
    sessions.findSession = async (input: any) => {
      expect(input).toMatchObject({ clientId: "client-1", runId: "run-1", nodeId: "n3", taskId: "task-1" });
      return "s1";
    };
    const queries = createClientObservabilityQueries(runtime);
    const session = await queries.getSession({ runId: "run-1", nodeId: "n3" });
    expect(session).toMatchObject({ runId: "run-1", nodeId: "n3", visit: 2, status: "running" });
  });

  test("节点未关联 session 返回 session_not_linked", async () => {
    const queries = createClientObservabilityQueries(runtimeWith({ sessionId: null }));
    await expect(queries.getSession({ runId: "run-1", nodeId: "n3" })).rejects.toBeInstanceOf(SessionNotLinkedError);
  });
});
