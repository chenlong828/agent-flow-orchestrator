import { buildWhere } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import type { WorkflowGraph, WorkflowQuery } from "./types.ts";

export type WorkflowRootRow = {
  id: string;
  name: string;
  type: string;
  description: string;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  created_by: string | null;
  updated_by: string | null;
  node_count: number;
  stage_count: number;
};

export type WorkflowRootWrite = {
  id: string;
  name: string;
  type: string;
  description: string;
  now: Date;
  actor: string | null;
};

export type WorkflowDefinitionRow = {
  workflow_id: string;
  graph: WorkflowGraph;
  updated_at: Date | string;
  updated_by: string | null;
};

function orderBy(sort: WorkflowQuery["sort"]): string {
  switch (sort) {
    case "name":
      return "order by lower(w.name) asc, w.id asc";
    case "-name":
      return "order by lower(w.name) desc, w.id asc";
    case "updatedAt":
      return "order by w.updated_at asc, w.id asc";
    case "-updatedAt":
    case undefined:
      return "order by w.updated_at desc, w.id asc";
  }
}

const ROOT_SELECT = `
  select w.*,
    coalesce(jsonb_array_length(d.graph->'nodes'), 0)::int as node_count,
    coalesce(jsonb_array_length(d.graph->'stages'), 0)::int as stage_count
  from workflow w
  join workflow_definition d on d.workflow_id = w.id
`;

async function insertRoot(tx: Db, input: WorkflowRootWrite): Promise<void> {
  await tx.query(
    `insert into workflow
          (id, name, type, description, revision, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, 1, $5, $5, $6, $6)`,
    [input.id, input.name, input.type, input.description, input.now, input.actor],
  );
}

async function insertDefinition(
  tx: Db,
  workflowId: string,
  graph: WorkflowGraph,
  now: Date,
  actor: string | null,
): Promise<void> {
  await tx.query(
    `insert into workflow_definition (workflow_id, graph, updated_at, updated_by)
         values ($1, $2::text::jsonb, $3, $4)`,
    [workflowId, JSON.stringify(graph), now, actor],
  );
}

async function updateRoot(
  tx: Db,
  id: string,
  revision: number,
  input: { name: string; type: string; description: string; now: Date; actor: string | null },
): Promise<number | null> {
  const row = await tx.one<{ revision: number }>(
    `update workflow set
           name = $1, type = $2, description = $3, revision = revision + 1,
           updated_at = $4, updated_by = $5
         where id = $6 and revision = $7
         returning revision`,
    [input.name, input.type, input.description, input.now, input.actor, id, revision],
  );
  return row?.revision ?? null;
}

async function bumpRevision(
  tx: Db,
  id: string,
  revision: number,
  now: Date,
  actor: string | null,
): Promise<number | null> {
  const row = await tx.one<{ revision: number }>(
    `update workflow set revision = revision + 1, updated_at = $1, updated_by = $2
         where id = $3 and revision = $4
         returning revision`,
    [now, actor, id, revision],
  );
  return row?.revision ?? null;
}

async function deleteRoot(tx: Db, id: string, revision: number): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    "delete from workflow where id = $1 and revision = $2 returning id",
    [id, revision],
  );
  return rows.length;
}

async function findRoot(tx: Db, id: string, forUpdate = false): Promise<WorkflowRootRow | null> {
  const suffix = forUpdate ? " for update of w" : "";
  return tx.one<WorkflowRootRow>(`${ROOT_SELECT} where w.id = $1${suffix}`, [id]);
}

async function findDefinition(tx: Db, id: string): Promise<WorkflowDefinitionRow | null> {
  return tx.one<WorkflowDefinitionRow>(
    "select workflow_id, graph, updated_at, updated_by from workflow_definition where workflow_id = $1",
    [id],
  );
}

async function listRoots(
  tx: Db,
  query: WorkflowQuery,
): Promise<{ rows: WorkflowRootRow[]; total: number }> {
  const { where, params } = buildWhere(query, [
    { key: "q", column: "w.name", like: true },
    { key: "type", column: "w.type", skipEmpty: true },
  ]);
  const countRow = await tx.one<{ total: number }>(
    `select count(*)::int as total from workflow w ${where}`,
    params,
  );
  const rows = await tx.query<WorkflowRootRow>(
    `${ROOT_SELECT} ${where} ${orderBy(query.sort)}
         limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, query.page.limit, query.page.offset],
  );
  return { rows, total: countRow?.total ?? 0 };
}

async function replaceGraph(
  tx: Db,
  id: string,
  graph: WorkflowGraph,
  now: Date,
  actor: string | null,
): Promise<void> {
  await tx.query(
    `update workflow_definition
         set graph = $2::text::jsonb, updated_at = $3, updated_by = $4
         where workflow_id = $1`,
    [id, JSON.stringify(graph), now, actor],
  );
}

async function replaceExpertRefs(tx: Db, id: string, graph: WorkflowGraph): Promise<void> {
  await tx.query("delete from workflow_expert_ref where workflow_id = $1", [id]);
  for (const node of graph.nodes) {
    if (node.expertId === null) continue;
    await tx.query(
      `insert into workflow_expert_ref (workflow_id, node_id, expert_id)
           values ($1, $2, $3)`,
      [id, node.id, node.expertId],
    );
  }
}

async function nameExists(tx: Db, name: string): Promise<boolean> {
  const row = await tx.one<{ found: number }>(
    "select 1 as found from workflow where lower(name) = lower($1) limit 1",
    [name],
  );
  return row !== null;
}

async function listByExpert(tx: Db, expertId: string): Promise<{ id: string; name: string }[]> {
  return tx.query<{ id: string; name: string }>(
    `select w.id, w.name
         from workflow w
         join workflow_expert_ref r on r.workflow_id = w.id
         where r.expert_id = $1
         group by w.id, w.name
         order by max(w.updated_at) desc, w.id asc`,
    [expertId],
  );
}

async function countByExperts(tx: Db, expertIds: string[]): Promise<Record<string, number>> {
  if (expertIds.length === 0) return {};
  const rows = await tx.query<{ expert_id: string; ref_count: number }>(
    `select expert_id, count(distinct workflow_id)::int as ref_count
         from workflow_expert_ref
         where expert_id = any($1::uuid[])
         group by expert_id`,
    [expertIds],
  );
  return Object.fromEntries(rows.map((row) => [row.expert_id, row.ref_count]));
}

export type WorkflowStore = ReturnType<typeof createWorkflowStore>;

export function createWorkflowStore() {
  return {
    insertRoot,
    insertDefinition,
    updateRoot,
    bumpRevision,
    deleteRoot,
    findRoot,
    findDefinition,
    listRoots,
    replaceGraph,
    replaceExpertRefs,
    nameExists,
    listByExpert,
    countByExperts,
  };
}
