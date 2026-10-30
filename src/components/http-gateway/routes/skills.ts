import { NotFoundError, ValidationError } from "../../../core/kernel/index.ts";
import { pagePayload, parseSkillListQuery } from "../queries.ts";
import { json, markdown, noContent, notModified } from "../respond.ts";
import {
  actorFrom,
  assertUuid,
  parseIfMatch,
  readJsonObject,
} from "../validation.ts";
import type { RouteContext } from "./types.ts";

export async function handleSkills(ctx: RouteContext): Promise<Response> {
  const { segments } = ctx;
  if (segments.length === 1) return listSkills(ctx);
  const id = assertUuid(segments[1], "id");
  if (segments.length === 2) return skillById(ctx, id);
  if (segments.length === 3) return skillSubresource(ctx, id, segments[2]);
  throw new NotFoundError("路径", ctx.path);
}

async function listSkills(ctx: RouteContext): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const page = await ctx.deps.catalog.listSkills(parseSkillListQuery(ctx.url));
  return json(pagePayload(page));
}

async function skillById(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method === "GET") {
    return json(await ctx.deps.catalog.getSkill(id));
  }
  if (ctx.request.method === "DELETE") {
    await ctx.deps.skillDraftService.delete(id, parseIfMatch(ctx.request));
    return noContent();
  }
  throw new NotFoundError("路径", ctx.path);
}

async function skillSubresource(
  ctx: RouteContext,
  id: string,
  subresource: string | undefined,
): Promise<Response> {
  switch (subresource) {
    case "document":
      return skillDocument(ctx, id);
    case "download":
      return skillDownload(ctx, id);
    case "references":
      return skillReferences(ctx, id);
    case "enabled":
      return skillEnabled(ctx, id);
    default:
      throw new NotFoundError("路径", ctx.path);
  }
}

async function skillDocument(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const document = await ctx.deps.catalog.getSkillDocument(id);
  const etag = `"${document.revision}"`;
  if (ctx.request.headers.get("if-none-match")?.trim() === etag) return notModified();
  return markdown(document.markdown, { etag, "cache-control": "no-cache" });
}

async function skillDownload(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const skill = await ctx.deps.catalog.getSkill(id);
  const packageFile = await ctx.deps.catalog.getSkillPackage(id);
  const etag = `"${skill.revision}"`;
  if (ctx.request.headers.get("if-none-match")?.trim() === etag) return notModified();
  const asciiName = packageFile.fileName.replace(/[^\x20-\x7e]/g, "_");
  const disposition =
    `attachment; filename="${asciiName}"; ` +
    `filename*=UTF-8''${encodeURIComponent(packageFile.fileName)}`;
  return new Response(packageFile.data as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": disposition,
      "x-content-type-options": "nosniff",
      etag,
      "cache-control": "no-cache",
    },
  });
}

async function skillReferences(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  return json(await ctx.deps.catalog.referencesForSkill(id));
}

async function skillEnabled(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "PATCH") throw new NotFoundError("路径", ctx.path);
  const revision = parseIfMatch(ctx.request);
  const body = await readJsonObject(ctx.request, ["enabled"]);
  if (typeof body.enabled !== "boolean") {
    throw new ValidationError("enabled", "必须是布尔值");
  }
  await ctx.deps.skillDraftService.setEnabled(
    id,
    revision,
    body.enabled,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(await ctx.deps.catalog.getSkill(id));
}
