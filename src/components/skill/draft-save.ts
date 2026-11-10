import {
  NameConflictError,
  NotFoundError,
  PreconditionRequiredError,
  RevisionConflictError,
  ValidationError,
  toIso,
} from "../../core/kernel/index.ts";
import { isUniqueViolation, type Db } from "../../core/platform/index.ts";
import { SKILL_MD, buildSkillPackage } from "./package.ts";
import { sha256Hex } from "./digest.ts";
import type { SaveSkill, SaveSkillResult } from "./contract.ts";
import {
  draftPrefix,
  listFiles,
  nextVersion,
  normalizeSave,
  readData,
  removeDraftTree,
  type CurrentSkill,
  type DraftRow,
  type SkillDraftDeps,
} from "./draft-types.ts";
import { assertNotExpired, findDraft } from "./draft-drafts.ts";

type Proposed = ReturnType<typeof normalizeSave>;

type AppliedSave = {
  id: string;
  revision: number;
  version: string;
  updatedAt: string;
  created: boolean;
  oldPackageKey: string | null;
};

export async function saveDraft(
  deps: SkillDraftDeps,
  id: string,
  baseRevision: number | null,
  input: SaveSkill,
  requestActor?: string | null,
): Promise<SaveSkillResult> {
  const proposed = normalizeSave(input);
  const draft = await findDraft(deps, id);
  if (draft === null) throw new NotFoundError("SkillDraft", id);
  assertNotExpired(draft, deps);

  const version = await prepareSave(deps, draft, proposed, baseRevision);
  const attachments = await collectAttachments(deps, id);
  const packageBytes = buildSkillPackage({
    name: proposed.name,
    description: proposed.description,
    version,
    body: proposed.body,
    files: attachments,
  });
  const packageDigest = sha256Hex(packageBytes);
  const packageSize = packageBytes.byteLength;
  const packageKey = `${deps.ids.next()}.zip`;
  await deps.store.put(`packages/${packageKey}`, packageBytes);
  const actorValue = requestActor ?? deps.actor;

  try {
    const result = await deps.db.transaction((tx) =>
      applySave(deps, tx, {
        id,
        proposed,
        packageKey,
        packageDigest,
        packageSize,
        version,
        baseRevision,
        actorValue,
      }),
    );
    await removeDraftTree(deps.store, id).catch(() => undefined);
    if (result.oldPackageKey !== null) {
      await deps.store.delete(`packages/${result.oldPackageKey}`).catch(() => undefined);
    }
    return {
      id: result.id,
      revision: result.revision,
      version: result.version,
      updatedAt: result.updatedAt,
      created: result.created,
    };
  } catch (error) {
    await deps.store.delete(`packages/${packageKey}`).catch(() => undefined);
    if (isUniqueViolation(error)) throw new NameConflictError(proposed.name);
    throw error;
  }
}

async function prepareSave(
  deps: SkillDraftDeps,
  draft: DraftRow,
  proposed: Proposed,
  baseRevision: number | null,
): Promise<string> {
  let version = "v1.0";
  if (draft.skill_id === null) {
    if (baseRevision !== null) {
      throw new ValidationError("If-Match", "新建草稿不能带 If-Match");
    }
  } else {
    if (baseRevision === null) throw new PreconditionRequiredError();
    const current = await deps.db.one<CurrentSkill>(
      "select id, name, package_key, version, revision from skill where id = $1",
      [draft.skill_id],
    );
    if (current === null) throw new NotFoundError("Skill", draft.skill_id);
    if (baseRevision !== current.revision || draft.base_revision !== current.revision) {
      throw new RevisionConflictError(current.revision);
    }
    version = nextVersion(current.version);
  }

  const category = await deps.db.one<{ code: string }>(
    "select code from skill_category where code = $1",
    [proposed.categoryCode],
  );
  if (category === null) throw new ValidationError("categoryCode", "分类不存在");
  return version;
}

async function collectAttachments(
  deps: SkillDraftDeps,
  id: string,
): Promise<{ path: string; data: Uint8Array }[]> {
  const attachments: { path: string; data: Uint8Array }[] = [];
  for (const file of await deps.store.list(draftPrefix(id))) {
    const path = file.key.slice(draftPrefix(id).length + 1);
    if (path === SKILL_MD) continue;
    attachments.push({ path, data: await readData(await deps.store.get(file.key)) });
  }
  return attachments;
}

type ApplyArgs = {
  id: string;
  proposed: Proposed;
  packageKey: string;
  packageDigest: string;
  packageSize: number;
  version: string;
  baseRevision: number | null;
  actorValue: string;
};

async function requireDraft(deps: SkillDraftDeps, tx: Db, id: string): Promise<DraftRow> {
  const draft = await tx.one<DraftRow>(
    `select id, skill_id, base_revision, base_version, expires_at, created_at
     from skill_draft where id = $1 for update`,
    [id],
  );
  if (draft === null) throw new NotFoundError("SkillDraft", id);
  assertNotExpired(draft, deps);
  return draft;
}

