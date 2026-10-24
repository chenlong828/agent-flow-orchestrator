import {
  NameConflictError,
  NotFoundError,
  ReferencedError,
  RevisionConflictError,
  ValidationError,
  type Clock,
  type IdGenerator,
  type Page,
  type ReferenceGuard,
} from "../../core/kernel/index.ts";
import { isForeignKeyViolation, isUniqueViolation, type Db } from "../../core/platform/index.ts";
import { createHarnessStore, type HarnessRootRow } from "./store.ts";
import type {
  CreateHarness,
  HarnessDetail,
  HarnessQuery,
  HarnessRead,
  HarnessService,
  HarnessSummary,
  UpdateHarness,
} from "./types.ts";

export type HarnessDeps = {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  guard: ReferenceGuard;
  actor: string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function toSummary(row: HarnessRootRow, tags: string[]): HarnessSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    address: row.address,
    accessMode: row.access_mode,
    enabled: row.enabled,
    health: row.health,
    lastHeartbeatAt: toIsoOrNull(row.last_heartbeat_at),
    concurrencyMax: row.concurrency_max,
    queuePolicy: row.queue_policy,
    tags,
    revision: row.revision,
    updatedAt: toIso(row.updated_at),
  };
}

function toDetail(row: HarnessRootRow, tags: string[]): HarnessDetail {
  return {
    ...toSummary(row, tags),
    description: row.description,
    createdAt: toIso(row.created_at),
  };
}

function ensureText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ValidationError(field, "不能为空");
  if (trimmed.length > maxLength) {
    throw new ValidationError(field, `长度不能超过 ${maxLength}`);
  }
  return trimmed;
}

function ensureOptionalText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  if (value.length > maxLength) throw new ValidationError(field, `长度不能超过 ${maxLength}`);
  return value;
}

function ensureEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ValidationError(field, `必须是 ${allowed.join(" / ")} 之一`);
  }
  return value as T;
}

function ensureTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError("tags", "必须是字符串数组");
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") throw new ValidationError("tags", "必须是字符串数组");
    const tag = item.trim();
    if (tag.length === 0) throw new ValidationError("tags", "标签不能为空");
    if (seen.has(tag)) throw new ValidationError("tags", `标签 ${tag} 重复`);
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

type NormalizedWrite = {
  name: string;
  kind: CreateHarness["kind"];
  address: string;
  accessMode: CreateHarness["accessMode"];
  description: string;
  concurrencyMax: number;
  queuePolicy: CreateHarness["queuePolicy"];
  tags: string[];
  enabled?: boolean;
};

function normalizeWrite(input: CreateHarness): NormalizedWrite {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  const name = ensureText(input.name, "name", 80);
  const kind = ensureEnum(input.kind, "kind", ["container", "server", "desktop", "laptop"]);
  const address = ensureText(input.address, "address", 200);
  const accessMode = ensureEnum(input.accessMode, "accessMode", [
    "agent",
    "ssh",
    "container_registry",
  ]);
  const description = ensureOptionalText(input.description, "description", 500);
  if (
    typeof input.concurrencyMax !== "number" ||
    !Number.isInteger(input.concurrencyMax) ||
    input.concurrencyMax < 1
  ) {
    throw new ValidationError("concurrencyMax", "必须是不小于 1 的整数");
  }
  const queuePolicy = ensureEnum(input.queuePolicy, "queuePolicy", ["fifo", "priority"]);
  const tags = ensureTags(input.tags);
  return {
    name,
    kind,
    address,
    accessMode,
    description,
    concurrencyMax: input.concurrencyMax,
    queuePolicy,
    tags,
  };
}

function normalizeEnabled(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ValidationError("enabled", "必须是布尔值");
  return value;
}

export function createHarnessService(deps: HarnessDeps): HarnessService {
  const { db, clock, ids, guard, actor } = deps;
  const store = createHarnessStore(db);

  return {
    async create(input, requestActor) {
      const normalized = normalizeWrite(input);
      const enabled = normalizeEnabled(input.enabled) ?? true;
      const id = ids.next();
      const now = clock.now();
      const actorValue = requestActor ?? actor;
      try {
        await db.transaction(async (tx) => {
          await store.insertRoot(tx, { ...normalized, enabled, id, now, actor: actorValue });
          await store.replaceTags(tx, id, normalized.tags);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
        throw error;
      }
      return { id, revision: 1 };
    },

    async update(id, revision, input, requestActor) {
      const normalized = normalizeWrite(input);
      const actorValue = requestActor ?? actor;
      const now = clock.now();
      try {
        return await db.transaction(async (tx) => {
          const current = await store.findRoot(tx, id, true);
          if (current === null) throw new NotFoundError("Harness", id);
          if (current.revision !== revision) {
            throw new RevisionConflictError(current.revision);
          }
          const changed = await store.updateRoot(tx, {
            ...normalized,
            id,
            revision,
            now,
            actor: actorValue,
          });
          if (changed === 0) {
            const latest = await store.findRoot(tx, id);
            throw new RevisionConflictError(latest?.revision ?? revision);
          }
          await store.replaceTags(tx, id, normalized.tags);
          return { id, revision: revision + 1 };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
        throw error;
      }
    },

    async setEnabled(id, revision, enabled, requestActor) {
      if (typeof enabled !== "boolean") {
        throw new ValidationError("enabled", "必须是布尔值");
      }
      const now = clock.now();
      return db.transaction(async (tx) => {
        const changed = await store.setEnabled(tx, id, revision, enabled, now, requestActor ?? actor);
        if (changed === 0) {
          const latest = await store.findRoot(tx, id);
          if (latest === null) throw new NotFoundError("Harness", id);
          throw new RevisionConflictError(latest.revision);
        }
        return { id, revision: revision + 1 };
      });
    },

    async delete(id, revision) {
      const current = await store.findRoot(db, id);
      if (current === null) throw new NotFoundError("Harness", id);
      if (current.revision !== revision) throw new RevisionConflictError(current.revision);

      const references = await guard.check("harness", id);
      if (references.length > 0) {
        throw new ReferencedError({ type: "harness", id, name: current.name }, references);
      }
      try {
        await db.transaction(async (tx) => {
          const changed = await store.deleteRoot(tx, id, revision);
          if (changed === 0) {
            const latest = await store.findRoot(tx, id);
            if (latest === null) throw new NotFoundError("Harness", id);
            throw new RevisionConflictError(latest.revision);
          }
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          const latestReferences = await guard.check("harness", id);
          throw new ReferencedError(
            { type: "harness", id, name: current.name },
            latestReferences,
          );
        }
        throw error;
      }
    },
  };
}

export function createHarnessRead(deps: { db: Db }): HarnessRead {
  const { db } = deps;
  const store = createHarnessStore(db);

  return {
    async list(query): Promise<Page<HarnessSummary>> {
      const { rows, total } = await store.listRoots(db, query);
      const items: HarnessSummary[] = [];
      for (const row of rows) {
        const tags = await store.tagsFor(db, row.id);
        items.push(toSummary(row, tags));
      }
      return {
        items,
        total,
        limit: query.page.limit,
        offset: query.page.offset,
      };
    },

    async get(id): Promise<HarnessDetail> {
      const row = await store.findRoot(db, id);
      if (row === null) throw new NotFoundError("Harness", id);
      const tags = await store.tagsFor(db, id);
      return toDetail(row, tags);
    },
  };
}
