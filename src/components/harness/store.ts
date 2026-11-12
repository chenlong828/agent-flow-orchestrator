import { buildWhere } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import type {
  HarnessAccessMode,
  HarnessHealth,
  HarnessKind,
  HarnessQuery,
  QueuePolicy,
} from "./types.ts";

export type HarnessRootRow = {
  id: string;
  name: string;
  kind: HarnessKind;
  address: string;
  access_mode: HarnessAccessMode;
  description: string;
  concurrency_max: number;
  queue_policy: QueuePolicy;
  enabled: boolean;
  client_id: string | null;
  client_token: string | null;
  health: HarnessHealth;
  last_heartbeat_at: Date | string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type HarnessRootWrite = {
  id: string;
  name: string;
  kind: HarnessKind;
  address: string;
  accessMode: HarnessAccessMode;
  description: string;
  concurrencyMax: number;
  queuePolicy: QueuePolicy;
  enabled: boolean;
  /** 仅开发期自注册在插入时直接写入 `client_id`；管理面写入仍只经 `bindClient`。 */
  clientId?: string | null;
  now: Date;
  actor: string | null;
};

function orderBy(sort: HarnessQuery["sort"]): string {
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

async function insertRoot(tx: Db, input: HarnessRootWrite): Promise<void> {
  await tx.query(
    `insert into harness
          (id, name, kind, address, access_mode, description, concurrency_max,
           queue_policy, enabled, client_id, health, last_heartbeat_at, revision,
           created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'unknown', null, 1, $11, $11, $12, $12)`,
    [
      input.id,
      input.name,
      input.kind,
      input.address,
      input.accessMode,
      input.description,
      input.concurrencyMax,
      input.queuePolicy,
      input.enabled,
      input.clientId ?? null,
      input.now,
      input.actor,
    ],
  );
}

async function updateRoot(
  tx: Db,
  input: Omit<HarnessRootWrite, "enabled" | "now"> & {
    revision: number;
    now: Date;
  },
): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    `update harness set
           name = $1, kind = $2, address = $3, access_mode = $4, description = $5,
           concurrency_max = $6, queue_policy = $7, revision = revision + 1,
           updated_at = $8, updated_by = $9
         where id = $10 and revision = $11
         returning id`,
    [
      input.name,
      input.kind,
      input.address,
      input.accessMode,
      input.description,
      input.concurrencyMax,
      input.queuePolicy,
      input.now,
      input.actor,
      input.id,
      input.revision,
    ],
  );
  return rows.length;
}

type SetEnabledOptions = {
  tx: Db;
  id: string;
  revision: number;
  enabled: boolean;
  now: Date;
  actor: string | null;
};

async function setEnabled(options: SetEnabledOptions): Promise<number> {
  const rows = await options.tx.query<{ id: string }>(
    `update harness set enabled = $1, revision = revision + 1, updated_at = $2,
           updated_by = $3
         where id = $4 and revision = $5
         returning id`,
    [options.enabled, options.now, options.actor, options.id, options.revision],
  );
  return rows.length;
}

async function deleteRoot(tx: Db, id: string, revision: number): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    "delete from harness where id = $1 and revision = $2 returning id",
    [id, revision],
  );
  return rows.length;
}

type ClientWriteOptions = {
  tx: Db;
  id: string;
  revision: number;
  clientId: string;
  token: string;
  now: Date;
  actor: string | null;
};

async function bindClient(options: ClientWriteOptions): Promise<number> {
  const rows = await options.tx.query<{ id: string }>(
    `update harness set client_id = $1, client_token = $2, revision = revision + 1,
           updated_at = $3, updated_by = $4
         where id = $5 and revision = $6
         returning id`,
    [
      options.clientId,
      options.token,
      options.now,
      options.actor,
      options.id,
      options.revision,
    ],
  );
  return rows.length;
}

type UnbindOptions = {
  tx: Db;
  id: string;
  revision: number;
  now: Date;
  actor: string | null;
};

async function unbindClient(options: UnbindOptions): Promise<number> {
  const rows = await options.tx.query<{ id: string }>(
    `update harness set client_id = null, client_token = null, revision = revision + 1,
           updated_at = $1, updated_by = $2
         where id = $3 and revision = $4
         returning id`,
    [options.now, options.actor, options.id, options.revision],
  );
  return rows.length;
}

async function findByClientId(tx: Db, clientId: string): Promise<HarnessRootRow | null> {
  return tx.one<HarnessRootRow>("select * from harness where client_id = $1", [clientId]);
}

async function findClientIdByToken(tx: Db, token: string): Promise<string | null> {
  const row = await tx.one<{ client_id: string | null }>(
    "select client_id from harness where client_token = $1",
    [token],
  );
  return row?.client_id ?? null;
}

async function isDispatchable(tx: Db, clientId: string): Promise<boolean> {
  const row = await tx.one<{ ok: number }>(
    "select 1 as ok from harness where client_id = $1 and enabled",
    [clientId],
  );
  return row !== null;
}

async function listDispatchableClientIds(tx: Db): Promise<string[]> {
  const rows = await tx.query<{ client_id: string }>(
    "select client_id from harness where client_id is not null and enabled order by client_id",
    [],
  );
  return rows.map((row) => row.client_id);
}

async function findRoot(tx: Db, id: string, forUpdate = false): Promise<HarnessRootRow | null> {
  return tx.one<HarnessRootRow>(
    `select * from harness where id = $1${forUpdate ? " for update" : ""}`,
    [id],
  );
}

async function listRoots(
  tx: Db,
  query: HarnessQuery,
): Promise<{ rows: HarnessRootRow[]; total: number }> {
  const { where, params } = buildWhere(query, [
    { key: "q", column: "name", like: true },
    { key: "kind", column: "kind" },
    { key: "enabled", column: "enabled" },
    { key: "health", column: "health" },
  ]);
  const countRow = await tx.one<{ total: number }>(
    `select count(*)::int as total from harness ${where}`,
    params,
  );
  const rows = await tx.query<HarnessRootRow>(
    `select * from harness ${where} ${orderBy(query.sort)} limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, query.page.limit, query.page.offset],
  );
  return { rows, total: countRow?.total ?? 0 };
}

async function replaceTags(tx: Db, harnessId: string, tags: string[]): Promise<void> {
  await tx.query("delete from harness_tag where harness_id = $1", [harnessId]);
  for (const [position, tag] of tags.entries()) {
    await tx.query(
      "insert into harness_tag (harness_id, position, tag) values ($1, $2, $3)",
      [harnessId, position, tag],
    );
  }
}

async function tagsFor(tx: Db, harnessId: string): Promise<string[]> {
  const rows = await tx.query<{ tag: string }>(
    "select tag from harness_tag where harness_id = $1 order by position asc",
    [harnessId],
  );
  return rows.map((row) => row.tag);
}

export type HarnessStore = ReturnType<typeof createHarnessStore>;

export function createHarnessStore() {
  return {
    insertRoot,
    updateRoot,
    setEnabled,
    bindClient,
    unbindClient,
    deleteRoot,
    findRoot,
    findByClientId,
    findClientIdByToken,
    isDispatchable,
    listDispatchableClientIds,
    listRoots,
    replaceTags,
    tagsFor,
  };
}
