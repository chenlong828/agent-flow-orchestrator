import {
  NameConflictError,
  NotFoundError,
  PreconditionRequiredError,
  RevisionConflictError,
  ValidationError,
} from "../../core/kernel/index.ts";
import { isUniqueViolation, type Db } from "../../core/platform/index.ts";
import { SKILL_MD, buildSkillPackage } from "./package.ts";
import type { SaveSkill, SaveSkillResult } from "./contract.ts";
import {
  draftPrefix,
  listFiles,
  nextVersion,
  normalizeSave,
  readData,
  removeDraftTree,
  toIso,
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
  const packageKey = `${deps.ids.next()}.zip`;
  await deps.store.put(`packages/${packageKey}`, packageBytes);
  const actorValue = requestActor ?? deps.actor;

  try {
    const result = await deps.db.transaction((tx) =>
      applySave(deps, tx, {
        id,
        proposed,
        packageKey,
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

async function applySave(
  deps: SkillDraftDeps,
  tx: Db,
  args: {
    id: string;
    proposed: Proposed;
    packageKey: string;
    version: string;
    baseRevision: number | null;
    actorValue: string;
  },
): Promise<AppliedSave> {
  const lockedDraft = await tx.one<DraftRow>(
    `select id, skill_id, base_revision, base_version, expires_at, created_at
     from skill_draft where id = $1 for update`,
    [args.id],
  );
  if (lockedDraft === null) throw new NotFoundError("SkillDraft", args.id);
  assertNotExpired(lockedDraft, deps);

  const categoryRow = await tx.one<{ code: string }>(
    "select code from skill_category where code = $1",
    [args.proposed.categoryCode],
  );
  if (categoryRow === null) throw new ValidationError("categoryCode", "分类不存在");

  const now = deps.clock.now();
  const draftSkillId = lockedDraft.skill_id;
  const created = draftSkillId === null;
  let skillId: string;
  let revision: number;
  let oldPackageKey: string | null = null;
  if (created) {
    skillId = deps.ids.next();
    revision = 1;
    await insertSkill(tx, {
      skillId,
      proposed: args.proposed,
      packageKey: args.packageKey,
      version: args.version,
      now,
      actorValue: args.actorValue,
    });
  } else {
    const latest = await tx.one<CurrentSkill>(
      "select id, name, package_key, version, revision from skill where id = $1 for update",
      [draftSkillId],
    );
    if (latest === null) throw new NotFoundError("Skill", draftSkillId);
    if (args.baseRevision !== latest.revision) {
      throw new RevisionConflictError(latest.revision);
    }
    skillId = latest.id;
    revision = latest.revision + 1;
    oldPackageKey = latest.package_key;
    await updateSkill(tx, {
      skillId,
      latestRevision: latest.revision,
      proposed: args.proposed,
      packageKey: args.packageKey,
      version: args.version,
      now,
      actorValue: args.actorValue,
    });
  }

  await replaceTags(tx, skillId, args.proposed.tags);
  await tx.query("delete from skill_draft where id = $1", [args.id]);
  return {
    id: skillId,
    revision,
    version: args.version,
    updatedAt: toIso(now),
    created,
    oldPackageKey,
  };
}

async function insertSkill(
  tx: Db,
  args: {
    skillId: string;
    proposed: Proposed;
    packageKey: string;
    version: string;
    now: Date;
    actorValue: string;
  },
): Promise<void> {
  await tx.query(
    `insert into skill
      (id, name, category_code, description, package_key, version,
       enabled, revision, created_at, updated_at, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, true, 1, $7, $7, $8, $8)`,
    [
      args.skillId,
      args.proposed.name,
      args.proposed.categoryCode,
      args.proposed.description,
      args.packageKey,
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
    version: string;
    now: Date;
    actorValue: string;
  },
): Promise<void> {
  const changed = await tx.query<{ id: string }>(
    `update skill set
       name = $1, category_code = $2, description = $3,
       package_key = $4, version = $5, revision = revision + 1,
       updated_at = $6, updated_by = $7
     where id = $8 and revision = $9
     returning id`,
    [
      args.proposed.name,
      args.proposed.categoryCode,
      args.proposed.description,
      args.packageKey,
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
