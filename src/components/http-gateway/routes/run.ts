import { NotFoundError, ValidationError } from "../../../core/kernel/index.ts";
import type { RunService, RunState } from "../../run/index.ts";
import { RUN_START_FIELDS, RUN_DECISION_FIELDS } from "../fields.ts";
import { pagePayload } from "../queries.ts";
import { json } from "../respond.ts";
import { actorFrom, assertNodeId, assertUuid, parsePageQuery, queryValue, readJsonObject } from "../validation.ts";
import type { RouteContext } from "./types.ts";

const RUN_STATES: RunState[] = ["created", "running", "waiting_confirm", "done"];

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
  if (segments.length === 5 && segments[2] === "nodes" && segments[4] === "decision") {
    return decide(ctx, runService, id, assertNodeId(segments[3], "nodeId"));
  }
  if (segments.length === 5 && segments[2] === "nodes" && segments[4] === "session-log") {
    return sessionLog(ctx, runService, id, segments[3] ?? "");
  }
  throw new NotFoundError("路径", ctx.path);
}

export async function startRun(ctx: RouteContext, workflowId: string): Promise<Response> {
  const runService = requireRun(ctx);
  const body = await readJsonObject(ctx.request, RUN_START_FIELDS);
  const detail = await runService.start({
    workflowId,
    harnessId: String(body.harnessId ?? ""),
    workspacePath: String(body.workspacePath ?? ""),
    intentMarkdown: String(body.intentMarkdown ?? ""),
    ...(body.autoConfirm === undefined ? {} : { autoConfirm: body.autoConfirm === true }),
    actor: actorFrom(ctx.request, ctx.deps.actor),
  });
  return json({ runId: detail.runId }, 201, { Location: `/api/v1/runs/${detail.runId}` });
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
