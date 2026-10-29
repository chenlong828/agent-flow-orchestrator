import {
  NotFoundError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../../../core/kernel/index.ts";
import type { SaveSkill } from "../../skill/contract.ts";
import { SKILL_SAVE_FIELDS } from "../fields.ts";
import { pagePayload, parseSkillListQuery } from "../queries.ts";
import { json, markdown, noContent, notModified } from "../respond.ts";
import {
  actorFrom,
  assertUuid,
  parseIfMatch,
  readJsonObject,
  readOptionalJsonObject,
} from "../validation.ts";
import type { RouteContext } from "./types.ts";

export async function handleSkill(ctx: RouteContext): Promise<Response> {
  const { request, url, path, segments, deps } = ctx;
  const { catalog, skillDraftService, actor } = deps;
  const resource = segments[0]!;

  if (segments.length === 1) {
    if (resource === "skills" && request.method === "GET") {
      const page = await catalog.listSkills(parseSkillListQuery(url));
      return json(pagePayload(page));
    }
    if (resource === "skill-drafts" && request.method === "POST") {
      const body = await readOptionalJsonObject(request, ["skillId"]);
      const skillId = body.skillId;
      if (skillId !== undefined && skillId !== null) {
        if (typeof skillId !== "string") {
          throw new ValidationError("skillId", "必须是 UUID");
        }
        assertUuid(skillId, "skillId");
      }
      const draft = await skillDraftService.createDraft(
        (skillId as string | null | undefined) ?? null,
        actorFrom(request, actor),
      );
      return json(draft, 201, { Location: `/api/v1/skill-drafts/${draft.id}` });
    }
    throw new NotFoundError("路径", path);
  }

  const id = assertUuid(segments[1]!, "id");

  if (segments.length === 2) {
    if (resource === "skills" && request.method === "GET") {
      return json(await catalog.getSkill(id));
    }
    if (resource === "skills" && request.method === "DELETE") {
      await skillDraftService.delete(id, parseIfMatch(request));
      return noContent();
    }
    if (resource === "skill-drafts" && request.method === "GET") {
      return json(await skillDraftService.getDraft(id));
    }
    if (resource === "skill-drafts" && request.method === "DELETE") {
      await skillDraftService.cancelDraft(id);
      return noContent();
    }
    throw new NotFoundError("路径", path);
  }

  if (segments.length === 3) {
    const subresource = segments[2]!;

    if (resource === "skills" && subresource === "document" && request.method === "GET") {
      const document = await catalog.getSkillDocument(id);
      const etag = `"${document.revision}"`;
      if (request.headers.get("if-none-match")?.trim() === etag) return notModified();
      return markdown(document.markdown, { etag, "cache-control": "no-cache" });
    }

    if (resource === "skills" && subresource === "download" && request.method === "GET") {
      const skill = await catalog.getSkill(id);
      const packageFile = await catalog.getSkillPackage(id);
      const etag = `"${skill.revision}"`;
      if (request.headers.get("if-none-match")?.trim() === etag) return notModified();
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

    if (resource === "skills" && subresource === "references" && request.method === "GET") {
      return json(await catalog.referencesForSkill(id));
    }

    if (resource === "skills" && subresource === "enabled" && request.method === "PATCH") {
      const revision = parseIfMatch(request);
      const body = await readJsonObject(request, ["enabled"]);
      if (typeof body.enabled !== "boolean") {
        throw new ValidationError("enabled", "必须是布尔值");
      }
      await skillDraftService.setEnabled(id, revision, body.enabled, actorFrom(request, actor));
      return json(await catalog.getSkill(id));
    }

    if (resource === "skill-drafts" && subresource === "files") {
      if (request.method === "POST") {
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
          throw new UnsupportedMediaTypeError();
        }
        const form = await request.formData();
        const pathValue = form.get("path");
        const fileValue = form.get("file");
        if (typeof pathValue !== "string" || pathValue === "") {
          throw new ValidationError("path", "缺少 path 字段");
        }
        if (!(fileValue instanceof File)) {
          throw new ValidationError("file", "缺少 file 字段");
        }
        const data = new Uint8Array(await fileValue.arrayBuffer());
        return json(await skillDraftService.uploadDraftFile(id, pathValue, data));
      }
      if (request.method === "PATCH") {
        const body = await readJsonObject(request, ["path", "newPath"]);
        if (typeof body.path !== "string" || typeof body.newPath !== "string") {
          throw new ValidationError("path", "path 与 newPath 必须是字符串");
        }
        return json(await skillDraftService.renameDraftFile(id, body.path, body.newPath));
      }
      if (request.method === "DELETE") {
        const pathValue = url.searchParams.get("path");
        if (pathValue === null || pathValue === "") {
          throw new ValidationError("path", "缺少 path 查询参数");
        }
        await skillDraftService.deleteDraftFile(id, pathValue);
        return noContent();
      }
      throw new NotFoundError("路径", path);
    }

    if (resource === "skill-drafts" && subresource === "save" && request.method === "POST") {
      const rawIfMatch = request.headers.get("if-match");
      const baseRevision =
        rawIfMatch === null || rawIfMatch === "" ? null : parseIfMatch(request);
      const body = await readJsonObject(request, SKILL_SAVE_FIELDS);
      const { created, ...saved } = await skillDraftService.saveDraft(
        id,
        baseRevision,
        body as unknown as SaveSkill,
        actorFrom(request, actor),
      );
      return json(saved, created ? 201 : 200, {
        Location: `/api/v1/skills/${saved.id}`,
      });
    }
  }

  throw new NotFoundError("路径", path);
}
