import { createHash } from "node:crypto";
import {
  EXECUTOR_PROTOCOL_VERSION,
  MAX_ARCHIVE_BYTES,
  MAX_SESSION_LOG_BYTES,
  POLL_HOLD_MS,
  PackageNotFoundError,
  PayloadTooLargeError,
  UnauthorizedError,
  UnsupportedProtocolError,
  ValidationError,
} from "../../../core/kernel/index.ts";
import { errorResponse, json } from "../respond.ts";
import {
  POLL_FIELDS,
  RESULT_FIELDS,
  parsePollBody,
  parseResultBody,
  readJson,
} from "./executor-request.ts";
import type { ExecutorDeps, ExecutorPackageRef, ExecutorTask } from "./executor-types.ts";

export type { ExecutorBackend, ExecutorDeps } from "./executor-types.ts";

type ExecutorContext = {
  request: Request;
  segments: string[];
  deps: ExecutorDeps;
};

/** 执行面入口：只处理 `/api/v1/executor/*`，其余返回 null 交给产品路由。 */
export async function handleExecutor(
  request: Request,
  segments: string[],
  deps: ExecutorDeps,
): Promise<Response | null> {
  if (segments[0] !== "executor") return null;
  const requestId = request.headers.get("x-request-id") ?? undefined;
  try {
    assertProtocol(request);
    const identity = await authenticate(request, deps);
    if (identity.source === "header" && deps.ensureNode !== undefined) {
      const address = request.headers.get(CLIENT_ADDRESS_HEADER)?.trim();
      await deps.ensureNode(identity.clientId, address === "" ? undefined : address);
    }
    const response = await route({ request, segments, deps }, identity.clientId);
    if (requestId !== undefined && requestId !== "") {
      response.headers.set("x-request-id", requestId);
    }
    return response;
  } catch (error) {
    const response = errorResponse(error, requestId);
    if (requestId !== undefined && requestId !== "") {
      response.headers.set("x-request-id", requestId);
    }
    return response;
  }
}

function assertProtocol(request: Request): void {
  const header = request.headers.get("x-executor-protocol");
  if (header === null || header.trim() !== String(EXECUTOR_PROTOCOL_VERSION)) {
    throw new UnsupportedProtocolError(EXECUTOR_PROTOCOL_VERSION, header);
  }
}

const CLIENT_ID_HEADER = "x-client-id";
const CLIENT_ADDRESS_HEADER = "x-client-address";

type Identity = { clientId: string; source: "bearer" | "header" };

/**
 * 身份解析：能命中的 Bearer 优先（存量节点、测试与 `EXECUTOR_AUTH=on` 不受影响）；
 * `authMode=off` 时回退到 `X-Client-Id`；两者都没有则 `401 unauthorized`。
 */
async function authenticate(request: Request, deps: ExecutorDeps): Promise<Identity> {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim();
    if (token !== undefined && token !== "") {
      const clientId = await deps.backend.resolveClientId(token);
      if (clientId !== null) return { clientId, source: "bearer" };
    }
  }
  if ((deps.authMode ?? "on") === "off") {
    const declared = request.headers.get(CLIENT_ID_HEADER)?.trim();
    if (declared !== undefined && declared !== "") {
      return { clientId: declared, source: "header" };
    }
  }
  throw new UnauthorizedError();
}

type Matcher = (ctx: ExecutorContext, clientId: string) => Promise<Response> | null;

function matchPoll(ctx: ExecutorContext, clientId: string): Promise<Response> | null {
  if (ctx.segments.length !== 2 || ctx.segments[1] !== "poll") return null;
  if (ctx.request.method !== "POST") return null;
  return poll(ctx, clientId);
}

function matchResult(ctx: ExecutorContext, clientId: string): Promise<Response> | null {
  const taskId = ctx.segments[2];
  if (ctx.segments[1] !== "tasks" || ctx.segments[3] !== "result") return null;
  if (taskId === undefined || ctx.request.method !== "POST") return null;
  return acceptResult(ctx, clientId, taskId);
}

function matchSessionLog(ctx: ExecutorContext, clientId: string): Promise<Response> | null {
  const taskId = ctx.segments[2];
  if (ctx.segments[1] !== "tasks" || ctx.segments[3] !== "session-log") return null;
  if (taskId === undefined || ctx.request.method !== "POST") return null;
  return uploadSessionLog(ctx, clientId, taskId);
}

function matchArchive(ctx: ExecutorContext, clientId: string): Promise<Response> | null {
  const runId = ctx.segments[2];
  if (ctx.segments[1] !== "runs" || ctx.segments[3] !== "archive") return null;
  if (runId === undefined || ctx.request.method !== "POST") return null;
  return uploadArchive(ctx, clientId, runId);
}

