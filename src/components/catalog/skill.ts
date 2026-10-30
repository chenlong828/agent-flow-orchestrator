import type { Page } from "../../core/kernel/index.ts";
import type {
  SkillCategory,
  SkillDocument,
  SkillPackage,
  SkillQuery,
  SkillSummary,
} from "../skill/contract.ts";
import type { CatalogContext } from "./context.ts";
import type {
  SkillCategoryView,
  SkillDetailView,
  SkillListItem,
} from "./types.ts";

export function categoryMap(categories: SkillCategory[]): Map<string, string> {
  return new Map(categories.map((category) => [category.code, category.label]));
}

export function requireCategoryLabel(labels: Map<string, string>, code: string): string {
  const label = labels.get(code);
  if (label === undefined) throw new Error(`Skill 分类 ${code} 不存在`);
  return label;
}

function projectSkillSummary(
  skill: SkillSummary,
  labels: Map<string, string>,
  usedByCount: number,
): SkillListItem {
  return {
    id: skill.id,
    name: skill.name,
    categoryCode: skill.categoryCode,
    categoryLabel: requireCategoryLabel(labels, skill.categoryCode),
    description: skill.description,
    version: skill.version,
    enabled: skill.enabled,
    tags: skill.tags,
    usedByCount,
    revision: skill.revision,
    updatedAt: skill.updatedAt,
  };
}

export async function listSkills(
  ctx: CatalogContext,
  query: SkillQuery,
): Promise<Page<SkillListItem>> {
  const [page, categories] = await Promise.all([
    ctx.skillRead.list(query),
    ctx.skillRead.listCategories(),
  ]);
  const labels = categoryMap(categories);
  const items: SkillListItem[] = [];
  for (const skill of page.items) {
    const usedBy = await ctx.expertRead.listExpertsUsingSkill(skill.id);
    items.push(projectSkillSummary(skill, labels, usedBy.length));
  }
  return { ...page, items };
}

export async function getSkill(ctx: CatalogContext, id: string): Promise<SkillDetailView> {
  const [skill, categories, usedBy] = await Promise.all([
    ctx.skillRead.get(id),
    ctx.skillRead.listCategories(),
    ctx.expertRead.listExpertsUsingSkill(id),
  ]);
  const labels = categoryMap(categories);
  return {
    ...projectSkillSummary(skill, labels, usedBy.length),
    body: skill.body,
    files: skill.files,
    createdAt: skill.createdAt,
  };
}

export async function getSkillDocument(
  ctx: CatalogContext,
  id: string,
): Promise<SkillDocument> {
  return ctx.skillRead.getDocument(id);
}

export async function getSkillPackage(
  ctx: CatalogContext,
  id: string,
): Promise<SkillPackage> {
  return ctx.skillRead.getPackage(id);
}

export async function listSkillCategories(ctx: CatalogContext): Promise<SkillCategoryView[]> {
  return ctx.skillRead.listCategories();
}
