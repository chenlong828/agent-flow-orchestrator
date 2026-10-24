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
import {
  isForeignKeyViolation,
  isUniqueViolation,
  type Db,
} from "../../core/platform/index.ts";
import {
  createToolStore,
  type ToolParamRow,
  type ToolRootRow,
  type ToolRootWrite,
} from "./store.ts";
import type {
  CreateTool,
  ToolDetail,
  ToolKind,
  ToolParam,
  ToolParamInput,
  ToolParamType,
  ToolQuery,
  ToolRead,
  ToolRef,
  ToolService,
  ToolStatus,
  ToolSummary,
} from "./types.ts";

/** harnessId 指向的 Harness 不存在；继承校验错误，映射为 400。 */
export class HarnessNotFoundError extends ValidationError {
  constructor(harnessId: string) {
    super("harnessId", `Harness ${harnessId} 不存在`);
  }
}

export type ToolDeps = {
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

function toParam(row: ToolParamRow): ToolParam {
  return {
    paramKey: row.param_key,
    type: row.param_type,
    description: row.description,
    position: row.position,
  };
}

function toSummary(row: ToolRootRow, params: ToolParamRow[]): ToolSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    invocation: row.invocation,
    description: row.description,
    harnessId: row.harness_id,
    timeoutMs: row.timeout_ms,
    status: row.status,
    lastDebugAt: toIsoOrNull(row.last_debug_at),
    params: params.map(toParam),
    revision: row.revision,
    updatedAt: toIso(row.updated_at),
  };
}

function toDetail(row: ToolRootRow, params: ToolParamRow[]): ToolDetail {
  return { ...toSummary(row, params), createdAt: toIso(row.created_at) };
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

function normalizeParams(value: unknown): ToolParamInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError("params", "必须是数组");
  const params: ToolParamInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (item === null || typeof item !== "object") {
      throw new ValidationError("params", "每个参数必须是对象");
    }
    const input = item as Record<string, unknown>;
    const paramKey = ensureText(input.paramKey, "params.paramKey", 80);
    if (seen.has(paramKey)) throw new ValidationError("params", `参数键 ${paramKey} 重复`);
    seen.add(paramKey);
    const type = ensureEnum(input.type, "params.type", ["string", "int"] as const);
    const description = ensureOptionalText(input.description, "params.description", 500);
    params.push({ paramKey, type, description });
  }
  return params;
}

type NormalizedWrite = {
  name: string;
  kind: ToolKind;
  invocation: string;
  description: string;
  harnessId: string;
  timeoutMs: number;
  params: ToolParamInput[];
};

function normalizeWrite(input: CreateTool): NormalizedWrite {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  const name = ensureText(input.name, "name", 80);
  const kind = ensureEnum(input.kind, "kind", ["mcp", "cli", "script"] as const);
  const invocation = ensureText(input.invocation, "invocation", 500);
  const description = ensureOptionalText(input.description, "description", 500);
  const harnessId = ensureText(input.harnessId, "harnessId", 64);
  if (
    typeof input.timeoutMs !== "number" ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 1000 ||
    input.timeoutMs > 600000
  ) {
    throw new ValidationError("timeoutMs", "必须是 1000 到 600000 之间的整数");
  }
  const params = normalizeParams(input.params);
  return { name, kind, invocation, description, harnessId, timeoutMs: input.timeoutMs, params };
}

function paramsToRows(toolId: string, params: ToolParamInput[]): ToolParamRow[] {
  return params.map((param, position) => ({
    tool_id: toolId,
    position,
    param_key: param.paramKey,
    param_type: param.type,
    description: param.description ?? "",
  }));
}

