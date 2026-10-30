import { NotFoundError, ValidationError } from "../../../core/kernel/index.ts";
import type {
  CreateExpert,
  UpdateExpert,
  UpdateExpertAggregate,
} from "../../expert/index.ts";
import {
  assemblyIds,
  validateNestedRefs,
  validateOptionalIdArray,
} from "../dto.ts";
import {
  EXPERT_CREATE_FIELDS,
  EXPERT_PATCH_FIELDS,
  EXPERT_WRITE_FIELDS,
} from "../fields.ts";
import { pagePayload, parseExpertListQuery } from "../queries.ts";
import { json, noContent } from "../respond.ts";
import { actorFrom, assertUuid, parseIfMatch, readJsonObject } from "../validation.ts";
import type { RouteContext } from "./types.ts";

export async function handleExpert(ctx: RouteContext): Promise<Response> {
  const { segments } = ctx;
  if (segments.length === 1) return expertCollection(ctx);
  const id = assertUuid(segments[1], "id");
  if (segments.length === 2) return expertById(ctx, id);
  if (segments.length === 3) return expertSubresource(ctx, id, segments[2]);
  throw new NotFoundError("路径", ctx.path);
}

async function expertCollection(ctx: RouteContext): Promise<Response> {
  if (ctx.request.method === "GET") {
    const page = await ctx.deps.catalog.listExperts(parseExpertListQuery(ctx.url));
    return json(pagePayload(page));
  }
  if (ctx.request.method === "POST") return createExpert(ctx);
  throw new NotFoundError("路径", ctx.path);
}

async function createExpert(ctx: RouteContext): Promise<Response> {
  const body = await readJsonObject(ctx.request, EXPERT_CREATE_FIELDS);
  validateNestedRefs(body, "refs");
  validateOptionalIdArray(body, "skillIds");
  validateOptionalIdArray(body, "toolIds");
  const created = await ctx.deps.expertService.create(
    body as unknown as CreateExpert,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  const detail = await ctx.deps.catalog.getExpert(created.id);
  return json(detail, 201, { Location: `/api/v1/experts/${created.id}` });
}

async function expertById(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method === "GET") return json(await ctx.deps.catalog.getExpert(id));
  if (ctx.request.method === "PUT") return replaceExpert(ctx, id);
  if (ctx.request.method === "PATCH") return patchExpert(ctx, id);
  if (ctx.request.method === "DELETE") return deleteExpert(ctx, id);
  throw new NotFoundError("路径", ctx.path);
}

async function replaceExpert(ctx: RouteContext, id: string): Promise<Response> {
  const revision = parseIfMatch(ctx.request);
  const body = await readJsonObject(ctx.request, EXPERT_WRITE_FIELDS);
  validateNestedRefs(body, "refs");
  await ctx.deps.expertService.update(
    id,
    revision,
    body as unknown as UpdateExpert,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(await ctx.deps.catalog.getExpert(id));
}

async function patchExpert(ctx: RouteContext, id: string): Promise<Response> {
  const revision = parseIfMatch(ctx.request);
  const body = await readJsonObject(ctx.request, EXPERT_PATCH_FIELDS);
  validateNestedRefs(body, "refs");
  validateOptionalIdArray(body, "skillIds");
  validateOptionalIdArray(body, "toolIds");
  await ctx.deps.expertService.updateAggregate(
    id,
    revision,
    body as unknown as UpdateExpertAggregate,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(await ctx.deps.catalog.getExpert(id));
}

async function deleteExpert(ctx: RouteContext, id: string): Promise<Response> {
  await ctx.deps.expertService.delete(id, parseIfMatch(ctx.request));
  return noContent();
}

async function expertSubresource(
  ctx: RouteContext,
  id: string,
  subresource: string | undefined,
): Promise<Response> {
  switch (subresource) {
    case "enabled":
      return setExpertEnabled(ctx, id);
    case "skills":
      return replaceExpertSkills(ctx, id);
    case "tools":
      return replaceExpertTools(ctx, id);
    default:
      throw new NotFoundError("路径", ctx.path);
  }
}

async function setExpertEnabled(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "PATCH") throw new NotFoundError("路径", ctx.path);
  const revision = parseIfMatch(ctx.request);
  const body = await readJsonObject(ctx.request, ["enabled"]);
  if (typeof body.enabled !== "boolean") {
    throw new ValidationError("enabled", "必须是布尔值");
  }
  await ctx.deps.expertService.setEnabled(
    id,
    revision,
    body.enabled,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(await ctx.deps.catalog.getExpert(id));
}

async function replaceExpertSkills(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "PUT") throw new NotFoundError("路径", ctx.path);
  const revision = parseIfMatch(ctx.request);
  const body = await readJsonObject(ctx.request, ["items"]);
  const ids = assemblyIds(body, "skillId");
  await ctx.deps.expertService.setSkills(
    id,
    revision,
    ids,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(await ctx.deps.catalog.getExpert(id));
}

async function replaceExpertTools(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "PUT") throw new NotFoundError("路径", ctx.path);
  const revision = parseIfMatch(ctx.request);
  const body = await readJsonObject(ctx.request, ["items"]);
  const ids = assemblyIds(body, "toolId");
  await ctx.deps.expertService.setTools(
    id,
    revision,
    ids,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(await ctx.deps.catalog.getExpert(id));
}
