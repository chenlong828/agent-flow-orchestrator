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
  now: Date;
  actor: string | null;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildFilters(query: HarnessQuery): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.q !== undefined && query.q !== "") {
    params.push(`%${escapeLike(query.q)}%`);
    clauses.push(`name ilike $${params.length} escape '\\'`);
  }
  if (query.kind !== undefined) {
    params.push(query.kind);
    clauses.push(`kind = $${params.length}`);
  }
  if (query.enabled !== undefined) {
    params.push(query.enabled);
    clauses.push(`enabled = $${params.length}`);
  }
  if (query.health !== undefined) {
    params.push(query.health);
    clauses.push(`health = $${params.length}`);
  }
  return {
    where: clauses.length === 0 ? "" : `where ${clauses.join(" and ")}`,
    params,
  };
}

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

export type HarnessStore = ReturnType<typeof createHarnessStore>;

export function createHarnessStore(db: Db) {
  return {
    async insertRoot(tx: Db, input: HarnessRootWrite): Promise<void> {
      await tx.query(
        `insert into harness
          (id, name, kind, address, access_mode, description, concurrency_max,
           queue_policy, enabled, health, last_heartbeat_at, revision,
           created_at, updated_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unknown', null, 1, $10, $10, $11, $11)`,
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
          input.now,
          input.actor,
        ],
      );
    },

    async updateRoot(tx: Db, input: Omit<HarnessRootWrite, "enabled" | "now"> & {
      revision: number;
      now: Date;
    }): Promise<number> {
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
        `update harness set enabled = $1, revision = revision + 1, updated_at = $2,
           updated_by = $3
         where id = $4 and revision = $5
         returning id`,
        [enabled, now, actor, id, revision],
      );
      return rows.length;
    },

    async deleteRoot(tx: Db, id: string, revision: number): Promise<number> {
      const rows = await tx.query<{ id: string }>(
        "delete from harness where id = $1 and revision = $2 returning id",
        [id, revision],
      );
      return rows.length;
    },

    async findRoot(tx: Db, id: string, forUpdate = false): Promise<HarnessRootRow | null> {
      return tx.one<HarnessRootRow>(
        `select * from harness where id = $1${forUpdate ? " for update" : ""}`,
        [id],
      );
    },

    async listRoots(
      tx: Db,
      query: HarnessQuery,
    ): Promise<{ rows: HarnessRootRow[]; total: number }> {
      const { where, params } = buildFilters(query);
      const countRow = await tx.one<{ total: number }>(
        `select count(*)::int as total from harness ${where}`,
        params,
      );
      const rows = await tx.query<HarnessRootRow>(
        `select * from harness ${where} ${orderBy(query.sort)} limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.page.limit, query.page.offset],
      );
      return { rows, total: countRow?.total ?? 0 };
    },

    async replaceTags(tx: Db, harnessId: string, tags: string[]): Promise<void> {
      await tx.query("delete from harness_tag where harness_id = $1", [harnessId]);
      for (const [position, tag] of tags.entries()) {
        await tx.query(
          "insert into harness_tag (harness_id, position, tag) values ($1, $2, $3)",
          [harnessId, position, tag],
        );
      }
    },

    async tagsFor(tx: Db, harnessId: string): Promise<string[]> {
      const rows = await tx.query<{ tag: string }>(
        "select tag from harness_tag where harness_id = $1 order by position asc",
        [harnessId],
      );
      return rows.map((row) => row.tag);
    },
  };
}
