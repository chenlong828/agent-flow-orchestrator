import {
  ClientObservabilityUnavailableError,
  NotFoundError,
  SessionNotLinkedError,
  ValidationError,
  type ClientRunFileEntry,
  type ClientRunFileRoot,
  type ClientSessionEvent,
} from "../../core/kernel/index.ts";
import type { RunRuntime } from "./runtime.ts";
import type {
  RunFileContent,
  RunFileEntry,
  RunFileListing,
  RunFileRoot,
  RunSessionEvent,
  RunSessionEventPage,
  RunSessionView,
} from "./types.ts";

const MAX_PATH_LENGTH = 1024;
const MAX_PATH_SEGMENTS = 64;

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "pdf", "zip", "gz", "tgz", "tar", "7z",
  "rar", "exe", "dll", "so", "dylib", "woff", "woff2", "ttf", "otf", "mp3", "mp4", "mov", "avi",
  "webm", "wasm", "class", "jar", "bin",
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  md: "markdown", markdown: "markdown", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  kt: "kotlin", swift: "swift", c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp",
  php: "php", sh: "bash", bash: "bash", zsh: "bash", sql: "sql", json: "json", yaml: "yaml",
  yml: "yaml", toml: "toml", xml: "xml", html: "html", css: "css", scss: "scss", less: "less",
  dockerfile: "docker", makefile: "makefile",
};

function normalizedRoot(value: unknown): RunFileRoot {
  if (value === undefined) return "task-space";
  if (value === "task-space" || value === "workspace") return value;
  throw new ValidationError("root", "必须是 task-space 或 workspace");
}

function assertRelativePath(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ValidationError("path", "必须是字符串");
  if (value === "") return "";
  if (value.length > MAX_PATH_LENGTH) throw new ValidationError("path", "过长");
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    throw new ValidationError("path", "必须是相对 POSIX 路径");
  }
  const segments = value.split("/");
  if (segments.length > MAX_PATH_SEGMENTS) throw new ValidationError("path", "段数过多");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new ValidationError("path", "不允许空段、. 或 ..");
    }
  }
  return value;
}

function joinPath(base: string, name: string): string {
  return base === "" ? name : `${base}/${name}`;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index + 1).toLowerCase();
}

function isBinaryExtension(name: string): boolean {
  return BINARY_EXTENSIONS.has(extensionOf(name));
}

function contentTypeOf(name: string, binary: boolean): string {
  if (binary) return "application/octet-stream";
  return extensionOf(name) === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8";
}

function languageOf(name: string, binary: boolean): string | null {
  if (binary) return null;
  return LANGUAGE_BY_EXTENSION[extensionOf(name)] ?? null;
}

function toEntry(base: string, entry: ClientRunFileEntry): RunFileEntry {
  const hidden = entry.name.startsWith(".");
  const previewable = entry.type === "file" && !isBinaryExtension(entry.name);
  return {
    name: entry.name,
    path: joinPath(base, entry.name),
    type: entry.type,
    sizeBytes: entry.sizeBytes,
    modifiedAt: entry.modifiedAt,
    hidden,
    previewable,
    contentType: previewable ? contentTypeOf(entry.name, false) : null,
    language: previewable ? languageOf(entry.name, false) : null,
  };
}

function stripIds(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.sessionId;
  delete copy.attemptId;
  return copy;
}

function toEvent(item: ClientSessionEvent): RunSessionEvent {
  return {
    seq: item.seq,
    ts: item.ts,
    kind: item.kind,
    event: item.event,
    ...(item.message === undefined ? {} : { message: item.message }),
    ...(item.data === undefined ? {} : { data: stripIds(item.data) as Record<string, unknown> }),
  };
}

function requireFiles(runtime: RunRuntime) {
  const port = runtime.deps.clientFiles;
  if (port === undefined) throw new ClientObservabilityUnavailableError("client 观测面未装配");
  return port;
}

function requireSessions(runtime: RunRuntime) {
  const port = runtime.deps.clientSessions;
  if (port === undefined) throw new ClientObservabilityUnavailableError("client 观测面未装配");
  return port;
}

async function sessionTarget(
  runtime: RunRuntime,
  input: { runId: string; nodeId: string; visit?: number },
): Promise<{ runId: string; nodeId: string; visit: number; sessionId: string; clientId: string }> {
  const run = await runtime.loadRun(input.runId);
  const node = await runtime.store.findNode(runtime.deps.db, run.id, input.nodeId, input.visit);
  if (node === null) throw new NotFoundError("节点", `${input.runId}/${input.nodeId}`);
  let sessionId = node.session_id;
  if ((sessionId === null || sessionId === "") && node.task_id !== null) {
    sessionId = await requireSessions(runtime).findSession({
      clientId: run.client_id,
      runId: run.id,
      nodeId: node.node_id,
      taskId: node.task_id,
    });
  }
  if (sessionId === null || sessionId === "") {
    throw new SessionNotLinkedError(input.runId, input.nodeId);
  }
  return {
    runId: run.id,
    nodeId: node.node_id,
    visit: node.visit,
    sessionId,
    clientId: run.client_id,
  };
}

