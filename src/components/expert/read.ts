import { NotFoundError, toIso, type Page } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import { expertStore, type ExpertRootRow } from "./store.ts";
import type {
  ExpertDetail,
  ExpertQuery,
  ExpertRead,
  ExpertReference,
  ExpertSummary,
} from "./types.ts";

function toSummary(row: ExpertRootRow, persona: string[], skillIds: string[]): ExpertSummary {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    role: row.role,
    enabled: row.enabled,
    persona,
    duty: row.duty,
    // 过渡期：已并入 duty / 已停用的字段恒为空，UI 改造后移除。
    skillOrder: "",
    verifyOrder: "",
    notes: "",
    skillCount: row.skill_count,
    toolCount: 0,
    refCount: 0,
    skillIds,
    revision: row.revision,
    updatedAt: toIso(row.updated_at),
  };
}

export function createExpertRead(deps: { db: Db }): ExpertRead {
  const { db } = deps;

  return {
    async list(query: ExpertQuery): Promise<Page<ExpertSummary>> {
      const { rows, total } = await expertStore.listRoots(db, query);
      const items: ExpertSummary[] = [];
      for (const row of rows) {
        const [persona, skillIds] = await Promise.all([
          expertStore.personaFor(db, row.id),
          expertStore.skillIdsFor(db, row.id),
        ]);
        items.push(toSummary(row, persona, skillIds));
      }
      return { items, total, limit: query.page.limit, offset: query.page.offset };
    },

    async get(id): Promise<ExpertDetail> {
      const [row, persona, skillIds] = await Promise.all([
        expertStore.findRoot(db, id),
        expertStore.personaFor(db, id),
        expertStore.skillIdsFor(db, id),
      ]);
      if (row === null) throw new NotFoundError("专家", id);
      return {
        ...toSummary(row, persona, skillIds),
        toolIds: [],
        refs: [],
        createdAt: toIso(row.created_at),
      };
    },

    async listExpertsUsingSkill(skillId): Promise<ExpertReference[]> {
      return expertStore.listUsingSkill(db, skillId);
    },

    async listExpertsUsingTool(toolId): Promise<ExpertReference[]> {
      return expertStore.listUsingTool(db, toolId);
    },

    async statuses(expertIds): Promise<Record<string, boolean>> {
      return expertStore.statuses(db, expertIds);
    },
  };
}
