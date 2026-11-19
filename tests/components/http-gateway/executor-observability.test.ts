import { describe, expect, test } from "bun:test";
import { createExecutorBackend } from "../../../src/executor-backend.ts";
import type { SchedulerHandle } from "../../../src/components/scheduler/index.ts";
import type { RunService } from "../../../src/components/run/index.ts";
import type { ObservabilityDirectory } from "../../../src/core/kernel/index.ts";

function directory(): ObservabilityDirectory {
  const targets = new Map<string, string>();
  return {
    register: (id, url) => void targets.set(id, url),
    resolve: (id) => (targets.has(id) ? { url: targets.get(id) as string } : null),
  };
}

describe("executor backend 观测桥", () => {
  test("登记 URL，poll 给 task 补 runId", async () => {
    const dir = directory();
    const scheduler = {
      poll: async () => ({
        tasks: [
          {
            taskId: "t1",
            instanceId: "i1",
            nodeId: "n3",
            attempt: 1,
            prompt: "p",
            workspacePath: "/ws",
            taskSpacePath: "/ws/task",
            timeoutMs: 1000,
            skillSet: { digest: "d", packages: [] },
          },
        ],
        stop: false,
        cancelInstances: [],
        nextPollAfterMs: 0,
      }),
    } as unknown as SchedulerHandle;
    const run = {
      archiveRequestsFor: async () => [],
      runIdForTask: async (taskId: string) => (taskId === "t1" ? "run-1" : null),
    } as unknown as RunService;
    const backend = createExecutorBackend({
      scheduler,
      packages: {} as never,
      authenticator: {} as never,
      run,
      observabilityDirectory: dir,
    });

    backend.registerObservability("c1", "http://127.0.0.1:17890/api/v1/observability");
    expect(dir.resolve("c1")).toEqual({ url: "http://127.0.0.1:17890/api/v1/observability" });

    const decision = await backend.poll(
      "c1",
      { free: 1, running: [], finished: [] },
      { holdMs: 0 },
    );
    expect(decision.tasks[0]).toMatchObject({ taskId: "t1", runId: "run-1" });
  });
});
