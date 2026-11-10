import {
  BindingConflictError,
  ensureBoolean,
  toIso,
  toIsoOrNull,
  ensureEnum,
  ensureOptionalText,
  ensureText,
  NameConflictError,
  NotFoundError,
  ReferencedError,
  RevisionConflictError,
  ValidationError,
  type Clock,
  type ExecutorAuthenticator,
  type IdGenerator,
  type NodeDirectory,
  type Page,
  type ReferenceGuard,
} from "../../core/kernel/index.ts";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  violationConstraint,
  type Db,
} from "../../core/platform/index.ts";
import { createHarnessStore, type HarnessRootRow, type HarnessStore } from "./store.ts";
import type {
  CreateHarness,
  HarnessClientBinding,
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

function toSummary(row: HarnessRootRow, tags: string[]): HarnessSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    address: row.address,
    accessMode: row.access_mode,
    enabled: row.enabled,
    clientId: row.client_id,
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
    clientToken: row.client_token,
    createdAt: toIso(row.created_at),
  };
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

type HarnessServiceContext = {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  guard: ReferenceGuard;
  actor: string;
  store: HarnessStore;
};

async function createHarness(
  ctx: HarnessServiceContext,
  input: CreateHarness,
  requestActor?: string,
): Promise<{ id: string; revision: number }> {
  const normalized = normalizeWrite(input);
  const enabled = normalizeEnabled(input.enabled) ?? true;
  const id = ctx.ids.next();
  const now = ctx.clock.now();
  const actorValue = requestActor ?? ctx.actor;
  try {
    await ctx.db.transaction(async (tx) => {
      await ctx.store.insertRoot(tx, { ...normalized, enabled, id, now, actor: actorValue });
      await ctx.store.replaceTags(tx, id, normalized.tags);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
    throw error;
  }
  return { id, revision: 1 };
}

async function updateHarness(
  ctx: HarnessServiceContext,
  id: string,
  revision: number,
  input: UpdateHarness,
  requestActor?: string,
): Promise<{ id: string; revision: number }> {
  const normalized = normalizeWrite(input);
  const actorValue = requestActor ?? ctx.actor;
  const now = ctx.clock.now();
  try {
    return await ctx.db.transaction(async (tx) => {
      const current = await ctx.store.findRoot(tx, id, true);
      if (current === null) throw new NotFoundError("Harness", id);
      if (current.revision !== revision) {
        throw new RevisionConflictError(current.revision);
      }
      const changed = await ctx.store.updateRoot(tx, {
        ...normalized,
        id,
        revision,
        now,
        actor: actorValue,
      });
      if (changed === 0) {
        const latest = await ctx.store.findRoot(tx, id);
        throw new RevisionConflictError(latest?.revision ?? revision);
      }
      await ctx.store.replaceTags(tx, id, normalized.tags);
      return { id, revision: revision + 1 };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
    throw error;
  }
}

/** 单行乐观锁写：写返回 0 时按「不存在」或「revision 过期」抛出。 */
async function applyRevisioned(
  ctx: HarnessServiceContext,
  id: string,
  revision: number,
  write: (tx: Db) => Promise<number>,
): Promise<{ id: string; revision: number }> {
  return ctx.db.transaction(async (tx) => {
    const changed = await write(tx);
    if (changed === 0) {
      const latest = await ctx.store.findRoot(tx, id);
      if (latest === null) throw new NotFoundError("Harness", id);
      throw new RevisionConflictError(latest.revision);
    }
    return { id, revision: revision + 1 };
  });
}

async function setHarnessEnabled(
  ctx: HarnessServiceContext,
  id: string,
  revision: number,
  enabled: boolean,
  requestActor?: string,
): Promise<{ id: string; revision: number }> {
  const enabledValue = ensureBoolean(enabled, "enabled");
  const now = ctx.clock.now();
  return applyRevisioned(ctx, id, revision, (tx) =>
    ctx.store.setEnabled({
      tx,
      id,
      revision,
      enabled: enabledValue,
      now,
      actor: requestActor ?? ctx.actor,
    }),
  );
}

const CLIENT_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,64}$/;
const CLIENT_TOKEN_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,128}$/;

function ensureClientId(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("clientId", "必须是字符串");
  if (!CLIENT_ID_PATTERN.test(value)) {
    throw new ValidationError("clientId", "必须是 1–64 个非空白字符");
  }
  return value;
}

function ensureClientToken(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("token", "必须是字符串");
  if (!CLIENT_TOKEN_PATTERN.test(value)) {
    throw new ValidationError("token", "必须是 1–128 个非空白字符");
  }
  return value;
}

/** 唯一约束冲突按约束名分派：clientId 与 token 各有独立索引，名称冲突不在此路径。 */
function throwClientConflict(error: unknown, clientId: string): never {
  const constraint = isUniqueViolation(error) ? violationConstraint(error) : null;
  if (constraint === "harness_client_token_key") {
    throw new BindingConflictError("clientToken");
  }
  if (constraint === "harness_client_id_key") {
    throw new BindingConflictError("clientId", clientId);
  }
  throw error;
}

async function bindHarnessClient(
  ctx: HarnessServiceContext,
  id: string,
  revision: number,
  binding: HarnessClientBinding,
  requestActor?: string,
): Promise<{ id: string; revision: number }> {
  const clientId = ensureClientId(binding?.clientId);
  const token = ensureClientToken(binding?.token);
  const now = ctx.clock.now();
  try {
    return await applyRevisioned(ctx, id, revision, (tx) =>
      ctx.store.bindClient({
        tx,
        id,
        revision,
        clientId,
        token,
        now,
        actor: requestActor ?? ctx.actor,
      }),
    );
  } catch (error) {
    return throwClientConflict(error, clientId);
  }
}

async function unbindHarnessClient(
  ctx: HarnessServiceContext,
  id: string,
  revision: number,
  requestActor?: string,
): Promise<{ id: string; revision: number }> {
  const now = ctx.clock.now();
  return applyRevisioned(ctx, id, revision, (tx) =>
    ctx.store.unbindClient({
      tx,
      id,
      revision,
      now,
      actor: requestActor ?? ctx.actor,
    }),
  );
}

async function deleteHarness(
  ctx: HarnessServiceContext,
  id: string,
  revision: number,
): Promise<void> {
  const current = await ctx.store.findRoot(ctx.db, id);
  if (current === null) throw new NotFoundError("Harness", id);
  if (current.revision !== revision) throw new RevisionConflictError(current.revision);

  const references = await ctx.guard.check("harness", id);
  if (references.length > 0) {
    throw new ReferencedError({ type: "harness", id, name: current.name }, references);
  }
  try {
    await ctx.db.transaction(async (tx) => {
      const changed = await ctx.store.deleteRoot(tx, id, revision);
      if (changed === 0) {
        const latest = await ctx.store.findRoot(tx, id);
        if (latest === null) throw new NotFoundError("Harness", id);
        throw new RevisionConflictError(latest.revision);
      }
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      const latestReferences = await ctx.guard.check("harness", id);
      throw new ReferencedError(
        { type: "harness", id, name: current.name },
        latestReferences,
      );
    }
    throw error;
  }
}

export function createHarnessService(deps: HarnessDeps): HarnessService {
  const ctx: HarnessServiceContext = { ...deps, store: createHarnessStore() };

  return {
    create: (input, requestActor) => createHarness(ctx, input, requestActor),
    update: (id, revision, input, requestActor) =>
      updateHarness(ctx, id, revision, input, requestActor),
    setEnabled: (id, revision, enabled, requestActor) =>
      setHarnessEnabled(ctx, id, revision, enabled, requestActor),
    bindClient: (id, revision, binding, requestActor) =>
      bindHarnessClient(ctx, id, revision, binding, requestActor),
    unbindClient: (id, revision, requestActor) =>
      unbindHarnessClient(ctx, id, revision, requestActor),
    delete: (id, revision) => deleteHarness(ctx, id, revision),
  };
}

export function createHarnessRead(deps: { db: Db }): HarnessRead {
  const { db } = deps;
  const store = createHarnessStore();

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

    async getByClientId(clientId): Promise<HarnessSummary | null> {
      const row = await store.findByClientId(db, clientId);
      if (row === null) return null;
      const tags = await store.tagsFor(db, row.id);
      return toSummary(row, tags);
    },
  };
}

/** 节点目录端口实现；组合根注入 scheduler。 */
export function createHarnessNodeDirectory(deps: { db: Db }): NodeDirectory {
  const store = createHarnessStore();
  return {
    isDispatchable: (clientId) => store.isDispatchable(deps.db, clientId),
    listClientIds: () => store.listDispatchableClientIds(deps.db),
  };
}

/** 执行面凭据解析；组合根注入执行端端点。 */
export function createHarnessAuthenticator(deps: { db: Db }): ExecutorAuthenticator {
  const store = createHarnessStore();
  return {
    resolveClientId: (token) => store.findClientIdByToken(deps.db, token),
  };
}
