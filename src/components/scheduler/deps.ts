import type { Clock, IdGenerator, NodeDirectory, SkillPackageSource } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import type { InstanceService } from "../instance/index.ts";

export type SchedulerDeps = {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  instance: InstanceService;
  packages: SkillPackageSource;
  node: NodeDirectory;
  /** 未回报重派上限（含首次下发）；默认来自 CMP-config。 */
  maxAttempts: number;
  /** 未回报回队后的退避毫秒。 */
  retryDelayMs: number;
  silentMs?: number;
  resultGraceMs?: number;
  maxTasksPerPoll?: number;
};
