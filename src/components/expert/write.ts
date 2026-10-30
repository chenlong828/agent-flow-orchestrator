import {
  ensureBoolean,
  NameConflictError,
  NotFoundError,
  ReferencedError,
  RevisionConflictError,
  ValidationError,
} from "../../core/kernel/index.ts";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  type Db,
} from "../../core/platform/index.ts";
import { SkillNotFoundError } from "./skill-not-found-error.ts";
import { ToolNotFoundError } from "./tool-not-found-error.ts";
import {
  enabledFrom,
  normalizeIds,
  normalizePatch,
  normalizeWrite,
  type NormalizedPatch,
  type NormalizedWrite,
} from "./normalize.ts";
import type {
  ExpertRootRow,
  ExpertRootWrite,
  ExpertStore,
} from "./store.ts";
import type {
  CreateExpert,
  ExpertDeps,
  UpdateExpert,
  UpdateExpertAggregate,
} from "./types.ts";

export type ExpertServiceContext = ExpertDeps & { store: ExpertStore };

type RootValues = {
  name: string;
  color: string;
  role: string;
  duty: string;
  skillOrder: string;
  verifyOrder: string;
  notes: string;
};

type RootUpdate = {
  id: string;
  revision: number;
  now: Date;
  actor: string | null;
  values: (current: ExpertRootRow) => RootValues;
};

function valuesFromWrite(write: NormalizedWrite): RootValues {
  return {
    name: write.name,
    color: write.color,
    role: write.role,
    duty: write.duty,
    skillOrder: write.skillOrder,
    verifyOrder: write.verifyOrder,
    notes: write.notes,
  };
}

function valuesFromPatch(current: ExpertRootRow, patch: NormalizedPatch): RootValues {
  return {
    name: patch.name ?? current.name,
    color: patch.color ?? current.color,
    role: patch.role ?? current.role,
    duty: patch.duty ?? current.duty,
    skillOrder: patch.skillOrder ?? current.skill_order,
    verifyOrder: patch.verifyOrder ?? current.verify_order,
    notes: patch.notes ?? current.notes,
  };
}

async function updateRootLocked(
  store: ExpertStore,
  tx: Db,
  input: RootUpdate,
): Promise<void> {
  const current = await store.findRoot(tx, input.id, true);
  if (current === null) throw new NotFoundError("专家", input.id);
  if (current.revision !== input.revision) {
    throw new RevisionConflictError(current.revision);
  }
  const changed = await store.updateRoot(tx, {
    id: input.id,
    ...input.values(current),
    revision: input.revision,
    now: input.now,
    actor: input.actor,
  });
  if (changed === 0) {
    const latest = await store.findRoot(tx, input.id);
    throw new RevisionConflictError(latest?.revision ?? input.revision);
  }
}

