import type { ExecutorAuthenticator, SkillPackageSource } from "./core/kernel/index.ts";
import type { SchedulerHandle } from "./components/scheduler/index.ts";

/**
 * 执行面后端装配：把调度器、制品端口与凭据解析组合成网关使用的一个读面。
 * 组合根与测试基座共用，避免网关直接依赖调度器（保持组件扇出预算）。
 */
export function createExecutorBackend(deps: {
  scheduler: SchedulerHandle;
  packages: SkillPackageSource;
  authenticator: ExecutorAuthenticator;
}) {
  return {
    resolveClientId: (token: string) => deps.authenticator.resolveClientId(token),
    poll: (clientId: string, report: Parameters<SchedulerHandle["poll"]>[1], options: { holdMs: number }) =>
      deps.scheduler.poll(clientId, report, options),
    acceptResult: (clientId: string, result: Parameters<SchedulerHandle["acceptResult"]>[1]) =>
      deps.scheduler.acceptResult(clientId, result),
    describePackage: (packageId: string) => deps.packages.describe(packageId),
    openPackage: (packageId: string) => deps.packages.open(packageId),
  };
}
