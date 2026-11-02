import type { Reference, ReferenceOwner } from "../../core/kernel/index.ts";
import { referencePage, toReferences } from "./context.ts";
import {
  listExpertsUsingSkillReferences,
  listExpertsUsingToolReferences,
} from "./expert.ts";
import type { CatalogDeps, ReferencePage } from "./types.ts";
import { listWorkflowsByExpertReferences } from "./workflow.ts";

export async function listToolsByHarnessReferences(
  ctx: CatalogDeps,
  harnessId: string,
): Promise<Reference[]> {
  const tools = await ctx.toolRead.listByHarness(harnessId);
  return toReferences("tool", tools);
}

export async function checkReferences(
  ctx: CatalogDeps,
  owner: ReferenceOwner,
  id: string,
): Promise<Reference[]> {
  switch (owner) {
    case "harness":
      return listToolsByHarnessReferences(ctx, id);
    case "tool":
      return listExpertsUsingToolReferences(ctx, id);
    case "skill":
      return listExpertsUsingSkillReferences(ctx, id);
    case "expert":
      return listWorkflowsByExpertReferences(ctx, id);
  }
}

export async function referencesForHarness(
  ctx: CatalogDeps,
  id: string,
): Promise<ReferencePage> {
  const harness = await ctx.harnessRead.get(id);
  const items = await checkReferences(ctx, "harness", id);
  return referencePage({ type: "harness", id, name: harness.name }, items);
}

export async function referencesForTool(
  ctx: CatalogDeps,
  id: string,
): Promise<ReferencePage> {
  const tool = await ctx.toolRead.get(id);
  const items = await checkReferences(ctx, "tool", id);
  return referencePage({ type: "tool", id, name: tool.name }, items);
}

export async function referencesForSkill(
  ctx: CatalogDeps,
  id: string,
): Promise<ReferencePage> {
  const skill = await ctx.skillRead.getSummary(id);
  const items = await checkReferences(ctx, "skill", id);
  return referencePage({ type: "skill", id, name: skill.name }, items);
}
