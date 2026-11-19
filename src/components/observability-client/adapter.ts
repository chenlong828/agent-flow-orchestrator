import {
  AppError,
  ClientObservabilityHttpError,
  ClientObservabilityInvalidError,
  ClientObservabilityUnauthorizedError,
  ClientObservabilityUnavailableError,
  type ClientCredentialReader,
  type ClientRunFileContent,
  type ClientRunFileEntry,
  type ClientRunFileListing,
  type ClientRunFiles,
  type ClientSessionEvent,
  type ClientSessionEventPage,
  type ClientSessionObservability,
  type ClientSessionView,
  type ClientStream,
  type ObservabilityDirectory,
} from "../../core/kernel/index.ts";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_JSON_BYTES = 2 * 1024 * 1024;

export type ObservabilityClientOptions = {
  directory: ObservabilityDirectory;
  credentials: ClientCredentialReader;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxJsonBytes?: number;
};

export type ObservabilityClient = ClientRunFiles & ClientSessionObservability;

type Target = { base: string; token: string | null };

/** client 观测面的 HTTP 适配器；只做传输/鉴权/URL 校验/DTO 映射，不含编排规则。 */
export function createObservabilityClient(options: ObservabilityClientOptions): ObservabilityClient {
  return {
    findSession: (input) => findSession(options, input),
    listFiles: (input) => listFiles(options, input),
    readFile: (input) => readFile(options, input),
    getSession: (input) => getSession(options, input),
    listEvents: (input) => listEvents(options, input),
    openEvents: (input) => openEvents(options, input),
    openRaw: (input) => openRaw(options, input),
  };
}

async function resolveTarget(options: ObservabilityClientOptions, clientId: string): Promise<Target> {
  const resolved = options.directory.resolve(clientId);
  if (resolved === null) {
    throw new ClientObservabilityUnavailableError(`client ${clientId} 未登记观测面地址`);
  }
  const base = validateBase(resolved.url);
  const token = await options.credentials.clientToken(clientId);
  return { base, token };
}