async function applyCreatedSave(
  deps: SkillDraftDeps,
  tx: Db,
  args: ApplyArgs,
  now: Date,
): Promise<{ skillId: string; revision: number; created: boolean }> {
  const skillId = deps.ids.next();
  await insertSkill(tx, {
    skillId,
    proposed: args.proposed,
    packageKey: args.packageKey,
    packageDigest: args.packageDigest,
    packageSize: args.packageSize,
    version: args.version,
    now,
    actorValue: args.actorValue,
  });
  return { skillId, revision: 1, created: true };
}

async function applyUpdatedSave(
  tx: Db,
  args: ApplyArgs,
  skillId: string,
  now: Date,
): Promise<{ revision: number; created: boolean; oldPackageKey: string }> {
  const latest = await tx.one<CurrentSkill>(
    "select id, name, package_key, version, revision from skill where id = $1 for update",
    [skillId],
  );
  if (latest === null) throw new NotFoundError("Skill", skillId);
  if (args.baseRevision !== latest.revision) {
    throw new RevisionConflictError(latest.revision);
  }
  await updateSkill(tx, {
    skillId,
    latestRevision: latest.revision,
    proposed: args.proposed,
    packageKey: args.packageKey,
    packageDigest: args.packageDigest,
    packageSize: args.packageSize,
    version: args.version,
    now,
    actorValue: args.actorValue,
  });
  return { revision: latest.revision + 1, created: false, oldPackageKey: latest.package_key };
}

async function applySave(deps: SkillDraftDeps, tx: Db, args: ApplyArgs): Promise<AppliedSave> {
  const lockedDraft = await requireDraft(deps, tx, args.id);
  const categoryRow = await tx.one<{ code: string }>(
    "select code from skill_category where code = $1",
    [args.proposed.categoryCode],
  );
  if (categoryRow === null) throw new ValidationError("categoryCode", "分类不存在");

  const now = deps.clock.now();
  const draftSkillId = lockedDraft.skill_id;
  let applied: { skillId: string; revision: number; created: boolean; oldPackageKey: string | null };
  if (draftSkillId === null) {
    const created = await applyCreatedSave(deps, tx, args, now);
    applied = { ...created, oldPackageKey: null };
  } else {
    const updated = await applyUpdatedSave(tx, args, draftSkillId, now);
    applied = { skillId: draftSkillId, ...updated };
  }

  await replaceTags(tx, applied.skillId, args.proposed.tags);
  await tx.query("delete from skill_draft where id = $1", [args.id]);
  return {
    id: applied.skillId,
    revision: applied.revision,
    version: args.version,
    updatedAt: toIso(now),
    created: applied.created,
    oldPackageKey: applied.oldPackageKey,
  };
}

async function insertSkill(
  tx: Db,
  args: {
    skillId: string;
    proposed: Proposed;
    packageKey: string;
    packageDigest: string;
    packageSize: number;
    version: string;
    now: Date;
    actorValue: string;
  },
): Promise<void> {
  await tx.query(
    `insert into skill
      (id, name, category_code, description, package_key, package_digest, package_size,
       version, enabled, revision, created_at, updated_at, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, true, 1, $9, $9, $10, $10)`,
    [
      args.skillId,
      args.proposed.name,
      args.proposed.categoryCode,
      args.proposed.description,
      args.packageKey,
      args.packageDigest,
      args.packageSize,
      args.version,
      args.now,
      args.actorValue,
    ],
  );
}

async function updateSkill(
  tx: Db,
  args: {
    skillId: string;
    latestRevision: number;
    proposed: Proposed;
    packageKey: string;
    packageDigest: string;
    packageSize: number;
    version: string;
    now: Date;
    actorValue: string;
  },
): Promise<void> {
  const changed = await tx.query<{ id: string }>(
    `update skill set
       name = $1, category_code = $2, description = $3,
       package_key = $4, package_digest = $5, package_size = $6,
       version = $7, revision = revision + 1,
       updated_at = $8, updated_by = $9
     where id = $10 and revision = $11
     returning id`,
    [
      args.proposed.name,
      args.proposed.categoryCode,
      args.proposed.description,
      args.packageKey,
      args.packageDigest,
      args.packageSize,
      args.version,
      args.now,
      args.actorValue,
      args.skillId,
      args.latestRevision,
    ],
  );
  if (changed.length === 0) throw new RevisionConflictError(args.latestRevision);
}

async function replaceTags(tx: Db, skillId: string, tags: string[]): Promise<void> {
  await tx.query("delete from skill_tag where skill_id = $1", [skillId]);
  for (const [position, tag] of tags.entries()) {
    await tx.query(
      "insert into skill_tag (skill_id, position, tag) values ($1, $2, $3)",
      [skillId, position, tag],
    );
  }
}
