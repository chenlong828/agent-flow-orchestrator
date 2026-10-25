import {
  AppError,
  NotFoundError,
  ValidationError,
  type Page,
} from "../../core/kernel/index.ts";
import type { Health } from "../../core/platform/index.ts";
import type { CatalogRead } from "../catalog/index.ts";
import type {
  CreateHarness,
  HarnessService,
  UpdateHarness,
} from "../harness/index.ts";
import type { CreateTool, ToolService, UpdateTool } from "../tool/index.ts";
import type {
  CreateSkill,
  SkillService,
  UpdateSkill,
} from "../skill/index.ts";
import type {
  CreateExpert,
  ExpertService,
  UpdateExpert,
} from "../expert/index.ts";
import type { ApiDocs } from "./docs.ts";
import {
  actorFrom,
  assertAllowedFields,
  assertUuid,
  isPlainObject,
  parseBooleanQuery,
  parseEnumQuery,
  parseIfMatch,
  parsePageQuery,
  parseSortQuery,
  queryValue,
  readJsonObject,
} from "./validation.ts";

export type HttpDeps = {
  catalog: CatalogRead;
  harnessService: HarnessService;
  toolService: ToolService;
  skillService: SkillService;
  expertService: ExpertService;
  health: Health;
  actor: string;
  docs?: ApiDocs;
};

type JsonValue = Record<string, unknown> | unknown[];

const HARNESS_WRITE_FIELDS = [
  "name",
  "kind",
  "address",
  "accessMode",
  "description",
  "concurrencyMax",
  "queuePolicy",
  "tags",
] as const;
const HARNESS_CREATE_FIELDS = [...HARNESS_WRITE_FIELDS, "enabled"] as const;
const TOOL_WRITE_FIELDS = [
  "name",
  "kind",
  "invocation",
  "description",
  "harnessId",
  "timeoutMs",
  "params",
] as const;
const SKILL_WRITE_FIELDS = [
  "name",
  "categoryCode",
  "summary",
  "tags",
  "triggers",
  "sections",
  "pitfalls",
  "refs",
] as const;
const EXPERT_WRITE_FIELDS = [
  "name",
  "color",
  "role",
  "persona",
  "duty",
  "skillOrder",
  "verifyOrder",
  "notes",
  "refs",
] as const;
const EXPERT_CREATE_FIELDS = [...EXPERT_WRITE_FIELDS, "enabled"] as const;
const HARNESS_SORT = {
  "name:asc": "name",
  "name:desc": "-name",
  "updatedAt:asc": "updatedAt",
  "updatedAt:desc": "-updatedAt",
} as const;
const TOOL_SORT = HARNESS_SORT;
const SKILL_SORT = {
  ...HARNESS_SORT,
  "version:asc": "version",
  "version:desc": "-version",
} as const;
const EXPERT_SORT = HARNESS_SORT;

