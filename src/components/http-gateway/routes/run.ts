import { NotFoundError, ValidationError } from "../../../core/kernel/index.ts";
import type { RunFileRoot, RunService, RunState } from "../../run/index.ts";
import { RUN_START_FIELDS, RUN_DECISION_FIELDS } from "../fields.ts";
import { pagePayload } from "../queries.ts";
import { image, json } from "../respond.ts";
import { actorFrom, assertAllowedFields, assertNodeId, assertUuid, parsePageQuery, queryValue, readJsonObject } from "../validation.ts";
import type { RouteContext } from "./types.ts";

const RUN_STATES: RunState[] = ["created", "running", "waiting_confirm", "waiting_resume", "done"];

export async function handleRun(ctx: RouteContext): Promise<Response> {
  const { segments } = ctx;
  const runService = requireRun(ctx);
  if (segments.length === 1) return listRuns(ctx, runService);
  const id = assertUuid(segments[1], "id");
  if (segments.length === 2) {
    if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
    return json(await runService.get(id));
  }
  if (segments.length === 3 && segments[2] === "cancel") return cancelRun(ctx, runService, id);
  if (segments.length === 3 && segments[2] === "inputs") return listRunInputs(ctx, runService, id);
  if (segments.length === 5 && segments[2] === "inputs" && segments[4] === "content") {
    return readRunInput(ctx, runService, id, assertUuid(segments[3], "inputId"));
  }
  if (segments.length >= 3 && segments[2] === "nodes") return routeNodeResource(ctx, runService, id, segments);
  if (segments.length >= 3 && segments[2] === "files") return routeFileResource(ctx, runService, id, segments);
  throw new NotFoundError("路径", ctx.path);
}

function routeNodeResource(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  segments: string[],
): Promise<Response> {
  const nodeId = assertNodeId(segments[3], "nodeId");
  if (segments.length === 5 && segments[4] === "decision") return decide(ctx, runService, runId, nodeId);
  if (segments.length === 5 && segments[4] === "resume") return resumeNode(ctx, runService, runId, nodeId);
  if (segments.length === 5 && segments[4] === "session-log") return sessionLog(ctx, runService, runId, nodeId);
  if (segments[4] === "session") return routeSessionResource(ctx, runService, runId, nodeId, segments);
  throw new NotFoundError("路径", ctx.path);
}

function routeSessionResource(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  nodeId: string,
  segments: string[],
): Promise<Response> {
  if (segments.length === 5) return runSession(ctx, runService, runId, nodeId);
  if (segments.length === 6 && segments[5] === "events") return runSessionEvents(ctx, runService, runId, nodeId);
  if (segments.length === 6 && segments[5] === "raw") return runSessionRaw(ctx, runService, runId, nodeId);
  if (segments.length === 7 && segments[5] === "events" && segments[6] === "stream") {
    return runSessionStream(ctx, runService, runId, nodeId);
  }
  throw new NotFoundError("路径", ctx.path);
}

function routeFileResource(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  segments: string[],
): Promise<Response> {
  if (segments.length === 3) return runFiles(ctx, runService, runId);
  if (segments.length === 4 && segments[3] === "content") return runFileContent(ctx, runService, runId);
  throw new NotFoundError("路径", ctx.path);
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(field, "必须是非空字符串");
  }
  return value;
}

