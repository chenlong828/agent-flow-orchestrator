import { NotFoundError } from "../../core/kernel/index.ts";
import type { Health } from "../../core/platform/index.ts";
import type { CatalogRead } from "../catalog/index.ts";
import type { ExpertService } from "../expert/index.ts";
import type { HarnessService } from "../harness/index.ts";
import type { SkillDraftService } from "../skill/contract.ts";
import type { ToolService } from "../tool/index.ts";
import type { WorkflowService } from "../workflow/index.ts";
import type { ApiDocs } from "./docs.ts";
import { errorResponse, json } from "./respond.ts";
import { handleExpert } from "./routes/expert.ts";
import { handleHarness } from "./routes/harness.ts";
import { handleSkill } from "./routes/skill.ts";
import { handleTool } from "./routes/tool.ts";
import type { RouteContext, RouteDeps } from "./routes/types.ts";
import { handleWorkflow } from "./routes/workflow.ts";

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

  const routeDeps: RouteDeps = {
    catalog,
    harnessService,
    toolService,
    skillDraftService,
    expertService,
    workflowService,
    actor,
  };

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

    const ctx: RouteContext = { request, url, path, segments, deps: routeDeps };

    switch (segments[0]) {
      case "harnesses":
        return handleHarness(ctx);
      case "tools":
        return handleTool(ctx);
      case "skills":
      case "skill-drafts":
        return handleSkill(ctx);
      case "experts":
        return handleExpert(ctx);
      case "workflows":
        return handleWorkflow(ctx);
      default:
        throw new NotFoundError("路径", path);
    }
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
