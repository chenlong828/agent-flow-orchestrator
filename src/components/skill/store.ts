import type { Db } from "../../core/platform/index.ts";
import type { SkillQuery, SkillSectionKind } from "./types.ts";

export type SkillRootRow = {
  id: string;
  name: string;
  category_code: string;
  description: string;
  version: string;
  enabled: boolean;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type SkillSectionRow = {
  skill_id: string;
  kind: SkillSectionKind;
  content_md: string;
};

export type SkillRefRow = {
  skill_id: string;
  position: number;
  label: string;
  ref_type: string;
  path: string | null;
};

export type SkillRootWrite = {
  id: string;
  name: string;
  categoryCode: string;
  description: string;
  version: string;
  enabled: boolean;
  now: Date;
  actor: string | null;
};

export type SkillChildren = {
  tags: string[];
  sections: { kind: SkillSectionKind; content: string }[];
  pitfalls: string[];
  refs: { label: string; refType: string; path: string | null }[];
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildFilters(query: SkillQuery): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.q !== undefined && query.q !== "") {
    params.push(`%${escapeLike(query.q)}%`);
    clauses.push(
      `(name ilike $${params.length} escape '\\' or description ilike $${params.length} escape '\\')`,
    );
  }
  if (query.categoryCode !== undefined) {
    params.push(query.categoryCode);
    clauses.push(`category_code = $${params.length}`);
  }
  if (query.enabled !== undefined) {
    params.push(query.enabled);
    clauses.push(`enabled = $${params.length}`);
  }
  if (query.tag !== undefined) {
    params.push(query.tag);
    clauses.push(
      `exists (select 1 from skill_tag st where st.skill_id = skill.id and st.tag = $${params.length})`,
    );
  }
  return {
    where: clauses.length === 0 ? "" : `where ${clauses.join(" and ")}`,
    params,
  };
}

function orderBy(sort: SkillQuery["sort"]): string {
  const versionAsc =
    "order by split_part(substr(version, 2), '.', 1)::int asc, split_part(substr(version, 2), '.', 2)::int asc, id asc";
  const versionDesc =
    "order by split_part(substr(version, 2), '.', 1)::int desc, split_part(substr(version, 2), '.', 2)::int desc, id asc";
  switch (sort) {
    case "name":
      return "order by lower(name) asc, id asc";
    case "-name":
      return "order by lower(name) desc, id asc";
    case "updatedAt":
      return "order by updated_at asc, id asc";
    case "version":
      return versionAsc;
    case "-version":
      return versionDesc;
    case "-updatedAt":
    case undefined:
      return "order by updated_at desc, id asc";
  }
}

export type SkillStore = ReturnType<typeof createSkillStore>;