async function listFiles(
  runtime: RunRuntime,
  input: { runId: string; root: RunFileRoot; path: string },
): Promise<RunFileListing> {
  const run = await runtime.loadRun(input.runId);
  const root = normalizedRoot(input.root);
  const path = assertRelativePath(input.path);
  const result = await requireFiles(runtime).listFiles({
    clientId: run.client_id,
    runId: run.id,
    root: root as ClientRunFileRoot,
    path,
  });
  return {
    runId: run.id,
    root,
    path,
    entries: result.entries.map((entry) => toEntry(path, entry)),
    truncated: result.truncated,
    fetchedAt: runtime.deps.clock.now().toISOString(),
  };
}

async function readFile(
  runtime: RunRuntime,
  input: { runId: string; root: RunFileRoot; path: string },
): Promise<RunFileContent> {
  const run = await runtime.loadRun(input.runId);
  const root = normalizedRoot(input.root);
  const path = assertRelativePath(input.path);
  if (path === "") throw new ValidationError("path", "不能为空");
  const result = await requireFiles(runtime).readFile({
    clientId: run.client_id,
    runId: run.id,
    root: root as ClientRunFileRoot,
    path,
  });
  const binary = result.binary;
  return {
    runId: run.id,
    root,
    path,
    name: result.name,
    sizeBytes: result.sizeBytes,
    modifiedAt: result.modifiedAt,
    contentType: contentTypeOf(result.name, binary),
    language: languageOf(result.name, binary),
    content: result.content,
    truncated: result.truncated,
    reason: binary ? "binary" : result.truncated ? "too_large" : null,
    fetchedAt: runtime.deps.clock.now().toISOString(),
  };
}

async function getSession(
  runtime: RunRuntime,
  input: { runId: string; nodeId: string; visit?: number },
): Promise<RunSessionView> {
  const target = await sessionTarget(runtime, input);
  const session = await requireSessions(runtime).getSession({
    clientId: target.clientId,
    sessionId: target.sessionId,
  });
  return {
    runId: target.runId,
    nodeId: target.nodeId,
    visit: target.visit,
    status: session.status,
    cwd: session.cwd,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    eventCount: session.eventCount,
    archive: {
      status: session.archive.status,
      sizeBytes: session.archive.sizeBytes,
      sha256: session.archive.sha256,
    },
  };
}

async function listSessionEvents(
  runtime: RunRuntime,
  input: { runId: string; nodeId: string; visit?: number; cursor?: string; limit?: number },
): Promise<RunSessionEventPage> {
  const target = await sessionTarget(runtime, input);
  const page = await requireSessions(runtime).listEvents({
    clientId: target.clientId,
    sessionId: target.sessionId,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  return {
    items: page.items.map(toEvent),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    ...(page.truncatedBefore === undefined ? {} : { truncatedBefore: page.truncatedBefore }),
  };
}

async function openSessionEvents(
  runtime: RunRuntime,
  input: { runId: string; nodeId: string; visit?: number; lastEventId?: string },
): Promise<ReadableStream<Uint8Array>> {
  const target = await sessionTarget(runtime, input);
  return requireSessions(runtime).openEvents({
    clientId: target.clientId,
    sessionId: target.sessionId,
    ...(input.lastEventId === undefined ? {} : { lastEventId: input.lastEventId }),
  });
}

async function openSessionRaw(
  runtime: RunRuntime,
  input: { runId: string; nodeId: string; visit?: number },
): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes: number; sha256: string; etag?: string }> {
  const target = await sessionTarget(runtime, input);
  return requireSessions(runtime).openRaw({
    clientId: target.clientId,
    sessionId: target.sessionId,
  });
}

export function createClientObservabilityQueries(runtime: RunRuntime) {
  return {
    listFiles: (input: { runId: string; root: RunFileRoot; path: string }) => listFiles(runtime, input),
    readFile: (input: { runId: string; root: RunFileRoot; path: string }) => readFile(runtime, input),
    getSession: (input: { runId: string; nodeId: string; visit?: number }) => getSession(runtime, input),
    listSessionEvents: (input: {
      runId: string;
      nodeId: string;
      visit?: number;
      cursor?: string;
      limit?: number;
    }) => listSessionEvents(runtime, input),
    openSessionEvents: (input: {
      runId: string;
      nodeId: string;
      visit?: number;
      lastEventId?: string;
    }) => openSessionEvents(runtime, input),
    openSessionRaw: (input: { runId: string; nodeId: string; visit?: number }) => openSessionRaw(runtime, input),
    async runIdForTask(taskId: string): Promise<string | null> {
      const node = await runtime.store.findNodeByTask(runtime.deps.db, taskId);
      return node?.run_id ?? null;
    },
  };
}
