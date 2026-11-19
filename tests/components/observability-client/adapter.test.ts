import { afterAll, describe, expect, test } from "bun:test";
import {
  ClientObservabilityHttpError,
  ClientObservabilityInvalidError,
  ClientObservabilityUnauthorizedError,
  ClientObservabilityUnavailableError,
} from "../../../src/core/kernel/index.ts";
import { createObservabilityClient } from "../../../src/components/observability-client/index.ts";

let requireToken = true;
const seen: { path: string; auth: string | null; lastEventId: string | null }[] = [];

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    seen.push({
      path: url.pathname + url.search,
      auth: request.headers.get("authorization"),
      lastEventId: request.headers.get("last-event-id"),
    });
    if (requireToken && request.headers.get("authorization") !== "Bearer token-1") {
      return new Response(JSON.stringify({ error: { code: "unauthorized", message: "no" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname.endsWith("/runs/run-404/files")) {
      return new Response(JSON.stringify({ error: { code: "run_not_found", message: "missing" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname.endsWith("/runs/run-500/files")) {
      return new Response("boom", { status: 500 });
    }
    if (url.pathname.endsWith("/runs/run-slow/files")) {
      await Bun.sleep(80);
    }
    if (url.pathname.endsWith("/attempts")) {
      return Response.json({
        items: [
          { attemptId: "a1", attemptNo: 1, runId: "run-1", nodeId: "n3", taskId: "task-1", sessionId: "s1", status: "running" },
          { attemptId: "a2", attemptNo: 2, runId: "run-1", nodeId: "n3", taskId: "task-1", status: "running" },
        ],
      });
    }
    if (url.pathname.endsWith("/runs/run-1/files")) {
      return Response.json({
        runId: "run-1",
        root: "task-space",
        path: "reports",
        entries: [{ name: "a.md", type: "file", sizeBytes: 5, modifiedAt: "2026-11-17T00:00:00Z" }],
        truncated: false,
      });
    }
    if (url.pathname.endsWith("/runs/run-1/files/content")) {
      return Response.json({
        runId: "run-1",
        root: "task-space",
        path: "reports/a.md",
        name: "a.md",
        sizeBytes: 5,
        modifiedAt: "2026-11-17T00:00:00Z",
        content: "# hi\n",
        encoding: "utf-8",
        binary: false,
        truncated: false,
      });
    }
    if (url.pathname.endsWith("/sessions/s1")) {
      return Response.json({
        sessionId: "s1",
        attemptId: "a1",
        instanceId: "i",
        nodeId: "n3",
        runId: "run-1",
        cwd: "/ws",
        status: "running",
        startedAt: "2026-11-17T00:00:00Z",
        finishedAt: null,
        eventCount: 2,
        archive: { status: "pending", sizeBytes: null, sha256: null },
      });
    }
    if (url.pathname.endsWith("/sessions/s1/events")) {
      return Response.json({
        items: [
          { seq: 1, ts: "2026-11-17T00:00:01Z", sessionId: "s1", attemptId: "a1", kind: "acp", event: "agent_message_chunk", message: "hi" },
        ],
        nextCursor: "1",
      });
    }
    if (url.pathname.endsWith("/sessions/s1/events/stream")) {
      const body = [
        'event: snapshot\nid: 1\ndata: {"events":[{"seq":1,"sessionId":"s1","attemptId":"a1","kind":"message","text":"hi"}],"reset":false}\n\n',
        'event: event\nid: 2\ndata: {"seq":2,"sessionId":"s1","attemptId":"a1","kind":"message","text":"yo"}\n\n',
      ].join("");
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    if (url.pathname.endsWith("/sessions/s1/raw")) {
      return new Response("raw", {
        headers: {
          "content-type": "application/zstd",
          "content-length": "3",
          "x-checksum-sha256": "abc",
          etag: '"sha256-abc"',
        },
      });
    }
    return new Response(JSON.stringify({ error: { code: "not_found", message: "no" } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  },
});

const base = `http://127.0.0.1:${server.port}/api/v1/observability`;

function makeClient(token: string | null = "token-1", timeoutMs = 500) {
  const targets = new Map<string, string>([["client-1", base]]);
  return createObservabilityClient({
    directory: {
      register: (id, url) => void targets.set(id, url),
      resolve: (id) => (targets.has(id) ? { url: targets.get(id) as string } : null),
    },
    credentials: { clientToken: async () => token },
    timeoutMs,
  });
}

afterAll(() => {
  server.stop(true);
});

describe("client 观测面 HTTP 适配器", () => {
  test("文件/会话请求带 token 与路径参数", async () => {
    const client = makeClient();
    const listing = await client.listFiles({ clientId: "client-1", runId: "run-1", root: "task-space", path: "reports" });
    expect(listing.entries[0]).toMatchObject({ name: "a.md", type: "file" });
    const content = await client.readFile({ clientId: "client-1", runId: "run-1", root: "task-space", path: "reports/a.md" });
    expect(content.content).toBe("# hi\n");
    const session = await client.getSession({ clientId: "client-1", sessionId: "s1" });
    expect(session.sessionId).toBe("s1");
    const page = await client.listEvents({ clientId: "client-1", sessionId: "s1" });
    expect(page.items[0]?.seq).toBe(1);
    const fileCall = seen.find((item) => item.path.includes("/runs/run-1/files?"));
    expect(fileCall?.auth).toBe("Bearer token-1");
    expect(fileCall?.path).toContain("root=task-space");
  });

  test("O-11 SSE 剥 sessionId/attemptId，透传 Last-Event-ID", async () => {
    const client = makeClient();
    const stream = await client.openEvents({ clientId: "client-1", sessionId: "s1", lastEventId: "1" });
    const text = await new Response(stream).text();
    expect(text).toContain("event: snapshot");
    expect(text).toContain('"text":"hi"');
    expect(text).not.toContain("sessionId");
    expect(text).not.toContain("attemptId");
    expect(seen.find((item) => item.path.endsWith("/events/stream"))?.lastEventId).toBe("1");
  });

  test("raw 返回流与校验头", async () => {
    const client = makeClient();
    const raw = await client.openRaw({ clientId: "client-1", sessionId: "s1" });
    expect(raw.sizeBytes).toBe(3);
    expect(raw.sha256).toBe("abc");
    expect(raw.etag).toBe('"sha256-abc"');
    expect(await new Response(raw.stream).text()).toBe("raw");
  });

  test("错误映射：401/404/500/超时/缺地址/非法 URL", async () => {
    await expect(makeClient(null).listFiles({ clientId: "client-1", runId: "run-1", root: "task-space", path: "" }))
      .rejects.toBeInstanceOf(ClientObservabilityUnauthorizedError);
    await expect(makeClient().listFiles({ clientId: "client-1", runId: "run-404", root: "task-space", path: "" }))
      .rejects.toMatchObject({ status: 404, clientCode: "run_not_found" });
    await expect(makeClient().listFiles({ clientId: "client-1", runId: "run-500", root: "task-space", path: "" }))
      .rejects.toBeInstanceOf(ClientObservabilityUnavailableError);
    await expect(makeClient("token-1", 10).listFiles({ clientId: "client-1", runId: "run-slow", root: "task-space", path: "" }))
      .rejects.toBeInstanceOf(ClientObservabilityUnavailableError);
    await expect(makeClient().listFiles({ clientId: "unknown", runId: "run-1", root: "task-space", path: "" }))
      .rejects.toBeInstanceOf(ClientObservabilityUnavailableError);
    const bad = createObservabilityClient({
      directory: { register: () => undefined, resolve: () => ({ url: "ftp://example.com/x" }) },
      credentials: { clientToken: async () => null },
    });
    await expect(bad.listFiles({ clientId: "client-1", runId: "run-1", root: "task-space", path: "" }))
      .rejects.toBeInstanceOf(ClientObservabilityInvalidError);
  });

  test("连接失败归一为 unavailable（不是 500）", async () => {
    const client = createObservabilityClient({
      directory: { register: () => undefined, resolve: () => ({ url: "http://127.0.0.1:1" }) },
      credentials: { clientToken: async () => null },
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(client.listFiles({ clientId: "c", runId: "r", root: "task-space", path: "" }))
      .rejects.toBeInstanceOf(ClientObservabilityUnavailableError);
  });


  test("O-02 反查运行中 sessionId", async () => {
    const client = makeClient();
    const sessionId = await client.findSession({ clientId: "client-1", runId: "run-1", nodeId: "n3", taskId: "task-1" });
    expect(sessionId).toBe("s1");
    const call = seen.find((item) => item.path.includes("/attempts?"));
    expect(call?.path).toContain("runId=run-1");
    expect(call?.path).toContain("nodeId=n3");
    expect(call?.path).toContain("taskId=task-1");
  });

});
