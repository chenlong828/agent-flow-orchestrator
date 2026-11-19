import {
  NotFoundError,
  ValidationError,
  type SkillPackageRef,
} from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import type { Instance } from "../instance/index.ts";
import type { SchedulerDeps } from "./deps.ts";
import { skillSetDigest } from "./digest.ts";
import type { NewTaskRow, SchedulerStore } from "./store.ts";
import { validateDraft } from "./validate.ts";
import type { EnqueueInput, EnqueueOptions, EnqueueResult, SkillSet, TaskDraft } from "./types.ts";

async function resolveSkillSet(deps: SchedulerDeps, skillIds: string[]): Promise<SkillSet> {
  const packages: SkillPackageRef[] = [];
  for (const skillId of skillIds) {
    packages.push(await deps.packages.currentForSkill(skillId));
  }
  return { digest: skillSetDigest(packages), packages };
}

function groupByInstance(drafts: TaskDraft[]): Map<string, TaskDraft[]> {
  const byInstance = new Map<string, TaskDraft[]>();
  for (const draft of drafts) {
    const list = byInstance.get(draft.instanceId) ?? [];
    list.push(draft);
    byInstance.set(draft.instanceId, list);
  }
  return byInstance;
}

type InstanceBatch = {
  instance: Instance;
  skillSet: SkillSet;
  ids: string[];
  rows: NewTaskRow[];
};

/** 单个实例的入队规划：校验技能集一致、解析技能包与工作区，返回待插入行。 */
async function planInstanceBatch(
  deps: SchedulerDeps,
  store: SchedulerStore,
  instanceId: string,
  group: TaskDraft[],
  now: Date,
): Promise<InstanceBatch> {
  const head = group[0];
  if (head === undefined) throw new ValidationError("tasks", "实例批次不能为空");
  const signatures = new Set(group.map((draft) => [...draft.skillIds].sort().join(",")));
  if (signatures.size > 1) {
    throw new ValidationError("tasks", `同一实例 ${instanceId} 的批次技能集必须一致`);
  }
  const instance = await deps.instance.get(instanceId);
  if (instance === null) throw new NotFoundError("执行实例", instanceId);
  const skillSet = await resolveSkillSet(deps, head.skillIds);
  if (await store.hasDispatchedDigestConflict(instanceId, skillSet.digest)) {
    throw new ValidationError("skillIds", `实例 ${instanceId} 已有不同技能集的任务正在执行`);
  }
  const ids = group.map(() => deps.ids.next());
  const rows = group.map((draft, index): NewTaskRow => ({
    id: ids[index] as string,
    instanceId,
    nodeId: draft.nodeId,
    prompt: draft.prompt,
    workspacePath: instance.workspacePath,
    taskSpacePath: draft.taskSpacePath,
    timeoutMs: draft.timeoutMs,
    skillSet,
    skillSetDigest: skillSet.digest,
    resultSignal: draft.resultSignal ?? null,
    resumeSessionId: draft.resumeSessionId ?? null,
    notBefore: now,
    now,
  }));
  return { instance, skillSet, ids, rows };
}

export function createEnqueueHandler(
  deps: SchedulerDeps,
  store: SchedulerStore,
  notifyAll: () => void,
) {
  return async function enqueue(
    input: EnqueueInput,
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    if (input === null || typeof input !== "object" || !Array.isArray(input.tasks)) {
      throw new ValidationError("tasks", "必须是对象数组");
    }
    if (input.tasks.length === 0) throw new ValidationError("tasks", "不能为空");
    const byInstance = groupByInstance(input.tasks.map(validateDraft));
    const now = deps.clock.now();
    const inserts: NewTaskRow[] = [];
    const taskIds: string[] = [];
    const skillSets: { instanceId: string; skillSet: SkillSet }[] = [];
    const clientIds: string[] = [];

    for (const [instanceId, group] of byInstance) {
      const batch = await planInstanceBatch(deps, store, instanceId, group, now);
      inserts.push(...batch.rows);
      taskIds.push(...batch.ids);
      skillSets.push({ instanceId, skillSet: batch.skillSet });
      if (!clientIds.includes(batch.instance.clientId)) clientIds.push(batch.instance.clientId);
    }

    const insert = (tx: Db): Promise<void> => store.insertTasks(tx, inserts);
    if (options.tx !== undefined) {
      // 加入调用方事务：提交与唤醒都由调用方负责，避免「任务可见但关联字段未写入」。
      await insert(options.tx);
      return { taskIds, skillSets, clientIds };
    }
    await deps.db.transaction(insert);
    notifyAll();
    return { taskIds, skillSets, clientIds };
  };
}
