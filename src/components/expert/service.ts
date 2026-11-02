import { expertStore } from "./store.ts";
import type { ExpertDeps, ExpertService } from "./types.ts";
import {
  createExpert,
  deleteExpert,
  setEnabledExpert,
  setExpertSkills,
  setExpertTools,
  updateAggregateExpert,
  updateExpert,
  type ExpertServiceContext,
} from "./write.ts";

export type { ExpertDeps } from "./types.ts";
export { SkillNotFoundError, ToolNotFoundError } from "./errors.ts";
export { createExpertRead } from "./read.ts";

export function createExpertService(deps: ExpertDeps): ExpertService {
  const ctx: ExpertServiceContext = { ...deps, store: expertStore };
  return {
    create: (input, requestActor) => createExpert(ctx, input, requestActor),
    update: (id, revision, input, requestActor) =>
      updateExpert(ctx, id, revision, input, requestActor),
    updateAggregate: (id, revision, input, requestActor) =>
      updateAggregateExpert(ctx, id, revision, input, requestActor),
    setEnabled: (id, revision, enabled, requestActor) =>
      setEnabledExpert(ctx, id, revision, enabled, requestActor),
    delete: (id, revision) => deleteExpert(ctx, id, revision),
    setSkills: (id, revision, skillIds, requestActor) =>
      setExpertSkills(ctx, id, revision, skillIds, requestActor),
    setTools: (id, revision, toolIds, requestActor) =>
      setExpertTools(ctx, id, revision, toolIds, requestActor),
  };
}
