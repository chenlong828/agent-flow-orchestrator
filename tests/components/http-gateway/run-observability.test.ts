import { describe, expect, test } from "bun:test";
import { ValidationError } from "../../../src/core/kernel/index.ts";
import { handleRun } from "../../../src/components/http-gateway/routes/run.ts";
import type { RouteContext, RouteDeps } from "../../../src/components/http-gateway/routes/types.ts";
import type { RunService } from "../../../src/components/run/index.ts";

const runId = "01a1e986-043c-7122-aa62-55d6a71254db";
const fake = {
  listFiles: async () => ({
    runId,
    root: "task-space",
    path: "",
    entries: [],
    truncated: false,
    fetchedAt: "2026-11-17T12:00:00Z",
  }),
  readFile: async () => ({
    runId,
    root: "task-space",
    path: "a.md",
    name: "a.md",
    sizeBytes: 5,
    modifiedAt: "2026-11-17T11:00:00Z",
    contentType: "text/markdown; charset=utf-8",
    language: "markdown",
    content: "# hi\n",
    truncated: false,
    reason: null,
    fetchedAt: "2026-11-17T12:00:00Z",
  }),
  getSession: async () => ({
    runId,
    nodeId: "n3",
    visit: 1,
    status: "running",
    cwd: "/ws",
    startedAt: "t",
    finishedAt: null,
    eventCount: 1,
    archive: { status: "pending", sizeBytes: null, sha256: null },
  }),
  listSessionEvents: async () => ({ items: [{ seq: 1, ts: "t", kind: "acp", event: "x" }] }),
  openSessionEvents: async () => new Response("event: snapshot\n\n").body as ReadableStream<Uint8Array>,
  openSessionRaw: async () => ({
    stream: new Response("raw").body as ReadableStream<Uint8Array>,
    sizeBytes: 3,
    sha256: "abc",
    etag: '"sha256-abc"',
  }),
} as unknown as RunService;

function context(path: string, segments: string[], init?: RequestInit): RouteContext {
  const url = new URL(`http://x${path}`);
  return {
    request: new Request(url, init),
    url,
    path,
    segments,
    deps: { runService: fake } as unknown as RouteDeps,
  };
}

describe("run 观测产品路由", () => {
  test("files/content/session/events/raw/stream 路由与头", async () => {
    const files = await handleRun(context(`/api/v1/runs/${runId}/files?root=task-space&path=`, ["runs", runId, "files"]));
    expect(files.status).toBe(200);
    expect(await files.json()).toMatchObject({ runId, root: "task-space" });

    const content = await handleRun(
      context(`/api/v1/runs/${runId}/files/content?path=a.md`, ["runs", runId, "files", "content"]),
    );
    expect(content.status).toBe(200);
    expect(await content.json()).toMatchObject({ path: "a.md" });

    const session = await handleRun(
      context(`/api/v1/runs/${runId}/nodes/n3/session`, ["runs", runId, "nodes", "n3", "session"]),
    );
    expect(session.status).toBe(200);
    expect(await session.json()).not.toHaveProperty("sessionId");

    const events = await handleRun(
      context(`/api/v1/runs/${runId}/nodes/n3/session/events`, ["runs", runId, "nodes", "n3", "session", "events"]),
    );
    expect(events.status).toBe(200);
    expect(await events.json()).toMatchObject({ items: [{ seq: 1 }] });

    const raw = await handleRun(
      context(`/api/v1/runs/${runId}/nodes/n3/session/raw`, ["runs", runId, "nodes", "n3", "session", "raw"]),
    );
    expect(raw.headers.get("content-type")).toBe("application/zstd");
    expect(raw.headers.get("x-checksum-sha256")).toBe("abc");
    expect(await raw.text()).toBe("raw");

    const stream = await handleRun(
      context(`/api/v1/runs/${runId}/nodes/n3/session/events/stream`, [
        "runs",
        runId,
        "nodes",
        "n3",
        "session",
        "events",
        "stream",
      ], { headers: { "last-event-id": "1" } }),
    );
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(await stream.text()).toContain("event: snapshot");
  });

  test("非法 root / 缺 path / 非法 visit 被拒", async () => {
    await expect(
      handleRun(context(`/api/v1/runs/${runId}/files?root=bad`, ["runs", runId, "files"])),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      handleRun(context(`/api/v1/runs/${runId}/files/content`, ["runs", runId, "files", "content"])),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      handleRun(context(`/api/v1/runs/${runId}/nodes/n3/session?visit=0`, ["runs", runId, "nodes", "n3", "session"])),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
