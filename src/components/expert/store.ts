import { buildWhere } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import type { ExpertQuery } from "./types.ts";

export type ExpertRootRow = {
  id: string;
  name: string;
  color: string;
  role: string;
  enabled: boolean;
  duty: string;
  skill_order: string;
  verify_order: string;
  notes: string;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  skill_count: number;
  tool_count: number;
};

export type ExpertRootWrite = {
  id: string;
  name: string;
  color: string;
  role: string;
  enabled: boolean;
  duty: string;
  skillOrder: string;
  verifyOrder: string;
  notes: string;
  now: Date;
  actor: string | null;
};

export type ExpertRefRow = {
  expert_id: string;
  position: number;
  label: string;
  ref_type: string;
  path: string | null;
};

type SetEnabledInput = {
  id: string;
  revision: number;
  enabled: boolean;
  now: Date;
  actor: string | null;
};

type UpdateRootInput = Omit<ExpertRootWrite, "enabled" | "now"> & {
  revision: number;
  now: Date;
};

const DEFAULT_ORDER = "order by e.updated_at desc, e.id asc";

const ORDER_BY: Record<string, string> = {
  name: "order by lower(e.name) asc, e.id asc",
  "-name": "order by lower(e.name) desc, e.id asc",
  updatedAt: "order by e.updated_at asc, e.id asc",
  "-updatedAt": DEFAULT_ORDER,
};

const ROOT_SELECT = `
  select e.*,
    (select count(*)::int from expert_skill es where es.expert_id = e.id) as skill_count,
    (select count(*)::int from expert_tool et where et.expert_id = e.id) as tool_count
  from expert e
`;

async function findRoot(tx: Db, id: string, forUpdate = false): Promise<ExpertRootRow | null> {
  if (forUpdate) {
    return tx.one<ExpertRootRow>(
      `select e.*, 0 as skill_count, 0 as tool_count
       from expert e where e.id = $1 for update of e`,
      [id],
    );
  }
  return tx.one<ExpertRootRow>(`${ROOT_SELECT} where e.id = $1`, [id]);
}