async function requestJson<T>(
  options: ObservabilityClientOptions,
  clientId: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const target = await resolveTarget(options, clientId);
  const url = new URL(`${target.base}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const reason = new Error("timeout");
    reason.name = "AbortError";
    controller.abort(reason);
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(target.token === null ? {} : { authorization: `Bearer ${target.token}` }),
      },
      redirect: "manual",
      signal: controller.signal,
    });
    await assertOk(response);
    return await readJson<T>(response, options.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES);
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new ClientObservabilityUnavailableError("client 观测面超时", error);
    }
    if (error instanceof AppError) throw error;
    throw new ClientObservabilityUnavailableError("client 观测面不可达", error);
  } finally {
    clearTimeout(timer);
  }
}

async function assertOk(response: Response): Promise<void> {
  if (response.status === 401) throw new ClientObservabilityUnauthorizedError();
  if (response.status >= 500) throw new ClientObservabilityUnavailableError(`client 观测面返回 ${response.status}`);
  if (!response.ok) throw await httpError(response);
}

async function readJson<T>(response: Response, maxBytes: number): Promise<T> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ClientObservabilityInvalidError("client 观测面响应超过上限");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ClientObservabilityInvalidError("client 观测面响应超过上限");
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new ClientObservabilityInvalidError("client 观测面响应不是合法 JSON", error);
  }
}

async function requestStream(
  options: ObservabilityClientOptions,
  clientId: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const target = await resolveTarget(options, clientId);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(new URL(`${target.base}${path}`), {
      method: "GET",
      headers: {
        accept: "text/event-stream, application/octet-stream",
        ...headers,
        ...(target.token === null ? {} : { authorization: `Bearer ${target.token}` }),
      },
      redirect: "manual",
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new ClientObservabilityUnavailableError("client 观测面不可达", error);
  }
  await assertOk(response);
  if (response.body === null) throw new ClientObservabilityInvalidError("client 观测面响应无 body");
  return response;
}

async function httpError(response: Response): Promise<ClientObservabilityHttpError> {
  let code = `http_${response.status}`;
  let message = `client 观测面返回 ${response.status}`;
  try {
    const parsed = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof parsed.error?.code === "string") code = parsed.error.code;
    if (typeof parsed.error?.message === "string") message = parsed.error.message;
  } catch {
    // 4xx 错误体不是 JSON 时保留默认码。
  }
  return new ClientObservabilityHttpError(response.status, code, message);
}

async function findSession(
  options: ObservabilityClientOptions,
  input: { clientId: string; runId: string; nodeId: string; taskId: string },
): Promise<string | null> {
  const data = await requestJson<Record<string, unknown>>(options, input.clientId, "/attempts", {
    runId: input.runId,
    nodeId: input.nodeId,
    taskId: input.taskId,
    limit: 50,
  });
  const items = Array.isArray(data.items) ? data.items : [];
  let found: { attemptNo: number; sessionId: string } | null = null;
  for (const value of items) {
    if (typeof value !== "object" || value === null) continue;
    const item = value as Record<string, unknown>;
    if (typeof item.sessionId !== "string" || item.sessionId === "") continue;
    const attemptNo = typeof item.attemptNo === "number" ? item.attemptNo : 0;
    if (found === null || attemptNo >= found.attemptNo) found = { attemptNo, sessionId: item.sessionId };
  }
  return found?.sessionId ?? null;
}

async function listFiles(
  options: ObservabilityClientOptions,
  input: { clientId: string; runId: string; root: "task-space" | "workspace"; path: string },
): Promise<ClientRunFileListing> {
  const data = await requestJson<Record<string, unknown>>(
    options,
    input.clientId,
    `/runs/${encodeURIComponent(input.runId)}/files`,
    { root: input.root, path: input.path },
  );
  const entries = Array.isArray(data.entries) ? data.entries.map(toEntry) : null;
  if (entries === null) throw new ClientObservabilityInvalidError("files.entries 非法");
  return { entries, truncated: data.truncated === true };
}

async function readFile(
  options: ObservabilityClientOptions,
  input: { clientId: string; runId: string; root: "task-space" | "workspace"; path: string },
): Promise<ClientRunFileContent> {
  const data = await requestJson<Record<string, unknown>>(
    options,
    input.clientId,
    `/runs/${encodeURIComponent(input.runId)}/files/content`,
    { root: input.root, path: input.path },
  );
  return toContent(data);
}

async function getSession(
  options: ObservabilityClientOptions,
  input: { clientId: string; sessionId: string },
): Promise<ClientSessionView> {
  const data = await requestJson<Record<string, unknown>>(
    options,
    input.clientId,
    `/sessions/${encodeURIComponent(input.sessionId)}`,
  );
  return toSession(data);
}

async function listEvents(
  options: ObservabilityClientOptions,
  input: { clientId: string; sessionId: string; cursor?: string; limit?: number },
): Promise<ClientSessionEventPage> {
  const data = await requestJson<Record<string, unknown>>(
    options,
    input.clientId,
    `/sessions/${encodeURIComponent(input.sessionId)}/events`,
    { cursor: input.cursor, limit: input.limit },
  );
  const items = Array.isArray(data.items) ? data.items.map(toEvent) : null;
  if (items === null) throw new ClientObservabilityInvalidError("events.items 非法");
  return {
    items,
    ...(typeof data.nextCursor === "string" ? { nextCursor: data.nextCursor } : {}),
    ...(typeof data.truncatedBefore === "number" ? { truncatedBefore: data.truncatedBefore } : {}),
  };
}

async function openEvents(
  options: ObservabilityClientOptions,
  input: { clientId: string; sessionId: string; lastEventId?: string },
): Promise<ReadableStream<Uint8Array>> {
  const response = await requestStream(
    options,
    input.clientId,
    `/sessions/${encodeURIComponent(input.sessionId)}/events/stream`,
    input.lastEventId === undefined ? {} : { "last-event-id": input.lastEventId },
  );
  return stripSseIds(response.body as ReadableStream<Uint8Array>);
}

async function openRaw(
  options: ObservabilityClientOptions,
  input: { clientId: string; sessionId: string },
): Promise<ClientStream> {
  const response = await requestStream(options, input.clientId, `/sessions/${encodeURIComponent(input.sessionId)}/raw`);
  const sizeBytes = Number(response.headers.get("content-length") ?? "0");
  const sha256 = response.headers.get("x-checksum-sha256") ?? "";
  if (!Number.isFinite(sizeBytes) || sha256 === "") {
    throw new ClientObservabilityInvalidError("raw 响应缺少 content-length/x-checksum-sha256");
  }
  return {
    stream: response.body as ReadableStream<Uint8Array>,
    sizeBytes,
    sha256,
    ...(response.headers.get("etag") === null ? {} : { etag: response.headers.get("etag") as string }),
  };
}

function validateBase(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ClientObservabilityInvalidError("观测面地址不是合法 URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ClientObservabilityInvalidError("观测面地址必须是 http(s)");
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new ClientObservabilityInvalidError("观测面地址含 userinfo/fragment");
  }
  return url.toString().replace(/\/+$/, "");
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClientObservabilityInvalidError(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function toEntry(value: unknown): ClientRunFileEntry {
  const item = asRecord(value, "files.entries[]");
  const type = item.type;
  if (type !== "file" && type !== "dir" && type !== "symlink" && type !== "other") {
    throw new ClientObservabilityInvalidError("files.entries[].type 非法");
  }
  if (typeof item.name !== "string") throw new ClientObservabilityInvalidError("files.entries[].name 非法");
  return {
    name: item.name,
    type,
    sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : null,
    modifiedAt: typeof item.modifiedAt === "string" ? item.modifiedAt : "",
  };
}

function toContent(data: Record<string, unknown>): ClientRunFileContent {
  if (typeof data.name !== "string" || typeof data.sizeBytes !== "number") {
    throw new ClientObservabilityInvalidError("file content 字段非法");
  }
  return {
    name: data.name,
    sizeBytes: data.sizeBytes,
    modifiedAt: typeof data.modifiedAt === "string" ? data.modifiedAt : "",
    content: typeof data.content === "string" ? data.content : null,
    encoding: data.encoding === "utf-8" ? "utf-8" : null,
    binary: data.binary === true,
    truncated: data.truncated === true,
  };
}

function toSession(data: Record<string, unknown>): ClientSessionView {
  if (typeof data.sessionId !== "string" || typeof data.status !== "string") {
    throw new ClientObservabilityInvalidError("session 字段非法");
  }
  const archive = asRecord(data.archive ?? {}, "session.archive");
  return {
    sessionId: data.sessionId,
    ...(typeof data.attemptId === "string" ? { attemptId: data.attemptId } : {}),
    instanceId: typeof data.instanceId === "string" ? data.instanceId : "",
    nodeId: typeof data.nodeId === "string" ? data.nodeId : "",
    ...(typeof data.runId === "string" ? { runId: data.runId } : {}),
    cwd: typeof data.cwd === "string" ? data.cwd : "",
    status: data.status,
    startedAt: typeof data.startedAt === "string" ? data.startedAt : "",
    finishedAt: typeof data.finishedAt === "string" ? data.finishedAt : null,
    eventCount: typeof data.eventCount === "number" ? data.eventCount : 0,
    archive: {
      status: typeof archive.status === "string" ? archive.status : "pending",
      sizeBytes: typeof archive.sizeBytes === "number" ? archive.sizeBytes : null,
      sha256: typeof archive.sha256 === "string" ? archive.sha256 : null,
    },
  };
}

function toEvent(value: unknown): ClientSessionEvent {
  const item = asRecord(value, "events.items[]");
  if (typeof item.seq !== "number" || typeof item.kind !== "string" || typeof item.event !== "string") {
    throw new ClientObservabilityInvalidError("events.items[] 字段非法");
  }
  return {
    seq: item.seq,
    ts: typeof item.ts === "string" ? item.ts : "",
    ...(typeof item.sessionId === "string" ? { sessionId: item.sessionId } : {}),
    ...(typeof item.attemptId === "string" ? { attemptId: item.attemptId } : {}),
    kind: item.kind,
    event: item.event,
    ...(typeof item.message === "string" ? { message: item.message } : {}),
    ...(typeof item.data === "object" && item.data !== null && !Array.isArray(item.data)
      ? { data: item.data as Record<string, unknown> }
      : {}),
  };
}

/** 客户端 O-11 SSE 透传前剥掉 sessionId/attemptId；snapshot 与单事件都处理。 */
function stripSseIds(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          controller.enqueue(encoder.encode(`${rewriteFrame(frame)}\n\n`));
          index = buffer.indexOf("\n\n");
        }
      },
      flush(controller) {
        if (buffer.trim() !== "") controller.enqueue(encoder.encode(`${rewriteFrame(buffer)}\n\n`));
      },
    }),
  );
}

function rewriteFrame(frame: string): string {
  const lines = frame.split("\n");
  let event = "";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length !== 1) return frame;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines[0] as string);
  } catch {
    return frame;
  }
  if (event === "snapshot" && typeof parsed === "object" && parsed !== null) {
    const snapshot = parsed as Record<string, unknown>;
    const events = Array.isArray(snapshot.events) ? snapshot.events.map(stripIds) : snapshot.events;
    return lines.map((line) => line.startsWith("data:") ? `data: ${JSON.stringify({ ...snapshot, events })}` : line).join("\n");
  }
  if (event === "event") {
    return lines.map((line) => line.startsWith("data:") ? `data: ${JSON.stringify(stripIds(parsed))}` : line).join("\n");
  }
  return frame;
}

function stripIds(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.sessionId;
  delete copy.attemptId;
  return copy;
}
