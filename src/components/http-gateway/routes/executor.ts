import {
  EXECUTOR_PROTOCOL_VERSION,
  POLL_HOLD_MS,
  PackageNotFoundError,
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
    const clientId = await authenticate(request, deps.backend);
    const response = await route({ request, segments, deps }, clientId);
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

async function authenticate(
  request: Request,
  backend: ExecutorDeps["backend"],
): Promise<string> {
  const header = request.headers.get("authorization");
  if (header === null) throw new UnauthorizedError();
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (token === undefined || token === "") throw new UnauthorizedError();
  const clientId = await backend.resolveClientId(token);
  if (clientId === null) throw new UnauthorizedError();
  return clientId;
}

async function route(ctx: ExecutorContext, clientId: string): Promise<Response> {
  const { request, segments } = ctx;
  if (segments.length === 2 && segments[1] === "poll" && request.method === "POST") {
    return poll(ctx, clientId);
  }
  const taskId = segments[2];
  if (segments[1] === "tasks" && segments[3] === "result" && taskId !== undefined && request.method === "POST") {
    return acceptResult(ctx, clientId, taskId);
  }
  const packageId = segments[2];
  if (segments[1] === "skill-packages" && segments.length === 3 && packageId !== undefined && request.method === "GET") {
    return skillPackage(ctx, packageId);
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
  return json({
    tasks: decision.tasks.map(withDownloadUrl),
    stop: decision.stop,
    cancelInstances: decision.cancelInstances,
    nextPollAfterMs: decision.nextPollAfterMs,
  });
}

async function acceptResult(ctx: ExecutorContext, clientId: string, taskId: string): Promise<Response> {
  const result = parseResultBody(await readJson(ctx.request, RESULT_FIELDS), taskId);
  return json(await ctx.deps.backend.acceptResult(clientId, result));
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