function json(data: JsonValue | string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function restCode(error: AppError): string {
  return error.code === "database_unavailable" ? "service_unavailable" : error.code;
}

function statusFor(error: AppError): number {
  switch (error.code) {
    case "validation_error":
      return 400;
    case "not_found":
      return 404;
    case "name_conflict":
    case "revision_conflict":
    case "referenced":
      return 409;
    case "precondition_required":
      return 428;
    case "database_unavailable":
      return 503;
  }
}

function errorResponse(error: unknown, requestId?: string): Response {
  if (error instanceof AppError) {
    const payload: Record<string, unknown> = {
      code: restCode(error),
      message: error.message,
    };
    if (error.details !== undefined) payload.details = error.details;
    if (requestId !== undefined) payload.requestId = requestId;
    return json({ error: payload }, statusFor(error));
  }
  console.error(error);
  const payload: Record<string, unknown> = {
    code: "internal",
    message: "服务器内部错误",
  };
  if (requestId !== undefined) payload.requestId = requestId;
  return json({ error: payload }, 500);
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new ValidationError(field, "必须是对象");
  return value;
}

function normalizeToolParams(body: Record<string, unknown>): Record<string, unknown> {
  if (body.params === undefined) return body;
  if (!Array.isArray(body.params)) throw new ValidationError("params", "必须是数组");
  const params = body.params.map((item, index) => {
    const param = requireObject(item, `params[${index}]`);
    assertAllowedFields(param, ["key", "type", "description"], `params[${index}]`);
    if (typeof param.key !== "string" || param.key.trim() === "") {
      throw new ValidationError(`params[${index}].key`, "必须是非空字符串");
    }
    return {
      paramKey: param.key,
      type: param.type,
      description: param.description,
    };
  });
  return { ...body, params };
}

function validateNestedRefs(body: Record<string, unknown>, key: string): void {
  if (body[key] === undefined) return;
  if (!Array.isArray(body[key])) throw new ValidationError(key, "必须是数组");
  (body[key] as unknown[]).forEach((item, index) => {
    const ref = requireObject(item, `${key}[${index}]`);
    assertAllowedFields(ref, ["label", "refType", "path"], `${key}[${index}]`);
  });
}

function validateSections(body: Record<string, unknown>): void {
  if (body.sections === undefined) return;
  const sections = requireObject(body.sections, "sections");
  assertAllowedFields(
    sections,
    ["overview", "steps", "examples", "scripts", "verification"],
    "sections",
  );
}

function assemblyIds(body: Record<string, unknown>, key: "skillId" | "toolId"): string[] {
  if (!Array.isArray(body.items)) throw new ValidationError("items", "必须是数组");
  return body.items.map((item, index) => {
    const entry = requireObject(item, `items[${index}]`);
    assertAllowedFields(entry, [key], `items[${index}]`);
    const value = entry[key];
    if (typeof value !== "string") {
      throw new ValidationError(`items[${index}].${key}`, "必须是 UUID");
    }
    return assertUuid(value, `items[${index}].${key}`);
  });
}

function parseHarnessListQuery(url: URL) {
  return {
    q: queryValue(url, "q"),
    kind: parseEnumQuery(url, "kind", ["container", "server", "desktop", "laptop"] as const),
    enabled: parseBooleanQuery(url, "enabled"),
    health: parseEnumQuery(url, "health", [
      "unknown",
      "online",
      "offline",
      "overloaded",
    ] as const),
    page: parsePageQuery(url),
    sort: parseSortQuery(url, HARNESS_SORT),
  };
}

function parseToolListQuery(url: URL) {
  const harnessId = queryValue(url, "harnessId");
  if (harnessId !== undefined) assertUuid(harnessId, "harnessId");
  return {
    q: queryValue(url, "q"),
    kind: parseEnumQuery(url, "kind", ["mcp", "cli", "script"] as const),
    status: parseEnumQuery(url, "status", ["unverified", "available", "unavailable"] as const),
    harnessId,
    page: parsePageQuery(url),
    sort: parseSortQuery(url, TOOL_SORT),
  };
}

function parseSkillListQuery(url: URL) {
  return {
    q: queryValue(url, "q"),
    categoryCode: queryValue(url, "category"),
    enabled: parseBooleanQuery(url, "enabled"),
    tag: queryValue(url, "tag"),
    page: parsePageQuery(url),
    sort: parseSortQuery(url, SKILL_SORT),
  };
}

function parseExpertListQuery(url: URL) {
  return {
    q: queryValue(url, "q"),
    enabled: parseBooleanQuery(url, "enabled"),
    page: parsePageQuery(url),
    sort: parseSortQuery(url, EXPERT_SORT),
  };
}

function pagePayload<T>(page: Page<T>): Record<string, unknown> {
  return {
    items: page.items,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  };
}

export function createHttpApp(deps: HttpDeps): (request: Request) => Promise<Response> {
  const {
    catalog,
    harnessService,
    toolService,
    skillService,
    expertService,
    health,
    actor,
    docs,
  } = deps;

  async function route(request: Request, url: URL): Promise<Response> {
    const path = url.pathname;

    if (docs !== undefined) {
      const docsResponse = await docs.handle(request, url);
      if (docsResponse !== null) return docsResponse;
    }

    if (path === "/healthz") {
      if (request.method !== "GET") throw new NotFoundError("路径", path);
      const result = await health.check();
      return json(result, result.status === "ok" ? 200 : 503);
    }

    if (path !== "/api/v1" && !path.startsWith("/api/v1/")) {
      throw new NotFoundError("路径", path);
    }

    const segments = path
      .slice("/api/v1".length)
      .split("/")
      .filter((segment) => segment !== "");

    if (segments.length === 1 && segments[0] === "skill-categories") {
      if (request.method !== "GET") throw new NotFoundError("路径", path);
      return json({ items: await catalog.listSkillCategories() });
    }

    if (segments.length === 1) {
      switch (segments[0]) {
        case "harnesses": {
          if (request.method === "GET") {
            const page = await catalog.listHarnesses(parseHarnessListQuery(url));
            return json(pagePayload(page));
          }
          if (request.method === "POST") {
            const body = await readJsonObject(request, HARNESS_CREATE_FIELDS);
            const created = await harnessService.create(body as unknown as CreateHarness, actorFrom(request, actor));
            const detail = await catalog.getHarness(created.id);
            return json(detail, 201, { Location: `/api/v1/harnesses/${created.id}` });
          }
          throw new NotFoundError("路径", path);
        }
        case "tools": {
          if (request.method === "GET") {
            const page = await catalog.listTools(parseToolListQuery(url));
            return json(pagePayload(page));
          }
          if (request.method === "POST") {
            const body = normalizeToolParams(await readJsonObject(request, TOOL_WRITE_FIELDS));
            if (typeof body.harnessId === "string") assertUuid(body.harnessId, "harnessId");
            const created = await toolService.create(body as unknown as CreateTool, actorFrom(request, actor));
            const detail = await catalog.getTool(created.id);
            return json(detail, 201, { Location: `/api/v1/tools/${created.id}` });
          }
          throw new NotFoundError("路径", path);
        }
        case "skills": {
          if (request.method === "GET") {
            const page = await catalog.listSkills(parseSkillListQuery(url));
            return json(pagePayload(page));
          }
          if (request.method === "POST") {
            const body = await readJsonObject(request, SKILL_WRITE_FIELDS);
            validateSections(body);
            validateNestedRefs(body, "refs");
            const created = await skillService.create(body as unknown as CreateSkill, actorFrom(request, actor));
            const detail = await catalog.getSkill(created.id);
            return json(detail, 201, { Location: `/api/v1/skills/${created.id}` });
          }
          throw new NotFoundError("路径", path);
        }
        case "experts": {
          if (request.method === "GET") {
            const page = await catalog.listExperts(parseExpertListQuery(url));
            return json(pagePayload(page));
          }
          if (request.method === "POST") {
            const body = await readJsonObject(request, EXPERT_CREATE_FIELDS);
            validateNestedRefs(body, "refs");
            const created = await expertService.create(body as unknown as CreateExpert, actorFrom(request, actor));
            const detail = await catalog.getExpert(created.id);
            return json(detail, 201, { Location: `/api/v1/experts/${created.id}` });
          }
          throw new NotFoundError("路径", path);
        }
        default:
          throw new NotFoundError("路径", path);
      }
    }

    const [resource, rawId, subresource] = segments;
    if (resource === undefined || rawId === undefined) throw new NotFoundError("路径", path);
    const id = assertUuid(rawId, "id");

    if (segments.length === 2) {
      switch (resource) {
        case "harnesses": {
          if (request.method === "GET") return json(await catalog.getHarness(id));
          if (request.method === "PUT") {
            const revision = parseIfMatch(request);
            const body = await readJsonObject(request, HARNESS_WRITE_FIELDS);
            await harnessService.update(id, revision, body as unknown as UpdateHarness, actorFrom(request, actor));
            return json(await catalog.getHarness(id));
          }
          if (request.method === "DELETE") {
            await harnessService.delete(id, parseIfMatch(request));
            return noContent();
          }
          throw new NotFoundError("路径", path);
        }
        case "tools": {
          if (request.method === "GET") return json(await catalog.getTool(id));
          if (request.method === "PUT") {
            const revision = parseIfMatch(request);
            const body = normalizeToolParams(await readJsonObject(request, TOOL_WRITE_FIELDS));
            if (typeof body.harnessId === "string") assertUuid(body.harnessId, "harnessId");
            await toolService.update(id, revision, body as unknown as UpdateTool, actorFrom(request, actor));
            return json(await catalog.getTool(id));
          }
          if (request.method === "DELETE") {
            await toolService.delete(id, parseIfMatch(request));
            return noContent();
          }
          throw new NotFoundError("路径", path);
        }
        case "skills": {
          if (request.method === "GET") return json(await catalog.getSkill(id));
          if (request.method === "PUT") {
            const revision = parseIfMatch(request);
            const body = await readJsonObject(request, SKILL_WRITE_FIELDS);
            validateSections(body);
            validateNestedRefs(body, "refs");
            await skillService.update(id, revision, body as unknown as UpdateSkill, actorFrom(request, actor));
            return json(await catalog.getSkill(id));
          }
          if (request.method === "DELETE") {
            await skillService.delete(id, parseIfMatch(request));
            return noContent();
          }
          throw new NotFoundError("路径", path);
        }
        case "experts": {
          if (request.method === "GET") return json(await catalog.getExpert(id));
          if (request.method === "PUT") {
            const revision = parseIfMatch(request);
            const body = await readJsonObject(request, EXPERT_WRITE_FIELDS);
            validateNestedRefs(body, "refs");
            await expertService.update(id, revision, body as unknown as UpdateExpert, actorFrom(request, actor));
            return json(await catalog.getExpert(id));
          }
          if (request.method === "DELETE") {
            await expertService.delete(id, parseIfMatch(request));
            return noContent();
          }
          throw new NotFoundError("路径", path);
        }
        default:
          throw new NotFoundError("路径", path);
      }
    }

    if (segments.length === 3) {
      if (subresource === "references" && request.method === "GET") {
        switch (resource) {
          case "harnesses":
            return json(await catalog.referencesForHarness(id));
          case "tools":
            return json(await catalog.referencesForTool(id));
          case "skills":
            return json(await catalog.referencesForSkill(id));
          default:
            throw new NotFoundError("路径", path);
        }
      }

      if (subresource === "enabled" && request.method === "PATCH") {
        const revision = parseIfMatch(request);
        const body = await readJsonObject(request, ["enabled"]);
        if (typeof body.enabled !== "boolean") {
          throw new ValidationError("enabled", "必须是布尔值");
        }
        switch (resource) {
          case "harnesses":
            await harnessService.setEnabled(id, revision, body.enabled, actorFrom(request, actor));
            return json(await catalog.getHarness(id));
          case "skills":
            await skillService.setEnabled(id, revision, body.enabled, actorFrom(request, actor));
            return json(await catalog.getSkill(id));
          case "experts":
            await expertService.setEnabled(id, revision, body.enabled, actorFrom(request, actor));
            return json(await catalog.getExpert(id));
          default:
            throw new NotFoundError("路径", path);
        }
      }

      if (subresource === "skills" && resource === "experts" && request.method === "PUT") {
        const revision = parseIfMatch(request);
        const body = await readJsonObject(request, ["items"]);
        const ids = assemblyIds(body, "skillId");
        await expertService.setSkills(id, revision, ids, actorFrom(request, actor));
        return json(await catalog.getExpert(id));
      }

      if (subresource === "tools" && resource === "experts" && request.method === "PUT") {
        const revision = parseIfMatch(request);
        const body = await readJsonObject(request, ["items"]);
        const ids = assemblyIds(body, "toolId");
        await expertService.setTools(id, revision, ids, actorFrom(request, actor));
        return json(await catalog.getExpert(id));
      }
    }

    throw new NotFoundError("路径", path);
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const requestId = request.headers.get("x-request-id") ?? undefined;
    let response: Response;
    try {
      response = await route(request, url);
    } catch (error) {
      response = errorResponse(error, requestId);
    }
    if (requestId !== undefined && requestId !== "") {
      response.headers.set("x-request-id", requestId);
    }
    return response;
  };
}