export function createSkillStore(db: Db) {
  return {
    async insertRoot(tx: Db, input: SkillRootWrite): Promise<void> {
      await tx.query(
        `insert into skill
          (id, name, category_code, description, version, enabled, revision,
           created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, 1, $7, $7, $8, $8)`,
        [
          input.id,
          input.name,
          input.categoryCode,
          input.description,
          input.version,
          input.enabled,
          input.now,
          input.actor,
        ],
      );
    },

    async updateRoot(
      tx: Db,
      input: Omit<SkillRootWrite, "enabled" | "now"> & { revision: number; now: Date },
    ): Promise<number> {
      const rows = await tx.query<{ id: string }>(
        `update skill set
           name = $1, category_code = $2, description = $3, version = $4,
           revision = revision + 1, updated_at = $5, updated_by = $6
         where id = $7 and revision = $8
         returning id`,
        [
          input.name,
          input.categoryCode,
          input.description,
          input.version,
          input.now,
          input.actor,
          input.id,
          input.revision,
        ],
      );
      return rows.length;
    },

    async setEnabled(
      tx: Db,
      id: string,
      revision: number,
      enabled: boolean,
      now: Date,
      actor: string | null,
    ): Promise<number> {
      const rows = await tx.query<{ id: string }>(
        `update skill set enabled = $1, revision = revision + 1, updated_at = $2,
           updated_by = $3
         where id = $4 and revision = $5
         returning id`,
        [enabled, now, actor, id, revision],
      );
      return rows.length;
    },

    async deleteRoot(tx: Db, id: string, revision: number): Promise<number> {
      const rows = await tx.query<{ id: string }>(
        "delete from skill where id = $1 and revision = $2 returning id",
        [id, revision],
      );
      return rows.length;
    },

    async findRoot(tx: Db, id: string, forUpdate = false): Promise<SkillRootRow | null> {
      return tx.one<SkillRootRow>(
        `select * from skill where id = $1${forUpdate ? " for update" : ""}`,
        [id],
      );
    },

    async listRoots(
      tx: Db,
      query: SkillQuery,
    ): Promise<{ rows: SkillRootRow[]; total: number }> {
      const { where, params } = buildFilters(query);
      const countRow = await tx.one<{ total: number }>(
        `select count(*)::int as total from skill ${where}`,
        params,
      );
      const rows = await tx.query<SkillRootRow>(
        `select * from skill ${where} ${orderBy(query.sort)} limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.page.limit, query.page.offset],
      );
      return { rows, total: countRow?.total ?? 0 };
    },

    async categoryExists(tx: Db, code: string): Promise<boolean> {
      const row = await tx.one<{ code: string }>(
        "select code from skill_category where code = $1",
        [code],
      );
      return row !== null;
    },

    async listCategories(tx: Db): Promise<{ code: string; label: string; position: number }[]> {
      return tx.query("select code, label, position from skill_category order by position asc");
    },

    async replaceChildren(tx: Db, skillId: string, children: SkillChildren): Promise<void> {
      await tx.query("delete from skill_tag where skill_id = $1", [skillId]);
      await tx.query("delete from skill_section where skill_id = $1", [skillId]);
      await tx.query("delete from skill_pitfall where skill_id = $1", [skillId]);
      await tx.query("delete from skill_ref where skill_id = $1", [skillId]);
      for (const [position, tag] of children.tags.entries()) {
        await tx.query(
          "insert into skill_tag (skill_id, position, tag) values ($1, $2, $3)",
          [skillId, position, tag],
        );
      }
      for (const section of children.sections) {
        await tx.query(
          "insert into skill_section (skill_id, kind, content_md) values ($1, $2, $3)",
          [skillId, section.kind, section.content],
        );
      }
      for (const [position, content] of children.pitfalls.entries()) {
        await tx.query(
          "insert into skill_pitfall (skill_id, position, content) values ($1, $2, $3)",
          [skillId, position, content],
        );
      }
      for (const [position, ref] of children.refs.entries()) {
        await tx.query(
          `insert into skill_ref (skill_id, position, label, ref_type, path)
           values ($1, $2, $3, $4, $5)`,
          [skillId, position, ref.label, ref.refType, ref.path],
        );
      }
    },

    async tagsFor(tx: Db, skillId: string): Promise<string[]> {
      const rows = await tx.query<{ tag: string }>(
        "select tag from skill_tag where skill_id = $1 order by position asc",
        [skillId],
      );
      return rows.map((row) => row.tag);
    },

    async sectionsFor(tx: Db, skillId: string): Promise<SkillSectionRow[]> {
      return tx.query<SkillSectionRow>(
        "select skill_id, kind, content_md from skill_section where skill_id = $1",
        [skillId],
      );
    },

    async pitfallsFor(tx: Db, skillId: string): Promise<string[]> {
      const rows = await tx.query<{ content: string }>(
        "select content from skill_pitfall where skill_id = $1 order by position asc",
        [skillId],
      );
      return rows.map((row) => row.content);
    },

    async refsFor(tx: Db, skillId: string): Promise<SkillRefRow[]> {
      return tx.query<SkillRefRow>(
        `select skill_id, position, label, ref_type, path
         from skill_ref where skill_id = $1 order by position asc`,
        [skillId],
      );
    },
  };
}
