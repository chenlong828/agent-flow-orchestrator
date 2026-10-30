import { NotFoundError, type Page } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import { createExpertStore, type ExpertRootRow } from "./store.ts";
import type {
  ExpertDetail,
  ExpertQuery,
  ExpertRead,
  ExpertRefInput,
  ExpertReference,
  ExpertSummary,
} from "./types.ts";

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSummary(row: ExpertRootRow, persona: string[], skillIds: string[]): ExpertSummary {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    role: row.role,
    enabled: row.enabled,
    persona,
    duty: row.duty,
    skillOrder: row.skill_order,
    verifyOrder: row.verify_order,
    notes: row.notes,
    skillCount: row.skill_count,
    toolCount: row.tool_count,
    refCount: 0,
    skillIds,
    revision: row.revision,
    updatedAt: toIso(row.updated_at),
  };
}

export function createExpertRead(deps: { db: Db }): ExpertRead {
  const { db } = deps;
  const store = createExpertStore(db);

  return {
    async list(query: ExpertQuery): Promise<Page<ExpertSummary>> {
      const { rows, total } = await store.listRoots(db, query);
      const items: ExpertSummary[] = [];
      for (const row of rows) {
        const [persona, skillIds] = await Promise.all([
          store.personaFor(db, row.id),
          store.skillIdsFor(db, row.id),
        ]);
        items.push(toSummary(row, persona, skillIds));
      }
      return { items, total, limit: query.page.limit, offset: query.page.offset };
    },

    async get(id): Promise<ExpertDetail> {
      const [row, persona, refs, skillIds, toolIds] = await Promise.all([
        store.findRoot(db, id),
        store.personaFor(db, id),
        store.refsFor(db, id),
        store.skillIdsFor(db, id),
        store.toolIdsFor(db, id),
      ]);
      if (row === null) throw new NotFoundError("专家", id);
      const refsInput: ExpertRefInput[] = refs.map((ref) => ({
        label: ref.label,
        refType: ref.ref_type,
        path: ref.path ?? undefined,
      }));
      return {
        ...toSummary(row, persona, skillIds),
        toolIds,
        refs: refsInput,
        createdAt: toIso(row.created_at),
      };
    },

    async listExpertsUsingSkill(skillId): Promise<ExpertReference[]> {
      return store.listUsingSkill(db, skillId);
    },

    async listExpertsUsingTool(toolId): Promise<ExpertReference[]> {
      return store.listUsingTool(db, toolId);
    },

    async statuses(expertIds): Promise<Record<string, boolean>> {
      return store.statuses(db, expertIds);
    },
  };
}
