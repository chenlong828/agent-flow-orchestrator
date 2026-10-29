import type { CatalogRead } from "../../catalog/index.ts";
import type { ExpertService } from "../../expert/index.ts";
import type { HarnessService } from "../../harness/index.ts";
import type { SkillDraftService } from "../../skill/contract.ts";
import type { ToolService } from "../../tool/index.ts";
import type { WorkflowService } from "../../workflow/index.ts";

export type RouteDeps = {
  catalog: CatalogRead;
  harnessService: HarnessService;
  toolService: ToolService;
  skillDraftService: SkillDraftService;
  expertService: ExpertService;
  workflowService: WorkflowService;
  actor: string;
};

export type RouteContext = {
  request: Request;
  url: URL;
  path: string;
  segments: string[];
  deps: RouteDeps;
};
