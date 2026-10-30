import type { ReferenceGuard } from "../../core/kernel/index.ts";
import type { CatalogContext } from "./context.ts";
import { getHarness, listHarnesses } from "./harness.ts";
import { getTool, listTools } from "./tool.ts";
import {
  getSkill,
  getSkillDocument,
  getSkillPackage,
  listSkillCategories,
  listSkills,
} from "./skill.ts";
import {
  getExpert,
  listExperts,
  listExpertsUsingSkillReferences,
  listExpertsUsingToolReferences,
} from "./expert.ts";
import { getWorkflow, listWorkflows } from "./workflow.ts";
import {
  checkReferences,
  listToolsByHarnessReferences,
  referencesForHarness,
  referencesForSkill,
  referencesForTool,
} from "./references.ts";
import type { CatalogDeps, CatalogRead } from "./types.ts";

export type {
  CatalogDeps,
  CatalogRead,
  ExpertDetailView,
  ExpertListItem,
  ExpertSkillPreviewView,
  ExpertSkillSummaryView,
  ExpertToolSummaryView,
  HarnessDetailView,
  HarnessListItem,
  ReferenceAsset,
  ReferencePage,
  SkillCategoryView,
  SkillDetailView,
  SkillListItem,
  ToolDetailView,
  ToolListItem,
  ToolParamView,
} from "./types.ts";

export function createCatalog(deps: CatalogDeps): CatalogRead & ReferenceGuard {
  const ctx: CatalogContext = deps;
  return {
    check: (owner, id) => checkReferences(ctx, owner, id),

    listHarnesses: (query) => listHarnesses(ctx, query),
    getHarness: (id) => getHarness(ctx, id),

    listTools: (query) => listTools(ctx, query),
    getTool: (id) => getTool(ctx, id),
    listToolsByHarness: (harnessId) => listToolsByHarnessReferences(ctx, harnessId),

    listSkills: (query) => listSkills(ctx, query),
    getSkill: (id) => getSkill(ctx, id),
    getSkillDocument: (id) => getSkillDocument(ctx, id),
    getSkillPackage: (id) => getSkillPackage(ctx, id),
    listSkillCategories: () => listSkillCategories(ctx),
    listExpertsUsingSkill: (skillId) => listExpertsUsingSkillReferences(ctx, skillId),

    listExperts: (query) => listExperts(ctx, query),
    getExpert: (id) => getExpert(ctx, id),
    listExpertsUsingTool: (toolId) => listExpertsUsingToolReferences(ctx, toolId),

    listWorkflows: (query) => listWorkflows(ctx, query),
    getWorkflow: (id) => getWorkflow(ctx, id),

    referencesForHarness: (id) => referencesForHarness(ctx, id),
    referencesForTool: (id) => referencesForTool(ctx, id),
    referencesForSkill: (id) => referencesForSkill(ctx, id),
  };
}
