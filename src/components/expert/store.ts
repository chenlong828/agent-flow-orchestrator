import type { Db } from "../../core/platform/index.ts";
import { createExpertStoreProfiles } from "./store-profile.ts";
import { createExpertStoreRootReads } from "./store-root-read.ts";
import { createExpertStoreRootStates } from "./store-root-state.ts";
import { createExpertStoreRootWrites } from "./store-root-write.ts";
import { createExpertStoreSkillLinks } from "./store-skill-links.ts";
import { createExpertStoreToolLinks } from "./store-tool-links.ts";

export type { ExpertRootRow, ExpertRootWrite } from "./store-types.ts";

export type ExpertStore = ReturnType<typeof createExpertStore>;

export function createExpertStore(db: Db) {
  return {
    ...createExpertStoreRootReads(),
    ...createExpertStoreRootWrites(),
    ...createExpertStoreRootStates(),
    ...createExpertStoreProfiles(),
    ...createExpertStoreSkillLinks(),
    ...createExpertStoreToolLinks(),
  };
}