async function replaceSkills(
  store: ExpertStore,
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
  store: ExpertStore,
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

async function applyPatchLinks(
  store: ExpertStore,
  tx: Db,
  id: string,
  patch: NormalizedPatch,
): Promise<void> {
  if (patch.persona !== undefined) {
    await store.replacePersona(tx, id, patch.persona);
  }
  if (patch.refs !== undefined) {
    await store.replaceRefs(tx, id, patch.refs);
  }
  if (patch.skillIds !== undefined) {
    await replaceSkills(store, tx, id, patch.skillIds, "skillIds");
  }
  if (patch.toolIds !== undefined) {
    await replaceTools(store, tx, id, patch.toolIds, "toolIds");
  }
}

export async function createExpert(
  ctx: ExpertServiceContext,
  input: CreateExpert,
  requestActor?: string,
): Promise<{ id: string; revision: number }> {
  const normalized = normalizeWrite(input);
  const enabled = enabledFrom(input);
  const skillIds = input.skillIds === undefined ? [] : normalizeIds(input.skillIds, "skillIds");
  const toolIds = input.toolIds === undefined ? [] : normalizeIds(input.toolIds, "toolIds");
  const id = ctx.ids.next();
  const now = ctx.clock.now();
  const actorValue = requestActor ?? ctx.actor;
  try {
    await ctx.db.transaction(async (tx) => {
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
      await ctx.store.insertRoot(tx, write);
      await ctx.store.replacePersona(tx, id, normalized.persona);
      await ctx.store.replaceRefs(tx, id, normalized.refs);
      await replaceSkills(ctx.store, tx, id, skillIds, "skillIds");
      await replaceTools(ctx.store, tx, id, toolIds, "toolIds");
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
    throw error;
  }
  return { id, revision: 1 };
}

export async function updateExpert(
  ctx: ExpertServiceContext,
  id: string,
  revision: number,
  input: UpdateExpert,
  requestActor?: string,
): Promise<{ id: string; revision: number }> {
  const normalized = normalizeWrite(input);
  const now = ctx.clock.now();
  const actorValue = requestActor ?? ctx.actor;
  try {
    return await ctx.db.transaction(async (tx) => {
      await updateRootLocked(ctx.store, tx, {
        id,
        revision,
        now,
        actor: actorValue,
        values: () => valuesFromWrite(normalized),
      });
      await ctx.store.replacePersona(tx, id, normalized.persona);
      await ctx.store.replaceRefs(tx, id, normalized.refs);
      return { id, revision: revision + 1 };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
    throw error;
  }
}

export async function updateAggregateExpert(
  ctx: ExpertServiceContext,
  id: string,
  revision: number,
  input: UpdateExpertAggregate,
  requestActor?: string,
): Promise<{ id: string; revision: number }> {
  const patch = normalizePatch(input);
  const now = ctx.clock.now();
  const actorValue = requestActor ?? ctx.actor;
  try {
    return await ctx.db.transaction(async (tx) => {
      await updateRootLocked(ctx.store, tx, {
        id,
        revision,
        now,
        actor: actorValue,
        values: (current) => valuesFromPatch(current, patch),
      });
      await applyPatchLinks(ctx.store, tx, id, patch);
      return { id, revision: revision + 1 };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new NameConflictError(patch.name ?? "");
    }
    throw error;
  }
}

export async function setEnabledExpert(
  ctx: ExpertServiceContext,
  id: string,
  revision: number,
  enabled: boolean,
  requestActor?: string,
): Promise<{ id: string; revision: number }> {
  const enabledValue = ensureBoolean(enabled, "enabled");
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const changed = await ctx.store.setEnabled(tx, {
      id,
      revision,
      enabled: enabledValue,
      now,
      actor: requestActor ?? ctx.actor,
    });
    if (changed === 0) {
      const latest = await ctx.store.findRoot(tx, id);
      if (latest === null) throw new NotFoundError("专家", id);
      throw new RevisionConflictError(latest.revision);
    }
    return { id, revision: revision + 1 };
  });
}

export async function deleteExpert(
  ctx: ExpertServiceContext,
  id: string,
  revision: number,
): Promise<void> {
  const current = await ctx.store.findRoot(ctx.db, id);
  if (current === null) throw new NotFoundError("专家", id);
  const references = await ctx.guard.check("expert", id);
  if (references.length > 0) {
    throw new ReferencedError({ type: "expert", id, name: current.name }, references);
  }
  try {
    await ctx.db.transaction(async (tx) => {
      const locked = await ctx.store.findRoot(tx, id, true);
      if (locked === null) throw new NotFoundError("专家", id);
      if (locked.revision !== revision) {
        throw new RevisionConflictError(locked.revision);
      }
      await ctx.store.deleteRoot(tx, id, revision);
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ReferencedError({ type: "expert", id, name: current.name }, []);
    }
    throw error;
  }
}

async function setExpertLinks(
  ctx: ExpertServiceContext,
  id: string,
  revision: number,
  ids: string[],
  options: {
    requestActor: string | undefined;
    replace: (tx: Db, id: string, ids: string[]) => Promise<void>;
  },
): Promise<{ revision: number }> {
  const normalizedIds = normalizeIds(ids, "items");
  const now = ctx.clock.now();
  const actorValue = options.requestActor ?? ctx.actor;
  return ctx.db.transaction(async (tx) => {
    const current = await ctx.store.findRoot(tx, id, true);
    if (current === null) throw new NotFoundError("专家", id);
    if (current.revision !== revision) {
      throw new RevisionConflictError(current.revision);
    }
    await options.replace(tx, id, normalizedIds);
    const next = await ctx.store.bumpRevision(tx, id, revision, now, actorValue);
    if (next === null) throw new RevisionConflictError(revision);
    return { revision: next };
  });
}

export async function setExpertSkills(
  ctx: ExpertServiceContext,
  id: string,
  revision: number,
  skillIds: string[],
  requestActor?: string,
): Promise<{ revision: number }> {
  return setExpertLinks(ctx, id, revision, skillIds, {
    requestActor,
    replace: (tx, targetId, ids) => replaceSkills(ctx.store, tx, targetId, ids),
  });
}

export async function setExpertTools(
  ctx: ExpertServiceContext,
  id: string,
  revision: number,
  toolIds: string[],
  requestActor?: string,
): Promise<{ revision: number }> {
  return setExpertLinks(ctx, id, revision, toolIds, {
    requestActor,
    replace: (tx, targetId, ids) => replaceTools(ctx.store, tx, targetId, ids),
  });
}
