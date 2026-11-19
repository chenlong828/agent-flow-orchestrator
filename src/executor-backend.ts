import type { ExecutorAuthenticator, ObservabilityDirectory, SkillPackageSource } from "./core/kernel/index.ts";
import type { SchedulerHandle } from "./components/scheduler/index.ts";
import type { RunService } from "./components/run/index.ts";

/**
 * 执行面后端装配：把调度器、运行编排、制品端口与凭据解析组合成网关使用的一个读面。
 * 组合根与测试基座共用，避免网关直接依赖调度器/编排（保持组件扇出预算）。
 */
export function createExecutorBackend(deps: {
  scheduler: SchedulerHandle;
  packages: SkillPackageSource;
  authenticator: ExecutorAuthenticator;
  run?: RunService;
  observabilityDirectory?: ObservabilityDirectory;
}) {
  return {
    resolveClientId: (token: string) => deps.authenticator.resolveClientId(token),
    poll: async (clientId: string, report: Parameters<SchedulerHandle["poll"]>[1], options: { holdMs: number }) => {
      const decision = await deps.scheduler.poll(clientId, report, options);
      const run = deps.run;
      const archiveRequests = run === undefined ? [] : await run.archiveRequestsFor(clientId);
      const tasks = run === undefined
        ? decision.tasks
        : await Promise.all(decision.tasks.map(async (task) => {
            const runId = await run.runIdForTask(task.taskId);
            return runId === null ? task : { ...task, runId };
          }));
      return { ...decision, tasks, archiveRequests };
    },
    acceptResult: (clientId: string, result: Parameters<SchedulerHandle["acceptResult"]>[1]) =>
      deps.run === undefined
        ? deps.scheduler.acceptResult(clientId, result)
        : deps.run.handleTaskResult(clientId, result),
    describePackage: (packageId: string) => deps.packages.describe(packageId),
    openPackage: (packageId: string) => deps.packages.open(packageId),
    registerObservability: (clientId: string, url: string) => {
      if (deps.observabilityDirectory !== undefined) deps.observabilityDirectory.register(clientId, url);
    },
    archiveRequests: (clientId: string) =>
      deps.run === undefined ? Promise.resolve([]) : deps.run.archiveRequestsFor(clientId),
    uploadSessionLog: async (input: Parameters<RunService["attachSessionLog"]>[0]) => {
      if (deps.run === undefined) throw new Error("run service 未装配");
      return deps.run.attachSessionLog(input);
    },
    uploadArchive: async (input: Parameters<RunService["storeArchive"]>[0]) => {
      if (deps.run === undefined) throw new Error("run service 未装配");
      return deps.run.storeArchive(input);
    },
    ackArchived: async (clientId: string, runIds: string[]) => {
      if (deps.run !== undefined) await deps.run.ackArchived(clientId, runIds);
    },
    listRunInputs: async (clientId: string, runId: string) => {
      if (deps.run === undefined) throw new Error("run service 未装配");
      return deps.run.listExecutorInputs(clientId, runId);
    },
    openRunInput: async (clientId: string, runId: string, inputId: string) => {
      if (deps.run === undefined) throw new Error("run service 未装配");
      return deps.run.readExecutorInput(clientId, runId, inputId);
    },
  };
}
