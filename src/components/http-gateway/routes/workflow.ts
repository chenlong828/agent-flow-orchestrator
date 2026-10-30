import { NotFoundError, ValidationError } from "../../../core/kernel/index.ts";
import type {
  CopyWorkflow,
  CreateWorkflow,
  UpdateWorkflow,
  WorkflowDsl,
} from "../../workflow/index.ts";
import {
  WORKFLOW_COPY_FIELDS,
  WORKFLOW_CREATE_FIELDS,
  WORKFLOW_GRAPH_FIELDS,
  WORKFLOW_IMPORT_FIELDS,
  WORKFLOW_WRITE_FIELDS,
} from "../fields.ts";
import { pagePayload, parseWorkflowListQuery } from "../queries.ts";
import { json, noContent } from "../respond.ts";
import {
  actorFrom,
  assertUuid,
  parseIfMatch,
  queryValue,
  readJsonObject,
  readOptionalJsonObject,
} from "../validation.ts";
import { toYaml } from "../yaml.ts";
import type { RouteContext } from "./types.ts";

export async function handleWorkflow(ctx: RouteContext): Promise<Response> {
  const { segments } = ctx;
  if (segments.length === 1) return workflowCollection(ctx);
  if (segments.length === 2 && segments[1] === "import") return importWorkflow(ctx);
  const id = assertUuid(segments[1], "id");
  if (segments.length === 2) return workflowById(ctx, id);
  if (segments.length === 3) return workflowSubresource(ctx, id, segments[2]);
  throw new NotFoundError("路径", ctx.path);
}

async function workflowCollection(ctx: RouteContext): Promise<Response> {
  if (ctx.request.method === "GET") {
    const page = await ctx.deps.catalog.listWorkflows(
      parseWorkflowListQuery(ctx.url),
    );
    return json(pagePayload(page));
  }
  if (ctx.request.method === "POST") return createWorkflow(ctx);
  throw new NotFoundError("路径", ctx.path);
}

async function createWorkflow(ctx: RouteContext): Promise<Response> {
  const body = await readJsonObject(ctx.request, WORKFLOW_CREATE_FIELDS);
  const created = await ctx.deps.workflowService.create(
    body as unknown as CreateWorkflow,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(created, 201, { Location: `/api/v1/workflows/${created.id}` });
}

async function importWorkflow(ctx: RouteContext): Promise<Response> {
  if (ctx.request.method !== "POST") throw new NotFoundError("路径", ctx.path);
  const body = await readJsonObject(ctx.request, WORKFLOW_IMPORT_FIELDS);
  const imported = await ctx.deps.workflowService.importDsl(
    body as unknown as WorkflowDsl,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  const detail = await ctx.deps.catalog.getWorkflow(imported.id);
  return json(
    { workflow: detail, idMap: imported.idMap, warnings: imported.warnings },
    201,
    { Location: `/api/v1/workflows/${imported.id}` },
  );
}

async function workflowById(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method === "GET") {
    return json(await ctx.deps.catalog.getWorkflow(id));
  }
  if (ctx.request.method === "PUT") return replaceWorkflow(ctx, id);
  if (ctx.request.method === "DELETE") {
    await ctx.deps.workflowService.delete(id, parseIfMatch(ctx.request));
    return noContent();
  }
  throw new NotFoundError("路径", ctx.path);
}

async function replaceWorkflow(ctx: RouteContext, id: string): Promise<Response> {
  const revision = parseIfMatch(ctx.request);
  const body = await readJsonObject(ctx.request, WORKFLOW_WRITE_FIELDS);
  await ctx.deps.workflowService.update(
    id,
    revision,
    body as unknown as UpdateWorkflow,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(await ctx.deps.catalog.getWorkflow(id));
}

async function workflowSubresource(
  ctx: RouteContext,
  id: string,
  subresource: string | undefined,
): Promise<Response> {
  switch (subresource) {
    case "copy":
      return copyWorkflow(ctx, id);
    case "definition":
      return saveDefinition(ctx, id);
    case "validate":
      return validateWorkflow(ctx, id);
    case "dsl":
      return exportWorkflowDsl(ctx, id);
    default:
      throw new NotFoundError("路径", ctx.path);
  }
}

async function copyWorkflow(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "POST") throw new NotFoundError("路径", ctx.path);
  const body = await readOptionalJsonObject(ctx.request, WORKFLOW_COPY_FIELDS);
  const copied = await ctx.deps.workflowService.copy(
    id,
    body as unknown as CopyWorkflow,
    actorFrom(ctx.request, ctx.deps.actor),
  );
  return json(copied, 201, { Location: `/api/v1/workflows/${copied.id}` });
}

async function saveDefinition(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "PUT") throw new NotFoundError("路径", ctx.path);
  const revision = parseIfMatch(ctx.request);
  const body = await readJsonObject(ctx.request, WORKFLOW_GRAPH_FIELDS);
  const saved = await ctx.deps.workflowService.saveDefinition(
    id,
    revision,
    { graph: body.graph },
    actorFrom(ctx.request, ctx.deps.actor),
  );
  const detail = await ctx.deps.catalog.getWorkflow(id);
  return json({ workflow: detail, warnings: saved.warnings });
}

async function validateWorkflow(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "POST") throw new NotFoundError("路径", ctx.path);
  await ctx.deps.catalog.getWorkflow(id);
  const body = await readJsonObject(ctx.request, WORKFLOW_GRAPH_FIELDS);
  return json(await ctx.deps.workflowService.validate(body.graph));
}

async function exportWorkflowDsl(ctx: RouteContext, id: string): Promise<Response> {
  if (ctx.request.method !== "GET") throw new NotFoundError("路径", ctx.path);
  const format = queryValue(ctx.url, "format") ?? "json";
  if (format !== "json" && format !== "yaml") {
    throw new ValidationError("format", "必须是 json 或 yaml");
  }
  const dsl = await ctx.deps.workflowService.exportDsl(id);
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
