import { buildWhere } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import type { ToolKind, ToolParamType, ToolQuery, ToolStatus } from "./types.ts";

export type ToolRootRow = {
  id: string;
  name: string;
  kind: ToolKind;
  invocation: string;
  description: string;
  harness_id: string;
  timeout_ms: number;
  status: ToolStatus;
  last_debug_at: Date | string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type ToolParamRow = {
  tool_id: string;
  position: number;
  param_key: string;
  param_type: ToolParamType;
  description: string;
};

export type ToolRootWrite = {
  id: string;
  name: string;
  kind: ToolKind;
  invocation: string;
  description: string;
  harnessId: string;
  timeoutMs: number;
  now: Date;
  actor: string | null;
};

function orderBy(sort: ToolQuery["sort"]): string {
  switch (sort) {
    case "name":
      return "order by lower(name) asc, id asc";
    case "-name":
      return "order by lower(name) desc, id asc";
    case "updatedAt":
      return "order by updated_at asc, id asc";
    case "-updatedAt":
    case undefined:
      return "order by updated_at desc, id asc";
  }
}

async function insertRoot(tx: Db, input: ToolRootWrite): Promise<void> {
  await tx.query(
    `insert into tool
          (id, name, kind, invocation, description, harness_id, timeout_ms,
           status, last_debug_at, revision, created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, 'unverified', null, 1, $8, $8, $9, $9)`,
    [
      input.id,
      input.name,
      input.kind,
      input.invocation,
      input.description,
      input.harnessId,
      input.timeoutMs,
      input.now,
      input.actor,
    ],
  );
}

async function updateRoot(
  tx: Db,
  input: Omit<ToolRootWrite, "now"> & { revision: number; now: Date },
): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    `update tool set
           name = $1, kind = $2, invocation = $3, description = $4, harness_id = $5,
           timeout_ms = $6, revision = revision + 1, updated_at = $7, updated_by = $8
         where id = $9 and revision = $10
         returning id`,
    [
      input.name,
      input.kind,
      input.invocation,
      input.description,
      input.harnessId,
      input.timeoutMs,
      input.now,
      input.actor,
      input.id,
      input.revision,
    ],
  );
  return rows.length;
}

async function deleteRoot(tx: Db, id: string, revision: number): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    "delete from tool where id = $1 and revision = $2 returning id",
    [id, revision],
  );
  return rows.length;
}

async function findRoot(tx: Db, id: string, forUpdate = false): Promise<ToolRootRow | null> {
  return tx.one<ToolRootRow>(
    `select * from tool where id = $1${forUpdate ? " for update" : ""}`,
    [id],
  );
}

async function listRoots(
  tx: Db,
  query: ToolQuery,
): Promise<{ rows: ToolRootRow[]; total: number }> {
  const { where, params } = buildWhere(query, [
    { key: "q", column: "name", like: true },
    { key: "kind", column: "kind" },
    { key: "status", column: "status" },
    { key: "harnessId", column: "harness_id" },
  ]);
  const countRow = await tx.one<{ total: number }>(
    `select count(*)::int as total from tool ${where}`,
    params,
  );
  const rows = await tx.query<ToolRootRow>(
    `select * from tool ${where} ${orderBy(query.sort)} limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, query.page.limit, query.page.offset],
  );
  return { rows, total: countRow?.total ?? 0 };
}

async function replaceParams(tx: Db, toolId: string, params: ToolParamRow[]): Promise<void> {
  await tx.query("delete from tool_param where tool_id = $1", [toolId]);
  for (const param of params) {
    await tx.query(
      `insert into tool_param (tool_id, position, param_key, param_type, description)
           values ($1, $2, $3, $4, $5)`,
      [toolId, param.position, param.param_key, param.param_type, param.description],
    );
  }
}

async function paramsFor(tx: Db, toolId: string): Promise<ToolParamRow[]> {
  return tx.query<ToolParamRow>(
    `select tool_id, position, param_key, param_type, description
         from tool_param where tool_id = $1 order by position asc`,
    [toolId],
  );
}

async function listByHarness(tx: Db, harnessId: string): Promise<{ id: string; name: string }[]> {
  return tx.query<{ id: string; name: string }>(
    "select id, name from tool where harness_id = $1 order by lower(name) asc, id asc",
    [harnessId],
  );
}

export type ToolStore = ReturnType<typeof createToolStore>;

export function createToolStore(db: Db) {
  return {
    insertRoot,
    updateRoot,
    deleteRoot,
    findRoot,
    listRoots,
    replaceParams,
    paramsFor,
    listByHarness,
  };
}
