import {
  DraftExpiredError,
  NotFoundError,
} from "../../core/kernel/index.ts";
import {
  draftPrefix,
  ensureDraftDirectory,
  listFiles,
  readPackage,
  removeDraftTree,
  toIso,
  type DraftRow,
  type SkillDraftDeps,
  type SkillRow,
} from "./draft-types.ts";
import type { SkillDraft } from "./contract.ts";

export async function findDraft(
  deps: SkillDraftDeps,
  id: string,
): Promise<DraftRow | null> {
  return deps.db.one<DraftRow>(
    `select id, skill_id, base_revision, base_version, expires_at, created_at
     from skill_draft where id = $1`,
    [id],
  );
}

export function assertNotExpired(row: DraftRow, deps: SkillDraftDeps): void {
  if (new Date(row.expires_at).getTime() <= deps.clock.now().getTime()) {
    throw new DraftExpiredError(toIso(row.expires_at));
  }
}

export async function requireDraft(
  deps: SkillDraftDeps,
  id: string,
): Promise<DraftRow> {
  const row = await findDraft(deps, id);
  if (row === null) throw new NotFoundError("SkillDraft", id);
  assertNotExpired(row, deps);
  return row;
}

async function toDraft(
  deps: SkillDraftDeps,
  row: DraftRow,
): Promise<SkillDraft> {
  return {
    id: row.id,
    skillId: row.skill_id,
    baseRevision: row.base_revision,
    baseVersion: row.base_version,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    files: await listFiles(deps.store, row.id),
  };
}

export async function createDraft(
  deps: SkillDraftDeps,
  skillId: string | null,
  requestActor?: string | null,
): Promise<SkillDraft> {
  const now = deps.clock.now();
  const id = deps.ids.next();
  const expiresAt = new Date(now.getTime() + deps.draftTtlHours * 3_600_000);
  let baseVersion: string | null = null;
  let baseRevision: number | null = null;

  try {
    if (skillId !== null) {
      const skill = await deps.db.one<SkillRow>(
        "select id, package_key, version, revision from skill where id = $1",
        [skillId],
      );
      if (skill === null) throw new NotFoundError("Skill", skillId);
      baseVersion = skill.version;
      baseRevision = skill.revision;
      const entries = await readPackage(deps.store, skill);
      for (const entry of entries) {
        await deps.store.put(`${draftPrefix(id)}/${entry.path}`, entry.data);
      }
    } else {
      await ensureDraftDirectory(deps.store, id);
    }

    await deps.db.query(
      `insert into skill_draft
        (id, skill_id, base_revision, base_version, expires_at, created_at,
         created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [id, skillId, baseRevision, baseVersion, expiresAt, now, requestActor ?? deps.actor],
    );
    return toDraft(deps, {
      id,
      skill_id: skillId,
      base_revision: baseRevision,
      base_version: baseVersion,
      expires_at: expiresAt,
      created_at: now,
    });
  } catch (error) {
    await removeDraftTree(deps.store, id).catch(() => undefined);
    throw error;
  }
}

export async function getDraft(
  deps: SkillDraftDeps,
  id: string,
): Promise<SkillDraft> {
  return toDraft(deps, await requireDraft(deps, id));
}

export async function cancelDraft(
  deps: SkillDraftDeps,
  id: string,
): Promise<void> {
  const row = await findDraft(deps, id);
  if (row === null) throw new NotFoundError("SkillDraft", id);
  await deps.db.query("delete from skill_draft where id = $1", [id]);
  await removeDraftTree(deps.store, id).catch(() => undefined);
}