export function createToolService(deps: ToolDeps): ToolService {
  const { db, clock, ids, guard, actor } = deps;
  const store = createToolStore(db);

  return {
    async create(input, requestActor) {
      const normalized = normalizeWrite(input);
      const id = ids.next();
      const now = clock.now();
      const actorValue = requestActor ?? actor;
      try {
        await db.transaction(async (tx) => {
          const write: ToolRootWrite = {
            id,
            name: normalized.name,
            kind: normalized.kind,
            invocation: normalized.invocation,
            description: normalized.description,
            harnessId: normalized.harnessId,
            timeoutMs: normalized.timeoutMs,
            now,
            actor: actorValue,
          };
          await store.insertRoot(tx, write);
          await store.replaceParams(tx, id, paramsToRows(id, normalized.params));
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
        if (isForeignKeyViolation(error)) throw new HarnessNotFoundError(normalized.harnessId);
        throw error;
      }
      return { id, revision: 1 };
    },

    async update(id, revision, input, requestActor) {
      const normalized = normalizeWrite(input);
      const now = clock.now();
      const actorValue = requestActor ?? actor;
      try {
        return await db.transaction(async (tx) => {
          const current = await store.findRoot(tx, id, true);
          if (current === null) throw new NotFoundError("工具", id);
          if (current.revision !== revision) {
            throw new RevisionConflictError(current.revision);
          }
          const changed = await store.updateRoot(tx, {
            id,
            name: normalized.name,
            kind: normalized.kind,
            invocation: normalized.invocation,
            description: normalized.description,
            harnessId: normalized.harnessId,
            timeoutMs: normalized.timeoutMs,
            revision,
            now,
            actor: actorValue,
          });
          if (changed === 0) {
            const latest = await store.findRoot(tx, id);
            throw new RevisionConflictError(latest?.revision ?? revision);
          }
          await store.replaceParams(tx, id, paramsToRows(id, normalized.params));
          return { id, revision: revision + 1 };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
        if (isForeignKeyViolation(error)) throw new HarnessNotFoundError(normalized.harnessId);
        throw error;
      }
    },

    async delete(id, revision) {
      const current = await store.findRoot(db, id);
      if (current === null) throw new NotFoundError("工具", id);
      if (current.revision !== revision) throw new RevisionConflictError(current.revision);

      const references = await guard.check("tool", id);
      if (references.length > 0) {
        throw new ReferencedError({ type: "tool", id, name: current.name }, references);
      }
      try {
        await db.transaction(async (tx) => {
          const changed = await store.deleteRoot(tx, id, revision);
          if (changed === 0) {
            const latest = await store.findRoot(tx, id);
            if (latest === null) throw new NotFoundError("工具", id);
            throw new RevisionConflictError(latest.revision);
          }
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          const latestReferences = await guard.check("tool", id);
          throw new ReferencedError(
            { type: "tool", id, name: current.name },
            latestReferences,
          );
        }
        throw error;
      }
    },
  };
}

export function createToolRead(deps: { db: Db }): ToolRead {
  const { db } = deps;
  const store = createToolStore(db);

  async function summaryFor(row: ToolRootRow): Promise<ToolSummary> {
    const params = await store.paramsFor(db, row.id);
    return toSummary(row, params);
  }

  return {
    async list(query): Promise<Page<ToolSummary>> {
      const { rows, total } = await store.listRoots(db, query);
      const items: ToolSummary[] = [];
      for (const row of rows) items.push(await summaryFor(row));
      return { items, total, limit: query.page.limit, offset: query.page.offset };
    },

    async get(id): Promise<ToolDetail> {
      const row = await store.findRoot(db, id);
      if (row === null) throw new NotFoundError("工具", id);
      const params = await store.paramsFor(db, id);
      return toDetail(row, params);
    },

    async getSummary(id): Promise<ToolSummary> {
      const row = await store.findRoot(db, id);
      if (row === null) throw new NotFoundError("工具", id);
      return summaryFor(row);
    },

    async listByHarness(harnessId): Promise<ToolRef[]> {
      const rows = await store.listByHarness(db, harnessId);
      return rows.map((row) => ({ id: row.id, name: row.name }));
    },
  };
}

export type { ToolKind, ToolParamType, ToolStatus };
