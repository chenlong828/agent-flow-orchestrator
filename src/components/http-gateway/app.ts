import {
  NotFoundError,
  UnsupportedMediaTypeError,
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
  SaveSkill,
  SkillDraftService,
} from "../skill/contract.ts";
import type {
  CreateExpert,
  ExpertService,
  UpdateExpert,
  UpdateExpertAggregate,
} from "../expert/index.ts";
import type {
  CopyWorkflow,
  CreateWorkflow,
  UpdateWorkflow,
  WorkflowDsl,
  WorkflowService,
} from "../workflow/index.ts";
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
  readOptionalJsonObject,
} from "./validation.ts";
import { errorResponse, json, markdown, noContent, notModified } from "./respond.ts";

export type HttpDeps = {
  catalog: CatalogRead;
  harnessService: HarnessService;
  toolService: ToolService;
  skillDraftService: SkillDraftService;
  expertService: ExpertService;
  workflowService: WorkflowService;
  health: Health;
  actor: string;
  docs?: ApiDocs;
};

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
const SKILL_SAVE_FIELDS = [
  "name",
  "categoryCode",
  "description",
  "tags",
  "body",
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
const EXPERT_CREATE_FIELDS = [
  ...EXPERT_WRITE_FIELDS,
  "enabled",
  "skillIds",
  "toolIds",
] as const;
const EXPERT_PATCH_FIELDS = [...EXPERT_WRITE_FIELDS, "skillIds", "toolIds"] as const;
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
const WORKFLOW_WRITE_FIELDS = ["name", "type", "description"] as const;
const WORKFLOW_CREATE_FIELDS = WORKFLOW_WRITE_FIELDS;
const WORKFLOW_COPY_FIELDS = ["name"] as const;
const WORKFLOW_GRAPH_FIELDS = ["graph"] as const;
const WORKFLOW_IMPORT_FIELDS = [
  "dslVersion",
  "metadata",
  "stages",
  "nodes",
  "edges",
  "layout",
] as const;
const WORKFLOW_SORT = HARNESS_SORT;

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

function validateOptionalIdArray(body: Record<string, unknown>, field: string): void {
  if (body[field] === undefined) return;
  if (!Array.isArray(body[field])) throw new ValidationError(field, "必须是 UUID 数组");
  body[field] = (body[field] as unknown[]).map((value, index) => {
    if (typeof value !== "string") {
      throw new ValidationError(`${field}[${index}]`, "必须是 UUID");
    }
    return assertUuid(value, `${field}[${index}]`);
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

function parseWorkflowListQuery(url: URL) {
  return {
    q: queryValue(url, "q"),
    type: queryValue(url, "type"),
    page: parsePageQuery(url),
    sort: parseSortQuery(url, WORKFLOW_SORT),
  };
}

function yamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new ValidationError("dsl", "DSL 包含无法序列化的值");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (!isPlainRecord(item)) return `${pad}- ${yamlScalar(item)}`;
        const entries = Object.entries(item);
        if (entries.length === 0) return `${pad}- {}`;
        const [first, ...rest] = entries;
        if (first === undefined) return `${pad}- {}`;
        const firstValue = isPlainRecord(first[1])
          ? `\n${toYaml(first[1], indent + 4)}`
          : yamlScalar(first[1]);
        const lines = [`${pad}- ${first[0]}: ${firstValue}`];
        for (const [key, entry] of rest) {
          if (isPlainRecord(entry)) {
            lines.push(`${" ".repeat(indent + 2)}${key}:\n${toYaml(entry, indent + 4)}`);
          } else {
            lines.push(`${" ".repeat(indent + 2)}${key}: ${yamlScalar(entry)}`);
          }
        }
        return lines.join("\n");
      })
      .join("\n");
  }
  if (isPlainRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, entry]) => {
        if (isPlainRecord(entry) || Array.isArray(entry)) {
          return `${pad}${key}:\n${toYaml(entry, indent + 2)}`;
        }
        return `${pad}${key}: ${yamlScalar(entry)}`;
      })
      .join("\n");
  }
  return `${pad}${yamlScalar(value)}`;
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
    skillDraftService,
    expertService,
    workflowService,
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
          throw new NotFoundError("路径", path);
        }
        case "skill-drafts": {
          if (request.method === "POST") {
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
        case "workflows": {
          if (request.method === "GET") {
            const page = await catalog.listWorkflows(parseWorkflowListQuery(url));
            return json(pagePayload(page));
          }
          if (request.method === "POST") {
            const body = await readJsonObject(request, WORKFLOW_CREATE_FIELDS);
            const created = await workflowService.create(
              body as unknown as CreateWorkflow,
              actorFrom(request, actor),
            );
            const detail = await catalog.getWorkflow(created.id);
            return json(detail, 201, { Location: `/api/v1/workflows/${created.id}` });
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
            validateOptionalIdArray(body, "skillIds");
            validateOptionalIdArray(body, "toolIds");
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

    if (segments.length === 2 && segments[0] === "workflows" && segments[1] === "import") {
      if (request.method !== "POST") throw new NotFoundError("路径", path);
      const body = await readJsonObject(request, WORKFLOW_IMPORT_FIELDS);
      const imported = await workflowService.importDsl(
        body as unknown as WorkflowDsl,
        actorFrom(request, actor),
      );
      const detail = await catalog.getWorkflow(imported.id);
      return json(
        { workflow: detail, idMap: imported.idMap, warnings: imported.warnings },
        201,
        { Location: `/api/v1/workflows/${imported.id}` },
      );
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
          if (request.method === "DELETE") {
            await skillDraftService.delete(id, parseIfMatch(request));
            return noContent();
          }
          throw new NotFoundError("路径", path);
        }
        case "skill-drafts": {
          if (request.method === "GET") {
            return json(await skillDraftService.getDraft(id));
          }
          if (request.method === "DELETE") {
            await skillDraftService.cancelDraft(id);
            return noContent();
          }
          throw new NotFoundError("路径", path);
        }
        case "workflows": {
          if (request.method === "GET") return json(await catalog.getWorkflow(id));
          if (request.method === "PUT") {
            const revision = parseIfMatch(request);
            const body = await readJsonObject(request, WORKFLOW_WRITE_FIELDS);
            await workflowService.update(
              id,
              revision,
              body as unknown as UpdateWorkflow,
              actorFrom(request, actor),
            );
            return json(await catalog.getWorkflow(id));
          }
          if (request.method === "DELETE") {
            await workflowService.delete(id, parseIfMatch(request));
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
        default:
          throw new NotFoundError("路径", path);
      }
    }

    if (segments.length === 3) {
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
          return json(
            await skillDraftService.uploadDraftFile(id, pathValue, data),
          );
        }
        if (request.method === "PATCH") {
          const body = await readJsonObject(request, ["path", "newPath"]);
          if (typeof body.path !== "string" || typeof body.newPath !== "string") {
            throw new ValidationError("path", "path 与 newPath 必须是字符串");
          }
          return json(
            await skillDraftService.renameDraftFile(id, body.path, body.newPath),
          );
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

      if (resource === "workflows") {
        if (subresource === "copy" && request.method === "POST") {
          const body = await readOptionalJsonObject(request, WORKFLOW_COPY_FIELDS);
          const copied = await workflowService.copy(
            id,
            body as unknown as CopyWorkflow,
            actorFrom(request, actor),
          );
          const detail = await catalog.getWorkflow(copied.id);
          return json(detail, 201, { Location: `/api/v1/workflows/${copied.id}` });
        }
        if (subresource === "definition" && request.method === "PUT") {
          const revision = parseIfMatch(request);
          const body = await readJsonObject(request, WORKFLOW_GRAPH_FIELDS);
          const saved = await workflowService.saveDefinition(
            id,
            revision,
            { graph: body.graph },
            actorFrom(request, actor),
          );
          const detail = await catalog.getWorkflow(id);
          return json({ workflow: detail, warnings: saved.warnings });
        }
        if (subresource === "validate" && request.method === "POST") {
          await catalog.getWorkflow(id);
          const body = await readJsonObject(request, WORKFLOW_GRAPH_FIELDS);
          return json(await workflowService.validate(body.graph));
        }
        if (subresource === "dsl" && request.method === "GET") {
          const format = queryValue(url, "format") ?? "json";
          if (format !== "json" && format !== "yaml") {
            throw new ValidationError("format", "必须是 json 或 yaml");
          }
          const dsl = await workflowService.exportDsl(id);
          if (format === "json") {
            return json(dsl as unknown as Record<string, unknown>, 200, {
              "content-disposition": `attachment; filename="workflow-${id}.json"`,
            });
          }
          return new Response(toYaml(dsl) + "\n", {
            status: 200,
            headers: {
              "content-type": "application/yaml; charset=utf-8",
              "content-disposition": `attachment; filename="workflow-${id}.yaml"`,
            },
          });
        }
        throw new NotFoundError("路径", path);
      }

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
            await skillDraftService.setEnabled(id, revision, body.enabled, actorFrom(request, actor));
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
