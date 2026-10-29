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
  createExpertStore,
  type ExpertRootRow,
  type ExpertRootWrite,
} from "./store.ts";
import type {
  CreateExpert,
  ExpertDetail,
  ExpertQuery,
  ExpertRead,
  ExpertReference,
  ExpertRefInput,
  ExpertService,
  ExpertSummary,
  UpdateExpert,
  UpdateExpertAggregate,
} from "./types.ts";

export class SkillNotFoundError extends ValidationError {
  constructor(skillId: string, field = "items") {
    super(field, `Skill ${skillId} 不存在`);
  }
}

export class ToolNotFoundError extends ValidationError {
  constructor(toolId: string, field = "items") {
    super(field, `工具 ${toolId} 不存在`);
  }
}

export type ExpertDeps = {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  actor: string;
  guard?: ReferenceGuard;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSummary(row: ExpertRootRow, persona: string[], skillIds: string[]): ExpertSummary {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    role: row.role,
    enabled: row.enabled,
    persona,
    duty: row.duty,
    skillOrder: row.skill_order,
    verifyOrder: row.verify_order,
    notes: row.notes,
    skillCount: row.skill_count,
    toolCount: row.tool_count,
    refCount: 0,
    skillIds,
    revision: row.revision,
    updatedAt: toIso(row.updated_at),
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

function ensureOptionalText(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  return value;
}

function ensureStringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError(field, "必须是字符串数组");
  return value.map((item) => {
    if (typeof item !== "string") throw new ValidationError(field, "必须是字符串数组");
    const trimmed = item.trim();
    if (trimmed.length === 0) throw new ValidationError(field, "元素不能为空");
    return trimmed;
  });
}

function ensureRefs(
  value: unknown,
): { label: string; refType: string; path: string | null }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError("refs", "必须是数组");
  return value.map((item, index) => {
    if (item === null || typeof item !== "object") {
      throw new ValidationError("refs", "每个引用必须是对象");
    }
    const input = item as Record<string, unknown>;
    const label = ensureText(input.label, `refs.${index}.label`, 200);
    const refType = ensureText(input.refType, `refs.${index}.refType`, 100);
    let path: string | null = null;
    if (input.path !== undefined && input.path !== null) {
      if (typeof input.path !== "string") {
        throw new ValidationError(`refs.${index}.path`, "必须是字符串或 null");
      }
      path = input.path;
    }
    return { label, refType, path };
  });
}

type NormalizedWrite = {
  name: string;
  color: string;
  role: string;
  duty: string;
  skillOrder: string;
  verifyOrder: string;
  notes: string;
  persona: string[];
  refs: { label: string; refType: string; path: string | null }[];
};

function normalizeWrite(input: CreateExpert): NormalizedWrite {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  const name = ensureText(input.name, "name", 80);
  if (typeof input.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
    throw new ValidationError("color", "必须是 #RRGGBB 格式");
  }
  const role = ensureText(input.role, "role", 200);
  const duty = ensureOptionalText(input.duty, "duty");
  const skillOrder = ensureOptionalText(input.skillOrder, "skillOrder");
  const verifyOrder = ensureOptionalText(input.verifyOrder, "verifyOrder");
  const notes = ensureOptionalText(input.notes, "notes");
  const persona = ensureStringList(input.persona, "persona");
  const refs = ensureRefs(input.refs);
  return {
    name,
    color: input.color,
    role,
    duty,
    skillOrder,
    verifyOrder,
    notes,
    persona,
    refs,
  };
}

function enabledFrom(input: CreateExpert): boolean {
  if (input.enabled === undefined) return true;
  if (typeof input.enabled !== "boolean") {
    throw new ValidationError("enabled", "必须是布尔值");
  }
  return input.enabled;
}

type NormalizedPatch = {
  name?: string;
  color?: string;
  role?: string;
  duty?: string;
  skillOrder?: string;
  verifyOrder?: string;
  notes?: string;
  persona?: string[];
  refs?: { label: string; refType: string; path: string | null }[];
  skillIds?: string[];
  toolIds?: string[];
};

function normalizePatch(input: UpdateExpertAggregate): NormalizedPatch {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  const patch: NormalizedPatch = {};
  if (input.name !== undefined) patch.name = ensureText(input.name, "name", 80);
  if (input.color !== undefined) {
    if (typeof input.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
      throw new ValidationError("color", "必须是 #RRGGBB 格式");
    }
    patch.color = input.color;
  }
  if (input.role !== undefined) patch.role = ensureText(input.role, "role", 200);
  if (input.duty !== undefined) patch.duty = ensureOptionalText(input.duty, "duty");
  if (input.skillOrder !== undefined) {
    patch.skillOrder = ensureOptionalText(input.skillOrder, "skillOrder");
  }
  if (input.verifyOrder !== undefined) {
    patch.verifyOrder = ensureOptionalText(input.verifyOrder, "verifyOrder");
  }
  if (input.notes !== undefined) patch.notes = ensureOptionalText(input.notes, "notes");
  if (input.persona !== undefined) patch.persona = ensureStringList(input.persona, "persona");
  if (input.refs !== undefined) patch.refs = ensureRefs(input.refs);
  if (input.skillIds !== undefined) patch.skillIds = normalizeIds(input.skillIds, "skillIds");
  if (input.toolIds !== undefined) patch.toolIds = normalizeIds(input.toolIds, "toolIds");
  if (Object.keys(patch).length === 0) {
    throw new ValidationError("body", "至少提供一个字段");
  }
  return patch;
}

function normalizeIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new ValidationError(field, "必须是字符串数组");
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new ValidationError(field, "必须是字符串数组");
    }
    const id = item.trim();
    if (seen.has(id)) throw new ValidationError(field, `目标 ${id} 重复`);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function createExpertService(deps: ExpertDeps): ExpertService {
  const { db, clock, ids, actor, guard } = deps;
  const store = createExpertStore(db);

  async function replaceSkills(
    tx: Db,
    expertId: string,
    skillIds: string[],
    field = "items",
  ): Promise<void> {
    await store.clearSkillLinks(tx, expertId);
    for (const [position, skillId] of skillIds.entries()) {
      try {
        await store.insertSkillLink(tx, expertId, skillId, position);
      } catch (error) {
        if (isForeignKeyViolation(error)) throw new SkillNotFoundError(skillId, field);
        throw error;
      }
    }
  }

  async function replaceTools(
    tx: Db,
    expertId: string,
    toolIds: string[],
    field = "items",
  ): Promise<void> {
    await store.clearToolLinks(tx, expertId);
    for (const [position, toolId] of toolIds.entries()) {
      try {
        await store.insertToolLink(tx, expertId, toolId, position);
      } catch (error) {
        if (isForeignKeyViolation(error)) throw new ToolNotFoundError(toolId, field);
        throw error;
      }
    }
  }

  return {
    async create(input, requestActor) {
      const normalized = normalizeWrite(input);
      const enabled = enabledFrom(input);
      const skillIds = input.skillIds === undefined ? [] : normalizeIds(input.skillIds, "skillIds");
      const toolIds = input.toolIds === undefined ? [] : normalizeIds(input.toolIds, "toolIds");
      const id = ids.next();
      const now = clock.now();
      const actorValue = requestActor ?? actor;
      try {
        await db.transaction(async (tx) => {
          const write: ExpertRootWrite = {
            id,
            name: normalized.name,
            color: normalized.color,
            role: normalized.role,
            enabled,
            duty: normalized.duty,
            skillOrder: normalized.skillOrder,
            verifyOrder: normalized.verifyOrder,
            notes: normalized.notes,
            now,
            actor: actorValue,
          };
          await store.insertRoot(tx, write);
          await store.replacePersona(tx, id, normalized.persona);
          await store.replaceRefs(tx, id, normalized.refs);
          await replaceSkills(tx, id, skillIds, "skillIds");
          await replaceTools(tx, id, toolIds, "toolIds");
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
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
          if (current === null) throw new NotFoundError("专家", id);
          if (current.revision !== revision) {
            throw new RevisionConflictError(current.revision);
          }
          const changed = await store.updateRoot(tx, {
            id,
            name: normalized.name,
            color: normalized.color,
            role: normalized.role,
            duty: normalized.duty,
            skillOrder: normalized.skillOrder,
            verifyOrder: normalized.verifyOrder,
            notes: normalized.notes,
            revision,
            now,
            actor: actorValue,
          });
          if (changed === 0) {
            const latest = await store.findRoot(tx, id);
            throw new RevisionConflictError(latest?.revision ?? revision);
          }
          await store.replacePersona(tx, id, normalized.persona);
          await store.replaceRefs(tx, id, normalized.refs);
          return { id, revision: revision + 1 };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
        throw error;
      }
    },

    async updateAggregate(id, revision, input, requestActor) {
      const patch = normalizePatch(input);
      const now = clock.now();
      const actorValue = requestActor ?? actor;
      try {
        return await db.transaction(async (tx) => {
          const current = await store.findRoot(tx, id, true);
          if (current === null) throw new NotFoundError("专家", id);
          if (current.revision !== revision) {
            throw new RevisionConflictError(current.revision);
          }
          const changed = await store.updateRoot(tx, {
            id,
            name: patch.name ?? current.name,
            color: patch.color ?? current.color,
            role: patch.role ?? current.role,
            duty: patch.duty ?? current.duty,
            skillOrder: patch.skillOrder ?? current.skill_order,
            verifyOrder: patch.verifyOrder ?? current.verify_order,
            notes: patch.notes ?? current.notes,
            revision,
            now,
            actor: actorValue,
          });
          if (changed === 0) {
            const latest = await store.findRoot(tx, id);
            throw new RevisionConflictError(latest?.revision ?? revision);
          }
          if (patch.persona !== undefined) {
            await store.replacePersona(tx, id, patch.persona);
          }
          if (patch.refs !== undefined) {
            await store.replaceRefs(tx, id, patch.refs);
          }
          if (patch.skillIds !== undefined) {
            await replaceSkills(tx, id, patch.skillIds, "skillIds");
          }
          if (patch.toolIds !== undefined) {
            await replaceTools(tx, id, patch.toolIds, "toolIds");
          }
          return { id, revision: revision + 1 };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new NameConflictError(patch.name ?? "");
        }
        throw error;
      }
    },

    async setEnabled(id, revision, enabled, requestActor) {
      if (typeof enabled !== "boolean") {
        throw new ValidationError("enabled", "必须是布尔值");
      }
      const now = clock.now();
      return db.transaction(async (tx) => {
        const changed = await store.setEnabled(
          tx,
          id,
          revision,
          enabled,
          now,
          requestActor ?? actor,
        );
        if (changed === 0) {
          const latest = await store.findRoot(tx, id);
          if (latest === null) throw new NotFoundError("专家", id);
          throw new RevisionConflictError(latest.revision);
        }
        return { id, revision: revision + 1 };
      });
    },

    async delete(id, revision) {
      const current = await store.findRoot(db, id);
      if (current === null) throw new NotFoundError("专家", id);
      if (guard !== undefined) {
        const references = await guard.check("expert", id);
        if (references.length > 0) {
          throw new ReferencedError({ type: "expert", id, name: current.name }, references);
        }
      }
      try {
        await db.transaction(async (tx) => {
          const locked = await store.findRoot(tx, id, true);
          if (locked === null) throw new NotFoundError("专家", id);
          if (locked.revision !== revision) {
            throw new RevisionConflictError(locked.revision);
          }
          await store.deleteRoot(tx, id, revision);
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new ReferencedError({ type: "expert", id, name: current.name }, []);
        }
        throw error;
      }
    },

    async setSkills(id, revision, skillIds, requestActor) {
      const normalizedIds = normalizeIds(skillIds, "items");
      const now = clock.now();
      const actorValue = requestActor ?? actor;
      return db.transaction(async (tx) => {
        const current = await store.findRoot(tx, id, true);
        if (current === null) throw new NotFoundError("专家", id);
        if (current.revision !== revision) {
          throw new RevisionConflictError(current.revision);
        }
        await replaceSkills(tx, id, normalizedIds);
        const next = await store.bumpRevision(tx, id, revision, now, actorValue);
        if (next === null) throw new RevisionConflictError(revision);
        return { revision: next };
      });
    },

    async setTools(id, revision, toolIds, requestActor) {
      const normalizedIds = normalizeIds(toolIds, "items");
      const now = clock.now();
      const actorValue = requestActor ?? actor;
      return db.transaction(async (tx) => {
        const current = await store.findRoot(tx, id, true);
        if (current === null) throw new NotFoundError("专家", id);
        if (current.revision !== revision) {
          throw new RevisionConflictError(current.revision);
        }
        await replaceTools(tx, id, normalizedIds);
        const next = await store.bumpRevision(tx, id, revision, now, actorValue);
        if (next === null) throw new RevisionConflictError(revision);
        return { revision: next };
      });
    },
  };
}

export function createExpertRead(deps: { db: Db }): ExpertRead {
  const { db } = deps;
  const store = createExpertStore(db);

  return {
    async list(query: ExpertQuery): Promise<Page<ExpertSummary>> {
      const { rows, total } = await store.listRoots(db, query);
      const items: ExpertSummary[] = [];
      for (const row of rows) {
        const [persona, skillIds] = await Promise.all([
          store.personaFor(db, row.id),
          store.skillIdsFor(db, row.id),
        ]);
        items.push(toSummary(row, persona, skillIds));
      }
      return { items, total, limit: query.page.limit, offset: query.page.offset };
    },

    async get(id): Promise<ExpertDetail> {
      const [row, persona, refs, skillIds, toolIds] = await Promise.all([
        store.findRoot(db, id),
        store.personaFor(db, id),
        store.refsFor(db, id),
        store.skillIdsFor(db, id),
        store.toolIdsFor(db, id),
      ]);
      if (row === null) throw new NotFoundError("专家", id);
      const refsInput: ExpertRefInput[] = refs.map((ref) => ({
        label: ref.label,
        refType: ref.ref_type,
        path: ref.path ?? undefined,
      }));
      return {
        ...toSummary(row, persona, skillIds),
        toolIds,
        refs: refsInput,
        createdAt: toIso(row.created_at),
      };
    },

    async listExpertsUsingSkill(skillId): Promise<ExpertReference[]> {
      return store.listUsingSkill(db, skillId);
    },

    async listExpertsUsingTool(toolId): Promise<ExpertReference[]> {
      return store.listUsingTool(db, toolId);
    },

    async statuses(expertIds): Promise<Record<string, boolean>> {
      return store.statuses(db, expertIds);
    },
  };
}
