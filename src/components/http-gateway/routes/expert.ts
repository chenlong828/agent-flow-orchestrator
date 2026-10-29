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
  const { request, url, path, segments, deps } = ctx;
  const { catalog, expertService, actor } = deps;

  if (segments.length === 1) {
    if (request.method === "GET") {
      const page = await catalog.listExperts(parseExpertListQuery(url));
      return json(pagePayload(page));
    }
    if (request.method === "POST") {
      const body = await readJsonObject(request, EXPERT_CREATE_FIELDS);
      validateNestedRefs(body, "refs");
      validateOptionalIdArray(body, "skillIds");
      validateOptionalIdArray(body, "toolIds");
      const created = await expertService.create(
        body as unknown as CreateExpert,
        actorFrom(request, actor),
      );
      const detail = await catalog.getExpert(created.id);
      return json(detail, 201, { Location: `/api/v1/experts/${created.id}` });
    }
    throw new NotFoundError("路径", path);
  }

  const id = assertUuid(segments[1]!, "id");

  if (segments.length === 2) {
    if (request.method === "GET") return json(await catalog.getExpert(id));
    if (request.method === "PUT") {
      const revision = parseIfMatch(request);
      const body = await readJsonObject(request, EXPERT_WRITE_FIELDS);
      validateNestedRefs(body, "refs");
      await expertService.update(
        id,
        revision,
        body as unknown as UpdateExpert,
        actorFrom(request, actor),
      );
      return json(await catalog.getExpert(id));
    }
    if (request.method === "PATCH") {
      const revision = parseIfMatch(request);
      const body = await readJsonObject(request, EXPERT_PATCH_FIELDS);
      validateNestedRefs(body, "refs");
      validateOptionalIdArray(body, "skillIds");
      validateOptionalIdArray(body, "toolIds");
      await expertService.updateAggregate(
        id,
        revision,
        body as unknown as UpdateExpertAggregate,
        actorFrom(request, actor),
      );
      return json(await catalog.getExpert(id));
    }
    if (request.method === "DELETE") {
      await expertService.delete(id, parseIfMatch(request));
      return noContent();
    }
    throw new NotFoundError("路径", path);
  }

  if (segments.length === 3) {
    const subresource = segments[2]!;

    if (subresource === "enabled" && request.method === "PATCH") {
      const revision = parseIfMatch(request);
      const body = await readJsonObject(request, ["enabled"]);
      if (typeof body.enabled !== "boolean") {
        throw new ValidationError("enabled", "必须是布尔值");
      }
      await expertService.setEnabled(id, revision, body.enabled, actorFrom(request, actor));
      return json(await catalog.getExpert(id));
    }

    if (subresource === "skills" && request.method === "PUT") {
      const revision = parseIfMatch(request);
      const body = await readJsonObject(request, ["items"]);
      const ids = assemblyIds(body, "skillId");
      await expertService.setSkills(id, revision, ids, actorFrom(request, actor));
      return json(await catalog.getExpert(id));
    }

    if (subresource === "tools" && request.method === "PUT") {
      const revision = parseIfMatch(request);
      const body = await readJsonObject(request, ["items"]);
      const ids = assemblyIds(body, "toolId");
      await expertService.setTools(id, revision, ids, actorFrom(request, actor));
      return json(await catalog.getExpert(id));
    }
  }

  throw new NotFoundError("路径", path);
}