async function listRoots(
  tx: Db,
  query: ExpertQuery,
): Promise<{ rows: ExpertRootRow[]; total: number }> {
  const { where, params } = buildWhere(query, [
    { key: "q", column: "e.name", like: true },
    { key: "enabled", column: "e.enabled" },
  ]);
  const countRow = await tx.one<{ total: number }>(
    `select count(*)::int as total from expert e ${where}`,
    params,
  );
  const order = ORDER_BY[query.sort ?? ""] ?? DEFAULT_ORDER;
  const rows = await tx.query<ExpertRootRow>(
    `${ROOT_SELECT} ${where} ${order} limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, query.page.limit, query.page.offset],
  );
  return { rows, total: countRow?.total ?? 0 };
}

async function statuses(tx: Db, expertIds: string[]): Promise<Record<string, boolean>> {
  if (expertIds.length === 0) return {};
  const rows = await tx.query<{ id: string; enabled: boolean }>(
    "select id, enabled from expert where id = any($1::uuid[])",
    [expertIds],
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.enabled]));
}

async function insertRoot(tx: Db, input: ExpertRootWrite): Promise<void> {
  await tx.query(
    `insert into expert
      (id, name, color, role, enabled, duty, skill_order, verify_order, notes,
       revision, created_at, updated_at, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10, $11, $11)`,
    [
      input.id,
      input.name,
      input.color,
      input.role,
      input.enabled,
      input.duty,
      input.skillOrder,
      input.verifyOrder,
      input.notes,
      input.now,
      input.actor,
    ],
  );
}

async function updateRoot(tx: Db, input: UpdateRootInput): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    `update expert set
       name = $1, color = $2, role = $3, duty = $4, skill_order = $5,
       verify_order = $6, notes = $7, revision = revision + 1,
       updated_at = $8, updated_by = $9
     where id = $10 and revision = $11
     returning id`,
    [
      input.name,
      input.color,
      input.role,
      input.duty,
      input.skillOrder,
      input.verifyOrder,
      input.notes,
      input.now,
      input.actor,
      input.id,
      input.revision,
    ],
  );
  return rows.length;
}

async function setEnabled(tx: Db, input: SetEnabledInput): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    `update expert set enabled = $1, revision = revision + 1, updated_at = $2,
       updated_by = $3
     where id = $4 and revision = $5
     returning id`,
    [input.enabled, input.now, input.actor, input.id, input.revision],
  );
  return rows.length;
}

async function deleteRoot(tx: Db, id: string, revision: number): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    "delete from expert where id = $1 and revision = $2 returning id",
    [id, revision],
  );
  return rows.length;
}

async function bumpRevision(
  tx: Db,
  id: string,
  revision: number,
  now: Date,
  actor: string | null,
): Promise<number | null> {
  const row = await tx.one<{ revision: number }>(
    `update expert set revision = revision + 1, updated_at = $1, updated_by = $2
     where id = $3 and revision = $4
     returning revision`,
    [now, actor, id, revision],
  );
  return row?.revision ?? null;
}

async function replacePersona(tx: Db, expertId: string, persona: string[]): Promise<void> {
  await tx.query("delete from expert_persona where expert_id = $1", [expertId]);
  for (const [position, value] of persona.entries()) {
    await tx.query(
      "insert into expert_persona (expert_id, position, value) values ($1, $2, $3)",
      [expertId, position, value],
    );
  }
}

async function personaFor(tx: Db, expertId: string): Promise<string[]> {
  const rows = await tx.query<{ value: string }>(
    "select value from expert_persona where expert_id = $1 order by position asc",
    [expertId],
  );
  return rows.map((row) => row.value);
}

async function replaceRefs(
  tx: Db,
  expertId: string,
  refs: { label: string; refType: string; path: string | null }[],
): Promise<void> {
  await tx.query("delete from expert_ref where expert_id = $1", [expertId]);
  for (const [position, ref] of refs.entries()) {
    await tx.query(
      `insert into expert_ref (expert_id, position, label, ref_type, path)
       values ($1, $2, $3, $4, $5)`,
      [expertId, position, ref.label, ref.refType, ref.path],
    );
  }
}

async function refsFor(tx: Db, expertId: string): Promise<ExpertRefRow[]> {
  return tx.query<ExpertRefRow>(
    `select expert_id, position, label, ref_type, path
     from expert_ref where expert_id = $1 order by position asc`,
    [expertId],
  );
}

async function clearSkillLinks(tx: Db, expertId: string): Promise<void> {
  await tx.query("delete from expert_skill where expert_id = $1", [expertId]);
}

async function insertSkillLink(
  tx: Db,
  expertId: string,
  skillId: string,
  position: number,
): Promise<void> {
  await tx.query(
    "insert into expert_skill (expert_id, position, skill_id) values ($1, $2, $3)",
    [expertId, position, skillId],
  );
}

async function skillIdsFor(tx: Db, expertId: string): Promise<string[]> {
  const rows = await tx.query<{ skill_id: string }>(
    "select skill_id from expert_skill where expert_id = $1 order by position asc",
    [expertId],
  );
  return rows.map((row) => row.skill_id);
}

async function listUsingSkill(
  tx: Db,
  skillId: string,
): Promise<{ id: string; name: string }[]> {
  return tx.query(
    `select e.id, e.name from expert_skill es
     join expert e on e.id = es.expert_id
     where es.skill_id = $1 order by lower(e.name) asc, e.id asc`,
    [skillId],
  );
}

async function clearToolLinks(tx: Db, expertId: string): Promise<void> {
  await tx.query("delete from expert_tool where expert_id = $1", [expertId]);
}

async function insertToolLink(
  tx: Db,
  expertId: string,
  toolId: string,
  position: number,
): Promise<void> {
  await tx.query(
    "insert into expert_tool (expert_id, position, tool_id) values ($1, $2, $3)",
    [expertId, position, toolId],
  );
}

async function toolIdsFor(tx: Db, expertId: string): Promise<string[]> {
  const rows = await tx.query<{ tool_id: string }>(
    "select tool_id from expert_tool where expert_id = $1 order by position asc",
    [expertId],
  );
  return rows.map((row) => row.tool_id);
}

async function listUsingTool(
  tx: Db,
  toolId: string,
): Promise<{ id: string; name: string }[]> {
  return tx.query(
    `select e.id, e.name from expert_tool et
     join expert e on e.id = et.expert_id
     where et.tool_id = $1 order by lower(e.name) asc, e.id asc`,
    [toolId],
  );
}

export const expertStore = {
  findRoot,
  listRoots,
  statuses,
  insertRoot,
  updateRoot,
  setEnabled,
  deleteRoot,
  bumpRevision,
  replacePersona,
  personaFor,
  replaceRefs,
  refsFor,
  clearSkillLinks,
  insertSkillLink,
  skillIdsFor,
  listUsingSkill,
  clearToolLinks,
  insertToolLink,
  toolIdsFor,
  listUsingTool,
};

export type ExpertStore = typeof expertStore;