export async function startRun(ctx: RouteContext, workflowId: string): Promise<Response> {
  const runService = requireRun(ctx);
  const body = await readJsonObject(ctx.request, RUN_START_FIELDS);
  const harnessId = assertUuid(
    typeof body.harnessId === "string" ? body.harnessId : undefined,
    "harnessId",
  );
  const workspacePath = requiredString(body, "workspacePath");
  const intentMarkdown = requiredString(body, "intentMarkdown");
  let autoConfirm: boolean | undefined;
  if (body.autoConfirm !== undefined) {
    if (typeof body.autoConfirm !== "boolean") {
      throw new ValidationError("autoConfirm", "必须是布尔值");
    }
    autoConfirm = body.autoConfirm;
  }
  const inputs = parseStartInputs(body.inputs);
  const detail = await runService.start({
    workflowId,
    harnessId,
    workspacePath,
    intentMarkdown,
    ...(autoConfirm === undefined ? {} : { autoConfirm }),
    ...(inputs === undefined ? {} : { inputs }),
    actor: actorFrom(ctx.request, ctx.deps.actor),
  });
  return json({ runId: detail.runId }, 201, { Location: `/api/v1/runs/${detail.runId}` });
}

function parseStartInputs(value: unknown): { inputId: string }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError("inputs", "必须是数组");
  return value.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new ValidationError(`inputs[${index}]`, "必须是对象");
    }
    assertAllowedFields(item as Record<string, unknown>, ["inputId"], `inputs[${index}]`);
    const inputId = (item as Record<string, unknown>).inputId;
    return { inputId: assertUuid(typeof inputId === "string" ? inputId : undefined, `inputs[${index}].inputId`) };
  });
}

function listRunInputs(ctx: RouteContext, runService: RunService, runId: string): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  return runService.listInputs(runId).then((items) => json({ items }));
}

async function readRunInput(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  inputId: string,
): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const content = await runService.readInput(runId, inputId);
  return image(content);
}

function requireRun(ctx: RouteContext): RunService {
  if (ctx.deps.runService === undefined) throw new ValidationError("path", "运行编排未装配");
  return ctx.deps.runService;
}

async function listRuns(ctx: RouteContext, runService: RunService): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const state = queryValue(ctx.url, "state");
  if (state !== undefined && !RUN_STATES.includes(state as RunState)) {
    throw new ValidationError("state", `必须是 ${RUN_STATES.join(" / ")} 之一`);
  }
  const workflowId = queryValue(ctx.url, "workflowId");
  if (workflowId !== undefined) assertUuid(workflowId, "workflowId");
  const page = await runService.list({
    ...(workflowId === undefined ? {} : { workflowId }),
    ...(state === undefined ? {} : { state: state as RunState }),
    page: parsePageQuery(ctx.url),
  });
  return json(pagePayload(page));
}

async function cancelRun(ctx: RouteContext, runService: RunService, runId: string): Promise<Response> {
  if (ctx.request.method !== "POST") throw new NotFoundError("路径", ctx.path);
  return json(await runService.cancel(runId, actorFrom(ctx.request, ctx.deps.actor)));
}

async function decide(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  nodeId: string,
): Promise<Response> {
  if (ctx.request.method !== "POST") throw new NotFoundError("路径", ctx.path);
  const body = await readJsonObject(ctx.request, RUN_DECISION_FIELDS);
  if (body.decision !== "pass" && body.decision !== "reject") {
    throw new ValidationError("decision", "必须是 pass 或 reject");
  }
  return json(
    await runService.decide({
      runId,
      nodeId,
      decision: body.decision,
      comment: typeof body.comment === "string" ? body.comment : null,
      actor: actorFrom(ctx.request, ctx.deps.actor) ?? null,
    }),
  );
}

async function resumeNode(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  nodeId: string,
): Promise<Response> {
  if (ctx.request.method !== "POST") throw new NotFoundError("路径", ctx.path);
  return json(
    await runService.resumeNode({
      runId,
      nodeId,
      actor: actorFrom(ctx.request, ctx.deps.actor) ?? null,
    }),
  );
}