function matchSkillPackage(ctx: ExecutorContext, clientId: string): Promise<Response> | null {
  const packageId = ctx.segments[2];
  if (ctx.segments[1] !== "skill-packages" || ctx.segments.length !== 3) return null;
  if (packageId === undefined || ctx.request.method !== "GET") return null;
  return skillPackage(ctx, packageId);
}

async function route(ctx: ExecutorContext, clientId: string): Promise<Response> {
  const matchers: Matcher[] = [
    matchPoll,
    matchResult,
    matchSessionLog,
    matchArchive,
    matchSkillPackage,
  ];
  for (const matcher of matchers) {
    const response = await matcher(ctx, clientId);
    if (response !== null) return response;
  }
  throw new ValidationError("path", "执行面路径不支持");
}

function withDownloadUrl(task: ExecutorTask): ExecutorTask & { skillSet: { packages: (ExecutorPackageRef & { downloadUrl: string })[] } } {
  return {
    ...task,
    skillSet: {
      digest: task.skillSet.digest,
      packages: task.skillSet.packages.map((item) => ({
        ...item,
        downloadUrl: `/api/v1/executor/skill-packages/${item.packageId}`,
      })),
    },
  };
}

async function poll(ctx: ExecutorContext, clientId: string): Promise<Response> {
  const report = parsePollBody(await readJson(ctx.request, POLL_FIELDS));
  const decision = await ctx.deps.backend.poll(clientId, report, {
    holdMs: ctx.deps.pollHoldMs ?? POLL_HOLD_MS,
  });
  if (report.archivedRuns !== undefined) {
    // 归档确认只做电平确认，失败不影响本次 poll。
    await ctx.deps.backend.ackArchived?.(clientId, report.archivedRuns);
  }
  return json({
    tasks: decision.tasks.map(withDownloadUrl),
    stop: decision.stop,
    cancelInstances: decision.cancelInstances,
    archiveRequests: decision.archiveRequests ?? [],
    nextPollAfterMs: decision.nextPollAfterMs,
  });
}

async function acceptResult(ctx: ExecutorContext, clientId: string, taskId: string): Promise<Response> {
  const result = parseResultBody(await readJson(ctx.request, RESULT_FIELDS), taskId);
  return json(await ctx.deps.backend.acceptResult(clientId, result));
}

function queryAttempt(url: string): number {
  const attempt = Number(new URL(url).searchParams.get("attempt"));
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 100) {
    throw new ValidationError("attempt", "必须是 1–100 的整数");
  }
  return attempt;
}

async function readBinary(request: Request, limit: number, name: "session_log_bytes" | "archive_bytes"): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    throw new PayloadTooLargeError(name, limit, declared);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) {
    throw new PayloadTooLargeError(name, limit, bytes.byteLength);
  }
  return bytes;
}

async function uploadSessionLog(ctx: ExecutorContext, clientId: string, taskId: string): Promise<Response> {
  const attempt = queryAttempt(ctx.request.url);
  const upload = ctx.deps.backend.uploadSessionLog;
  if (upload === undefined) throw new ValidationError("path", "执行面未装配运行编排");
  const bytes = await readBinary(ctx.request, MAX_SESSION_LOG_BYTES, "session_log_bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ack = await upload({ clientId, taskId, attempt, bytes, sha256 });
  return json({ taskId, attempt, bytes: bytes.byteLength, sha256, stored: ack.stored });
}

async function uploadArchive(ctx: ExecutorContext, clientId: string, runId: string): Promise<Response> {
  const upload = ctx.deps.backend.uploadArchive;
  if (upload === undefined) throw new ValidationError("path", "执行面未装配运行编排");
  const bytes = await readBinary(ctx.request, MAX_ARCHIVE_BYTES, "archive_bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ack = await upload({ clientId, runId, bytes, sha256 });
  return json({ runId, bytes: bytes.byteLength, sha256, stored: ack.stored });
}

async function skillPackage(ctx: ExecutorContext, packageId: string): Promise<Response> {
  const described = await ctx.deps.backend.describePackage(packageId);
  if (described === null) throw new PackageNotFoundError(packageId);
  const ifNoneMatch = ctx.request.headers.get("if-none-match")?.trim();
  if (ifNoneMatch === described.etag) {
    return new Response(null, { status: 304, headers: { etag: described.etag } });
  }
  const { ref, data } = await ctx.deps.backend.openPackage(packageId);
  return new Response(data as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-length": String(data.byteLength),
      etag: ref.etag,
      "x-checksum-sha256": ref.digest.replace(/^sha256:/, ""),
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

