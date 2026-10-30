import {
  NotFoundError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../../../core/kernel/index.ts";
import type { SaveSkill } from "../../skill/contract.ts";
import { SKILL_SAVE_FIELDS } from "../fields.ts";
import { json, noContent } from "../respond.ts";
import {
  actorFrom,
  assertUuid,
  parseIfMatch,
  readJsonObject,
  readOptionalJsonObject,
} from "../validation.ts";
import type { RouteContext } from "./types.ts";

export async function handleSkillDrafts(ctx: RouteContext): Promise<Response> {
  const { segments } = ctx;
  if (segments.length === 1) return createDraft(ctx);
  const id = assertUuid(segments[1], "id");
  if (segments.length === 2) return draftById(ctx, id);
  if (segments.length === 3) return draftSubresource(ctx, id, segments[2]);
  throw new NotFoundError("路径", ctx.path);
}

async function createDraft(ctx: RouteContext): Promise<Response> {
  if (ctx.request.method !== "POST") throw new NotFoundError("路径", ctx.path);
  const body = await readOptionalJsonObject(ctx.request, ["skillId"]);
  const skillId = body.skillId;
  if (skillId !== undefined && skillId !== null) {
    if (typeof skillId !== "string") {
      throw new ValidationError("skillId", "必须是 UUID");
    }
    assertUuid(skillId, "skillId");
  }
  const draft = await ctx.deps.skillDraftService.createDraft(
    (skillId as string | null | undefined) ?? null,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(draft, 201, { Location: `/api/v1/skill-drafts/${draft.id}` });
}

async function draftById(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method === "GET") {
    return json(await ctx.deps.skillDraftService.getDraft(id));
  }
  if (ctx.request.method === "DELETE") {
    await ctx.deps.skillDraftService.cancelDraft(id);
    return noContent();
  }
  throw new NotFoundError("路径", ctx.path);
}

async function draftSubresource(
  ctx: RouteContext,
  id: string,
  subresource: string | undefined,
): Promise<Response> {
  switch (subresource) {
    case "files":
      return draftFiles(ctx, id);
    case "save":
      return saveDraft(ctx, id);
    default:
      throw new NotFoundError("路径", ctx.path);
  }
}

async function draftFiles(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method === "POST") return uploadDraftFile(ctx, id);
  if (ctx.request.method === "PATCH") return renameDraftFile(ctx, id);
  if (ctx.request.method === "DELETE") return deleteDraftFile(ctx, id);
  throw new NotFoundError("路径", ctx.path);
}

async function uploadDraftFile(ctx: RouteContext, id: string): Promise<Response> {
  const contentType = ctx.request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new UnsupportedMediaTypeError();
  }
  const form = await ctx.request.formData();
  const pathValue = form.get("path");
  const fileValue = form.get("file");
  if (typeof pathValue !== "string" || pathValue === "") {
    throw new ValidationError("path", "缺少 path 字段");
  }
  if (!(fileValue instanceof File)) {
    throw new ValidationError("file", "缺少 file 字段");
  }
  const data = new Uint8Array(await fileValue.arrayBuffer());
  return json(await ctx.deps.skillDraftService.uploadDraftFile(id, pathValue, data));
}

async function renameDraftFile(ctx: RouteContext, id: string): Promise<Response> {
  const body = await readJsonObject(ctx.request, ["path", "newPath"]);
  if (typeof body.path !== "string" || typeof body.newPath !== "string") {
    throw new ValidationError("path", "path 与 newPath 必须是字符串");
  }
  return json(
    await ctx.deps.skillDraftService.renameDraftFile(id, body.path, body.newPath),
  );
}

async function deleteDraftFile(ctx: RouteContext, id: string): Promise<Response> {
  const pathValue = ctx.url.searchParams.get("path");
  if (pathValue === null || pathValue === "") {
    throw new ValidationError("path", "缺少 path 查询参数");
  }
  await ctx.deps.skillDraftService.deleteDraftFile(id, pathValue);
  return noContent();
}

async function saveDraft(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "POST") throw new NotFoundError("路径", ctx.path);
  const rawIfMatch = ctx.request.headers.get("if-match");
  const baseRevision =
    rawIfMatch === null || rawIfMatch === "" ? null : parseIfMatch(ctx.request);
  const body = await readJsonObject(ctx.request, SKILL_SAVE_FIELDS);
  const { created, ...saved } = await ctx.deps.skillDraftService.saveDraft(
    id,
    baseRevision,
    body as unknown as SaveSkill,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(saved, created ? 201 : 200, {
    Location: `/api/v1/skills/${saved.id}`,
  });
}