async function sessionLog(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  nodeId: string,
): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  assertNodeId(nodeId, "nodeId");
  const visit = queryValue(ctx.url, "visit");
  const attempt = queryValue(ctx.url, "attempt");
  const parsedVisit = visit === undefined ? undefined : Number(visit);
  if (parsedVisit !== undefined && (!Number.isInteger(parsedVisit) || parsedVisit < 1)) {
    throw new ValidationError("visit", "必须是正整数");
  }
  const parsedAttempt = attempt === undefined ? undefined : Number(attempt);
  if (parsedAttempt !== undefined && (!Number.isInteger(parsedAttempt) || parsedAttempt < 1)) {
    throw new ValidationError("attempt", "必须是正整数");
  }
  const log = await runService.readSessionLog({
    runId,
    nodeId,
    ...(parsedVisit === undefined ? {} : { visit: parsedVisit }),
    ...(parsedAttempt === undefined ? {} : { attempt: parsedAttempt }),
  });
  if (log === null) throw new NotFoundError("会话日志", `${runId}/${nodeId}`);
  return new Response(log.stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson",
      "content-encoding": "gzip",
      "content-length": String(log.sizeBytes),
      "x-checksum-sha256": log.sha256,
      "x-content-type-options": "nosniff",
    },
  });
}


function runRoot(value: string | undefined): RunFileRoot {
  if (value === undefined || value === "") return "task-space";
  if (value === "task-space" || value === "workspace") return value;
  throw new ValidationError("root", "必须是 task-space 或 workspace");
}

function runVisit(ctx: RouteContext): number | undefined {
  const raw = queryValue(ctx.url, "visit");
  if (raw === undefined) return undefined;
  const visit = Number(raw);
  if (!Number.isInteger(visit) || visit < 1) throw new ValidationError("visit", "必须是正整数");
  return visit;
}

function runLimit(ctx: RouteContext): number | undefined {
  const raw = queryValue(ctx.url, "limit");
  if (raw === undefined) return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new ValidationError("limit", "必须是 1..1000 的整数");
  }
  return limit;
}

async function runFiles(ctx: RouteContext, runService: RunService, runId: string): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  return json(
    await runService.listFiles({
      runId,
      root: runRoot(queryValue(ctx.url, "root")),
      path: queryValue(ctx.url, "path") ?? "",
    }),
  );
}

async function runFileContent(ctx: RouteContext, runService: RunService, runId: string): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const path = queryValue(ctx.url, "path");
  if (path === undefined || path === "") throw new ValidationError("path", "不能为空");
  return json(
    await runService.readFile({
      runId,
      root: runRoot(queryValue(ctx.url, "root")),
      path,
    }),
  );
}

async function runSession(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  nodeId: string,
): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const visit = runVisit(ctx);
  return json(
    await runService.getSession({
      runId,
      nodeId,
      ...(visit === undefined ? {} : { visit }),
    }),
  );
}

async function runSessionEvents(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  nodeId: string,
): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const visit = runVisit(ctx);
  const limit = runLimit(ctx);
  const cursor = queryValue(ctx.url, "cursor");
  return json(
    await runService.listSessionEvents({
      runId,
      nodeId,
      ...(visit === undefined ? {} : { visit }),
      ...(limit === undefined ? {} : { limit }),
      ...(cursor === undefined ? {} : { cursor }),
    }),
  );
}

async function runSessionStream(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  nodeId: string,
): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const visit = runVisit(ctx);
  const stream = await runService.openSessionEvents({
    runId,
    nodeId,
    ...(visit === undefined ? {} : { visit }),
    ...(ctx.request.headers.get("last-event-id") === null
      ? {}
      : { lastEventId: ctx.request.headers.get("last-event-id") as string }),
  });
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

async function runSessionRaw(
  ctx: RouteContext,
  runService: RunService,
  runId: string,
  nodeId: string,
): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const visit = runVisit(ctx);
  const raw = await runService.openSessionRaw({
    runId,
    nodeId,
    ...(visit === undefined ? {} : { visit }),
  });
  return new Response(raw.stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zstd",
      "content-length": String(raw.sizeBytes),
      "x-checksum-sha256": raw.sha256,
      ...(raw.etag === undefined ? {} : { etag: raw.etag }),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
