import type { Db } from "../../core/platform/index.ts";
import type { ExpertQuery } from "./types.ts";
import type { ExpertRootRow } from "./store-types.ts";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildFilters(query: ExpertQuery): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.q !== undefined && query.q !== "") {
    params.push(`%${escapeLike(query.q)}%`);
    clauses.push(`e.name ilike $${params.length} escape '\\'`);
  }
  if (query.enabled !== undefined) {
    params.push(query.enabled);
    clauses.push(`e.enabled = $${params.length}`);
  }
  return {
    where: clauses.length === 0 ? "" : `where ${clauses.join(" and ")}`,
    params,
  };
}

function orderBy(sort: ExpertQuery["sort"]): string {
  switch (sort) {
    case "name":
      return "order by lower(e.name) asc, e.id asc";
    case "-name":
      return "order by lower(e.name) desc, e.id asc";
    case "updatedAt":
      return "order by e.updated_at asc, e.id asc";
    case "-updatedAt":
    case undefined:
      return "order by e.updated_at desc, e.id asc";
  }
}

const ROOT_SELECT = `
  select e.*,
    (select count(*)::int from expert_skill es where es.expert_id = e.id) as skill_count,
    (select count(*)::int from expert_tool et where et.expert_id = e.id) as tool_count
  from expert e
`;

export function createExpertStoreRootReads() {
  return {
    async findRoot(tx: Db, id: string, forUpdate = false): Promise<ExpertRootRow | null> {
      if (forUpdate) {
        return tx.one<ExpertRootRow>(
          `select e.*, 0 as skill_count, 0 as tool_count
           from expert e where e.id = $1 for update of e`,
          [id],
        );
      }
      return tx.one<ExpertRootRow>(`${ROOT_SELECT} where e.id = $1`, [id]);
    },

    async listRoots(
      tx: Db,
      query: ExpertQuery,
    ): Promise<{ rows: ExpertRootRow[]; total: number }> {
      const { where, params } = buildFilters(query);
      const countRow = await tx.one<{ total: number }>(
        `select count(*)::int as total from expert e ${where}`,
        params,
      );
      const rows = await tx.query<ExpertRootRow>(
        `${ROOT_SELECT} ${where} ${orderBy(query.sort)} limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.page.limit, query.page.offset],
      );
      return { rows, total: countRow?.total ?? 0 };
    },

    async statuses(tx: Db, expertIds: string[]): Promise<Record<string, boolean>> {
      if (expertIds.length === 0) return {};
      const rows = await tx.query<{ id: string; enabled: boolean }>(
        "select id, enabled from expert where id = any($1::uuid[])",
        [expertIds],
      );
      return Object.fromEntries(rows.map((row) => [row.id, row.enabled]));
    },
  };
}
