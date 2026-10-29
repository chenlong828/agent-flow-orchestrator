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
  const { request, url, path, segments, deps } = ctx;
  const { catalog, workflowService, actor } = deps;

  if (segments.length === 1) {
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
      return json(created, 201, { Location: `/api/v1/workflows/${created.id}` });
    }
    throw new NotFoundError("路径", path);
  }

  if (segments.length === 2 && segments[1] === "import") {
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

  const id = assertUuid(segments[1]!, "id");

  if (segments.length === 2) {
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

  if (segments.length === 3) {
    const subresource = segments[2]!;

    if (subresource === "copy" && request.method === "POST") {
      const body = await readOptionalJsonObject(request, WORKFLOW_COPY_FIELDS);
      const copied = await workflowService.copy(
        id,
        body as unknown as CopyWorkflow,
        actorFrom(request, actor),
      );
      return json(copied, 201, { Location: `/api/v1/workflows/${copied.id}` });
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
  }

  throw new NotFoundError("路径", path);
}
