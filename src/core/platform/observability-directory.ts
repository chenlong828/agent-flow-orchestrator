import type { ObservabilityDirectory, ObservabilityTarget } from "../kernel/index.ts";

/** 内存版 client 观测面地址目录：poll 头登记，适配器读取；不落库、重启后由下一次 poll 自愈。 */
export function createObservabilityDirectory(): ObservabilityDirectory {
  const targets = new Map<string, ObservabilityTarget>();

  return {
    register(clientId: string, url: string): void {
      const trimmed = url.trim();
      if (trimmed === "") return;
      targets.set(clientId, { url: trimmed.replace(/\/+$/, "") });
    },
    resolve(clientId: string): ObservabilityTarget | null {
      const target = targets.get(clientId);
      return target === undefined ? null : { ...target };
    },
  };
}
