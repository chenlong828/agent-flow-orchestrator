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
import { assertUuid } from "./validation.ts";
import { handleExecutor, type ExecutorDeps } from "./routes/executor.ts";
import { handleExpert } from "./routes/expert.ts";
import { handleHarness } from "./routes/harness.ts";
import { handleRun } from "./routes/run.ts";
import { handleSkillDrafts } from "./routes/skill-drafts.ts";
import { handleSkills } from "./routes/skills.ts";
import { handleTool } from "./routes/tool.ts";
import type { RouteContext, RouteDeps } from "./routes/types.ts";
import { handleWorkflow } from "./routes/workflow.ts";

export type HttpDeps = {
  catalog: CatalogRead;
  backend: ExecutorDeps["backend"];
  /** 测试可注入更短的执行面挂起周期；缺省 30000。 */
  executorPollHoldMs?: number;
  /** 执行面鉴权模式；缺省 `on`。开发期由 config 传 `off`。 */
  executorAuth?: ExecutorDeps["authMode"];
  /** 开发期自注册：确保 clientId 对应的节点行存在。 */
  executorEnroll?: (clientId: string, address?: string) => Promise<void>;
  harnessService: HarnessService;
  toolService: ToolService;
  skillDraftService: SkillDraftService;
  expertService: ExpertService;
  workflowService: WorkflowService;
  runService?: RouteDeps["runService"];
  health: Health;
  actor: string;
  docs?: ApiDocs;
};

type Runtime = {
  deps: HttpDeps;
  routeDeps: RouteDeps;
  executor: ExecutorDeps;
};

export function createHttpApp(deps: HttpDeps): (request: Request) => Promise<Response> {
  const runtime: Runtime = {
    deps,
    routeDeps: toRouteDeps(deps),
    executor: {
      backend: deps.backend,
      pollHoldMs: deps.executorPollHoldMs,
      authMode: deps.executorAuth,
      ensureNode: deps.executorEnroll,
    },
  };
  return async function handle(request: Request): Promise<Response> {
    return handleRequest(request, runtime);
  };
}

function toRouteDeps(deps: HttpDeps): RouteDeps {
  return {
    catalog: deps.catalog,
    harnessService: deps.harnessService,
    toolService: deps.toolService,
    skillDraftService: deps.skillDraftService,
    expertService: deps.expertService,
    workflowService: deps.workflowService,
    runService: deps.runService,
    actor: deps.actor,
  };
}

async function handleRequest(request: Request, runtime: Runtime): Promise<Response> {
  const url = new URL(request.url);
  const requestId = request.headers.get("x-request-id") ?? undefined;
  let response: Response;
  try {
    response = await routeRequest(request, url, runtime);
  } catch (error) {
    response = errorResponse(error, requestId);
  }
  if (requestId !== undefined && requestId !== "") {
    response.headers.set("x-request-id", requestId);
  }
  return response;
}

async function routeRequest(
  request: Request,
  url: URL,
  runtime: Runtime,
): Promise<Response> {
  const path = url.pathname;
  const docsResponse = await handleDocs(request, url, runtime);
  if (docsResponse !== null) return docsResponse;

  if (path === "/healthz") return handleHealth(request, path, runtime.deps.health);
  if (!isApiPath(path)) throw new NotFoundError("路径", path);

  const segments = parseSegments(path);
  const executorResponse = await handleExecutor(request, segments, runtime.executor);
  if (executorResponse !== null) return executorResponse;
  if (isSkillCategories(segments)) {
    return handleSkillCategories(request, path, runtime.deps.catalog);
  }
  assertIdSegment(segments);
  return dispatch(request, url, path, segments, runtime.routeDeps);
}

async function handleDocs(
  request: Request,
  url: URL,
  runtime: Runtime,
): Promise<Response | null> {
  if (runtime.deps.docs === undefined) return null;
  return runtime.deps.docs.handle(request, url);
}

async function handleHealth(
  request: Request,
  path: string,
  health: Health,
): Promise<Response> {
  if (request.method !== "GET") throw new NotFoundError("路径", path);
  const result = await health.check();
  return json(result, result.status === "ok" ? 200 : 503);
}

function isApiPath(path: string): boolean {
  return path === "/api/v1" || path.startsWith("/api/v1/");
}

function parseSegments(path: string): string[] {
  return path
    .slice("/api/v1".length)
    .split("/")
    .filter((segment) => segment !== "");
}

function isSkillCategories(segments: string[]): boolean {
  return segments.length === 1 && segments[0] === "skill-categories";
}

async function handleSkillCategories(
  request: Request,
  path: string,
  catalog: CatalogRead,
): Promise<Response> {
  if (request.method !== "GET") throw new NotFoundError("路径", path);
  return json({ items: await catalog.listSkillCategories() });
}

function assertIdSegment(segments: string[]): void {
  if (segments[1] === undefined) return;
  if (segments[0] === "workflows" && segments[1] === "import") return;
  assertUuid(segments[1], "id");
}

function dispatch(
  request: Request,
  url: URL,
  path: string,
  segments: string[],
  deps: RouteDeps,
): Promise<Response> {
  const ctx: RouteContext = { request, url, path, segments, deps };
  switch (segments[0]) {
    case "harnesses":
      return handleHarness(ctx);
    case "tools":
      return handleTool(ctx);
    case "skills":
      return handleSkills(ctx);
    case "skill-drafts":
      return handleSkillDrafts(ctx);
    case "experts":
      return handleExpert(ctx);
    case "workflows":
      return handleWorkflow(ctx);
    case "runs":
      return handleRun(ctx);
    default:
      throw new NotFoundError("路径", path);
  }
}
