import type { SkillDraftService } from "./contract.ts";
import type { SkillDraftDeps } from "./draft-types.ts";
import { cancelDraft, createDraft, getDraft } from "./draft-drafts.ts";
import { deleteDraftFile, renameDraftFile, uploadDraftFile } from "./draft-files.ts";
import { saveDraft } from "./draft-save.ts";
import { deleteSkill, gcDrafts, setSkillEnabled } from "./draft-skill.ts";

export function createSkillDraftService(deps: SkillDraftDeps): SkillDraftService {
  return {
    createDraft: (skillId, requestActor) => createDraft(deps, skillId, requestActor),
    getDraft: (id) => getDraft(deps, id),
    uploadDraftFile: (id, path, data) => uploadDraftFile(deps, id, path, data),
    renameDraftFile: (id, path, newPath) => renameDraftFile(deps, id, path, newPath),
    deleteDraftFile: (id, path) => deleteDraftFile(deps, id, path),
    cancelDraft: (id) => cancelDraft(deps, id),
    saveDraft: (id, baseRevision, input, requestActor) =>
      saveDraft(deps, id, baseRevision, input, requestActor),
    setEnabled: (id, revision, enabled, requestActor) =>
      setSkillEnabled(deps, id, revision, enabled, requestActor),
    delete: (id, revision) => deleteSkill(deps, id, revision),
    gc: (graceMs) => gcDrafts(deps, graceMs),
  };
}
