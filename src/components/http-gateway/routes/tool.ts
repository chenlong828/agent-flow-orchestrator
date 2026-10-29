import { NotFoundError } from "../../../core/kernel/index.ts";
import type { CreateTool, UpdateTool } from "../../tool/index.ts";
import { normalizeToolParams } from "../dto.ts";
import { TOOL_WRITE_FIELDS } from "../fields.ts";
import { pagePayload, parseToolListQuery } from "../queries.ts";
import { json, noContent } from "../respond.ts";
import { actorFrom, assertUuid, parseIfMatch, readJsonObject } from "../validation.ts";
import type { RouteContext } from "./types.ts";

export async function handleTool(ctx: RouteContext): Promise<Response> {
  const { request, url, path, segments, deps } = ctx;
  const { catalog, toolService, actor } = deps;

  if (segments.length === 1) {
    if (request.method === "GET") {
      const page = await catalog.listTools(parseToolListQuery(url));
      return json(pagePayload(page));
    }
    if (request.method === "POST") {
      const body = normalizeToolParams(await readJsonObject(request, TOOL_WRITE_FIELDS));
      if (typeof body.harnessId === "string") assertUuid(body.harnessId, "harnessId");
      const created = await toolService.create(
        body as unknown as CreateTool,
        actorFrom(request, actor),
      );
      const detail = await catalog.getTool(created.id);
      return json(detail, 201, { Location: `/api/v1/tools/${created.id}` });
    }
    throw new NotFoundError("路径", path);
  }

  const id = assertUuid(segments[1]!, "id");

  if (segments.length === 2) {
    if (request.method === "GET") return json(await catalog.getTool(id));
    if (request.method === "PUT") {
      const revision = parseIfMatch(request);
      const body = normalizeToolParams(await readJsonObject(request, TOOL_WRITE_FIELDS));
      if (typeof body.harnessId === "string") assertUuid(body.harnessId, "harnessId");
      await toolService.update(
        id,
        revision,
        body as unknown as UpdateTool,
        actorFrom(request, actor),
      );
      return json(await catalog.getTool(id));
    }
    if (request.method === "DELETE") {
      await toolService.delete(id, parseIfMatch(request));
      return noContent();
    }
    throw new NotFoundError("路径", path);
  }

  if (segments.length === 3) {
    if (segments[2] === "references" && request.method === "GET") {
      return json(await catalog.referencesForTool(id));
    }
  }

  throw new NotFoundError("路径", path);
}
