import { NotFoundError, ValidationError } from "../../../core/kernel/index.ts";
import type {
  CreateHarness,
  HarnessClientBinding,
  UpdateHarness,
} from "../../harness/index.ts";
import {
  HARNESS_CLIENT_FIELDS,
  HARNESS_CREATE_FIELDS,
  HARNESS_WRITE_FIELDS,
} from "../fields.ts";
import { pagePayload, parseHarnessListQuery } from "../queries.ts";
import { json, noContent } from "../respond.ts";
import { actorFrom, assertUuid, parseIfMatch, readJsonObject } from "../validation.ts";
import type { RouteContext } from "./types.ts";

async function handleHarnessCollection(ctx: RouteContext): Promise<Response> {
  const { request, url, path, deps } = ctx;
  if (request.method === "GET") {
    const page = await deps.catalog.listHarnesses(parseHarnessListQuery(url));
    return json(pagePayload(page));
  }
  if (request.method === "POST") {
    const body = await readJsonObject(request, HARNESS_CREATE_FIELDS);
    const created = await deps.harnessService.create(
      body as unknown as CreateHarness,
      actorFrom(request, deps.actor),
    );
    const detail = await deps.catalog.getHarness(created.id);
    return json(detail, 201, { Location: `/api/v1/harnesses/${created.id}` });
  }
  throw new NotFoundError("路径", path);
}

export async function handleHarness(ctx: RouteContext): Promise<Response> {
  const { request, path, segments, deps } = ctx;
  const { catalog, harnessService, actor } = deps;

  if (segments.length === 1) return handleHarnessCollection(ctx);

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
    if (segments[2] === "client" && request.method === "PATCH") {
      return handleClientBinding(ctx, id);
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

/** API-41：`{clientId: null}` 解绑并清空凭据，其余形状按登记处理。 */
async function handleClientBinding(ctx: RouteContext, id: string): Promise<Response> {
  const { request, deps } = ctx;
  const revision = parseIfMatch(request);
  const body = await readJsonObject(request, HARNESS_CLIENT_FIELDS);
  const requestActor = actorFrom(request, deps.actor);
  if (body.clientId === null) {
    if (body.token !== undefined) {
      throw new ValidationError("token", "解绑时不能提供 token");
    }
    await deps.harnessService.unbindClient(id, revision, requestActor);
    return json(await deps.catalog.getHarness(id));
  }
  if (typeof body.clientId !== "string") {
    throw new ValidationError("clientId", "必须是字符串或 null");
  }
  if (body.token === undefined) {
    throw new ValidationError("token", "登记节点时必须提供 token");
  }
  const binding: HarnessClientBinding = {
    clientId: body.clientId,
    token: body.token as string,
  };
  await deps.harnessService.bindClient(id, revision, binding, requestActor);
  return json(await deps.catalog.getHarness(id));
}
