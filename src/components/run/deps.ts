import type { Clock, FileStore, IdGenerator } from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import type { ExpertRead } from "../expert/index.ts";
import type { HarnessRead } from "../harness/index.ts";
import type { InstanceService } from "../instance/index.ts";
import type { SchedulerService } from "../scheduler/index.ts";
import type { WorkflowRead } from "../workflow/index.ts";

export type RunDeps = {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  fileStore: FileStore;
  workflowRead: WorkflowRead;
  expertRead: ExpertRead;
  harnessRead: HarnessRead;
  instance: InstanceService;
  scheduler: SchedulerService;
  /** 节点任务默认超时（毫秒）。 */
  defaultTimeoutMs: number;
  /** 单节点最大重访轮次。 */
  maxNodeVisits: number;
  /** 归档 pending 超时降级为 failed 的阈值；默认 10 分钟。 */
  archivePendingTtlMs?: number;
};
