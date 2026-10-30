import {
  NotFoundError,
  ReferencedError,
  RevisionConflictError,
} from "../../core/kernel/index.ts";
import { isForeignKeyViolation } from "../../core/platform/index.ts";
import { removeDraftTree, type CurrentSkill, type SkillDraftDeps } from "./draft-types.ts";

export async function setSkillEnabled(
  deps: SkillDraftDeps,
  id: string,
  revision: number,
  enabled: boolean,
  requestActor?: string | null,
): Promise<{ id: string; revision: number }> {
  const current = await deps.db.one<CurrentSkill>(
    "select id, name, package_key, version, revision from skill where id = $1",
    [id],
  );
  if (current === null) throw new NotFoundError("Skill", id);
  if (current.revision !== revision) throw new RevisionConflictError(current.revision);
  const changed = await deps.db.query<{ id: string }>(
    `update skill set enabled = $1, revision = revision + 1,
       updated_at = $2, updated_by = $3
     where id = $4 and revision = $5 returning id`,
    [enabled, deps.clock.now(), requestActor ?? deps.actor, id, revision],
  );
  if (changed.length === 0) throw new RevisionConflictError(current.revision + 1);
  return { id, revision: revision + 1 };
}

export async function deleteSkill(
  deps: SkillDraftDeps,
  id: string,
  revision: number,
): Promise<void> {
  const current = await deps.db.one<CurrentSkill>(
    "select id, name, package_key, version, revision from skill where id = $1",
    [id],
  );
  if (current === null) throw new NotFoundError("Skill", id);
  if (current.revision !== revision) throw new RevisionConflictError(current.revision);
  const references = await deps.guard.check("skill", id);
  if (references.length > 0) {
    throw new ReferencedError({ type: "skill", id, name: current.name }, references);
  }

  const drafts = await deps.db.query<{ id: string }>(
    "select id from skill_draft where skill_id = $1",
    [id],
  );
  try {
    await deps.db.transaction(async (tx) => {
      const changed = await tx.query<{ id: string }>(
        "delete from skill where id = $1 and revision = $2 returning id",
        [id, revision],
      );
      if (changed.length === 0) throw new RevisionConflictError(current.revision);
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      const latest = await deps.guard.check("skill", id);
      throw new ReferencedError({ type: "skill", id, name: current.name }, latest);
    }
    throw error;
  }
  await deps.store.delete(`packages/${current.package_key}`).catch(() => undefined);
  for (const draft of drafts) {
    await removeDraftTree(deps.store, draft.id).catch(() => undefined);
  }
}

export async function gcDrafts(
  deps: SkillDraftDeps,
  graceMs = 0,
): Promise<{ packages: number; drafts: number }> {
  const rows = await deps.db.query<{ package_key: string }>("select package_key from skill");
  const current = new Set(rows.map((row) => `packages/${row.package_key}`));
  const now = deps.clock.now().getTime();
  let packages = 0;
  for (const file of await deps.store.list("packages/")) {
    if (current.has(file.key)) continue;
    if (now - file.modifiedAt.getTime() < graceMs) continue;
    await deps.store.delete(file.key).catch(() => undefined);
    packages += 1;
  }

  const expired = await deps.db.query<{ id: string }>(
    "select id from skill_draft where expires_at <= $1",
    [deps.clock.now()],
  );
  for (const draft of expired) {
    await deps.db.query("delete from skill_draft where id = $1", [draft.id]);
    await removeDraftTree(deps.store, draft.id).catch(() => undefined);
  }
  return { packages, drafts: expired.length };
}
