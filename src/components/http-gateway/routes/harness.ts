import { NotFoundError, ValidationError } from "../../../core/kernel/index.ts";
import type { CreateHarness, UpdateHarness } from "../../harness/index.ts";
import { HARNESS_CREATE_FIELDS, HARNESS_WRITE_FIELDS } from "../fields.ts";
import { pagePayload, parseHarnessListQuery } from "../queries.ts";
import { json, noContent } from "../respond.ts";
import { actorFrom, assertUuid, parseIfMatch, readJsonObject } from "../validation.ts";
import type { RouteContext } from "./types.ts";

export async function handleHarness(ctx: RouteContext): Promise<Response> {
  const { request, url, path, segments, deps } = ctx;
  const { catalog, harnessService, actor } = deps;

  if (segments.length === 1) {
    if (request.method === "GET") {
      const page = await catalog.listHarnesses(parseHarnessListQuery(url));
      return json(pagePayload(page));
    }
    if (request.method === "POST") {
      const body = await readJsonObject(request, HARNESS_CREATE_FIELDS);
      const created = await harnessService.create(
        body as unknown as CreateHarness,
        actorFrom(request, actor),
      );
      const detail = await catalog.getHarness(created.id);
      return json(detail, 201, { Location: `/api/v1/harnesses/${created.id}` });
    }
    throw new NotFoundError("路径", path);
  }

  const id = assertUuid(segments[1], "id");

  if (segments.length === 2) {
    if (request.method === "GET") return json(await catalog.getHarness(id));
    if (request.method === "PUT") {
      const revision = parseIfMatch(request);
      const body = await readJsonObject(request, HARNESS_WRITE_FIELDS);
      await harnessService.update(
        id,
        revision,
        body as unknown as UpdateHarness,
        actorFrom(request, actor),
      );
      return json(await catalog.getHarness(id));
    }
    if (request.method === "DELETE") {
      await harnessService.delete(id, parseIfMatch(request));
      return noContent();
    }
    throw new NotFoundError("路径", path);
  }

  if (segments.length === 3) {
    if (segments[2] === "references" && request.method === "GET") {
      return json(await catalog.referencesForHarness(id));
    }
    if (segments[2] === "enabled" && request.method === "PATCH") {
      const revision = parseIfMatch(request);
      const body = await readJsonObject(request, ["enabled"]);
      if (typeof body.enabled !== "boolean") {
        throw new ValidationError("enabled", "必须是布尔值");
      }
      await harnessService.setEnabled(id, revision, body.enabled, actorFrom(request, actor));
      return json(await catalog.getHarness(id));
    }
  }

  throw new NotFoundError("路径", path);
}
