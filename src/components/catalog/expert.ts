import type { Page, Reference } from "../../core/kernel/index.ts";
import type { ExpertQuery, ExpertSummary } from "../expert/index.ts";
import { toReferences } from "./context.ts";
import type { CatalogContext } from "./context.ts";
import type {
  ExpertDetailView,
  ExpertListItem,
  ExpertSkillPreviewView,
  ExpertSkillSummaryView,
  ExpertToolSummaryView,
} from "./types.ts";
import { categoryMap, requireCategoryLabel } from "./skill.ts";

export async function listExpertsUsingSkillReferences(
  ctx: CatalogContext,
  skillId: string,
): Promise<Reference[]> {
  const experts = await ctx.expertRead.listExpertsUsingSkill(skillId);
  return toReferences("expert", experts);
}

export async function listExpertsUsingToolReferences(
  ctx: CatalogContext,
  toolId: string,
): Promise<Reference[]> {
  const experts = await ctx.expertRead.listExpertsUsingTool(toolId);
  return toReferences("expert", experts);
}

function projectExpertCore(expert: ExpertSummary, refCount: number) {
  return {
    id: expert.id,
    name: expert.name,
    color: expert.color,
    role: expert.role,
    enabled: expert.enabled,
    persona: expert.persona,
    skillCount: expert.skillCount,
    toolCount: expert.toolCount,
    refCount,
  };
}

async function skillPreviews(
  ctx: CatalogContext,
  skillIds: string[],
): Promise<ExpertSkillPreviewView[]> {
  const skills: ExpertSkillPreviewView[] = [];
  for (const skillId of skillIds.slice(0, 3)) {
    const skill = await ctx.skillRead.getSummary(skillId);
    skills.push({ id: skill.id, name: skill.name });
  }
  return skills;
}

async function skillSummaries(
  ctx: CatalogContext,
  labels: Map<string, string>,
  skillIds: string[],
): Promise<ExpertSkillSummaryView[]> {
  const skills: ExpertSkillSummaryView[] = [];
  for (const skillId of skillIds) {
    const skill = await ctx.skillRead.getSummary(skillId);
    skills.push({
      id: skill.id,
      name: skill.name,
      categoryCode: skill.categoryCode,
      categoryLabel: requireCategoryLabel(labels, skill.categoryCode),
      description: skill.description,
    });
  }
  return skills;
}

async function toolSummaries(
  ctx: CatalogContext,
  toolIds: string[],
): Promise<ExpertToolSummaryView[]> {
  const tools: ExpertToolSummaryView[] = [];
  for (const toolId of toolIds) {
    const tool = await ctx.toolRead.getSummary(toolId);
    tools.push({ id: tool.id, name: tool.name, kind: tool.kind, status: tool.status });
  }
  return tools;
}

export async function listExperts(
  ctx: CatalogContext,
  query: ExpertQuery,
): Promise<Page<ExpertListItem>> {
  const page = await ctx.expertRead.list(query);
  const counts = await ctx.workflowRead.countByExperts(page.items.map((expert) => expert.id));
  const items: ExpertListItem[] = [];
  for (const expert of page.items) {
    const skills = await skillPreviews(ctx, expert.skillIds);
    items.push({
      ...projectExpertCore(expert, counts[expert.id] ?? 0),
      skills,
      revision: expert.revision,
      updatedAt: expert.updatedAt,
    });
  }
  return { ...page, items };
}

export async function getExpert(ctx: CatalogContext, id: string): Promise<ExpertDetailView> {
  const [expert, categories, counts] = await Promise.all([
    ctx.expertRead.get(id),
    ctx.skillRead.listCategories(),
    ctx.workflowRead.countByExperts([id]),
  ]);
  const labels = categoryMap(categories);
  const skills = await skillSummaries(ctx, labels, expert.skillIds);
  const tools = await toolSummaries(ctx, expert.toolIds);
  return {
    ...projectExpertCore(expert, counts[id] ?? 0),
    revision: expert.revision,
    updatedAt: expert.updatedAt,
    duty: expert.duty,
    skillOrder: expert.skillOrder,
    verifyOrder: expert.verifyOrder,
    notes: expert.notes,
    skills,
    tools,
    refs: expert.refs.map((ref) => ({
      label: ref.label,
      refType: ref.refType,
      path: ref.path ?? null,
    })),
    createdAt: expert.createdAt,
  };
}
