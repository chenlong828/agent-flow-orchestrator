import type { Db } from "../../core/platform/index.ts";
import type { SkillSlugReader } from "../../core/kernel/index.ts";

type SkillSlugRow = {
  id: string;
  slug: string;
};

export type SkillSlugReaderDeps = {
  db: Db;
};

/** 技能系统标识只读实现：供专家装配入口校验同一专家内技能名不重复。 */
export function createSkillSlugReader(deps: SkillSlugReaderDeps): SkillSlugReader {
  return {
    async slugsFor(skillIds: string[]): Promise<Record<string, string>> {
      if (skillIds.length === 0) return {};
      const rows = await deps.db.query<SkillSlugRow>(
        "select id, slug from skill where id = any($1::uuid[])",
        [skillIds],
      );
      return Object.fromEntries(rows.map((row) => [row.id, row.slug]));
    },
  };
}
