import {
  NotFoundError,
  ValidationError,
  type SkillPackageRef,
} from "../../core/kernel/index.ts";
import type { SchedulerDeps } from "./deps.ts";
import { skillSetDigest } from "./digest.ts";
import type { NewTaskRow, SchedulerStore } from "./store.ts";
import { validateDraft } from "./validate.ts";
import type { EnqueueInput, EnqueueResult, SkillSet, TaskDraft } from "./types.ts";

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

export function createEnqueueHandler(
  deps: SchedulerDeps,
  store: SchedulerStore,
  notifyAll: () => void,
) {
  return async function enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    if (input === null || typeof input !== "object" || !Array.isArray(input.tasks)) {
      throw new ValidationError("tasks", "必须是对象数组");
    }
    if (input.tasks.length === 0) throw new ValidationError("tasks", "不能为空");
    const drafts = input.tasks.map(validateDraft);
    const byInstance = groupByInstance(drafts);

    const now = deps.clock.now();
    const inserts: NewTaskRow[] = [];
    const taskIds: string[] = [];
    const skillSets: { instanceId: string; skillSet: SkillSet }[] = [];

    for (const [instanceId, group] of byInstance) {
      const head = group[0];
      if (head === undefined) continue;
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
      skillSets.push({ instanceId, skillSet });
      for (const draft of group) {
        const id = deps.ids.next();
        taskIds.push(id);
        inserts.push({
          id,
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
        });
      }
    }

    await deps.db.transaction((tx) => store.insertTasks(tx, inserts));
    notifyAll();
    return { taskIds, skillSets };
  };
}
