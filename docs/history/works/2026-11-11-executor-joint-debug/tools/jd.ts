#!/usr/bin/env bun
/**
 * 联调用临时工具（仅本机调试，不进产品代码）。
 *
 * 用法：
 *   bun run docs/works/2026-11-11-executor-joint-debug/tools/jd.ts enroll <instanceId> <clientId> <workspacePath>
 *   bun run docs/works/2026-11-11-executor-joint-debug/tools/jd.ts enqueue <instanceId> <nodeId> <timeoutMs> <prompt> [skillId...]
 *   bun run docs/works/2026-11-11-executor-joint-debug/tools/jd.ts pkg <skillId>
 *   bun run docs/works/2026-11-11-executor-joint-debug/tools/jd.ts stop <clientId>
 *   bun run docs/works/2026-11-11-executor-joint-debug/tools/jd.ts cancel <instanceId...>
 *   bun run docs/works/2026-11-11-executor-joint-debug/tools/jd.ts inspect <taskId>
 */
import { loadConfig } from "../../../../src/core/config/index.ts";
import {
  createDb,
  createFileStore,
  ensureDatabase,
  systemClock,
  uuidv7Ids,
} from "../../../../src/core/platform/index.ts";
import { createHarnessNodeDirectory, createHarnessRead } from "../../../../src/components/harness/index.ts";
import { createInstanceService } from "../../../../src/components/instance/index.ts";
import { createScheduler } from "../../../../src/components/scheduler/index.ts";
import { createSkillPackageSource } from "../../../../src/components/skill/package-source.ts";

const config = await loadConfig();
await ensureDatabase(config.databaseUrl);
const db = createDb(config.databaseUrl);
const skillStore = createFileStore(config.skillStorageRoot);
const harnessRead = createHarnessRead({ db });
const instance = createInstanceService({ db, clock: systemClock, ids: uuidv7Ids });
const packages = createSkillPackageSource({ db, store: skillStore });
const scheduler = createScheduler({
  db,
  clock: systemClock,
  ids: uuidv7Ids,
  instance,
  packages,
  node: createHarnessNodeDirectory(harnessRead),
  maxAttempts: config.taskMaxAttempts,
  retryDelayMs: config.taskRetryDelayMs,
});

const [command, ...args] = process.argv.slice(2);

function need(count: number, usage: string): string[] {
  if (args.length < count) throw new Error(`参数不足：${usage}`);
  return args;
}

async function main(): Promise<unknown> {
  switch (command) {
    case "enroll": {
      const [instanceId, clientId, workspacePath] = need(3, "enroll <instanceId> <clientId> <workspacePath>");
      return await instance.enroll({
        instanceId: instanceId as string,
        clientId: clientId as string,
        workspacePath: workspacePath as string,
      });
    }
    case "enqueue": {
      const [instanceId, nodeId, timeoutMs, prompt, ...skillIds] = need(
        4,
        "enqueue <instanceId> <nodeId> <timeoutMs> <prompt> [skillId...]",
      );
      return await scheduler.enqueue({
        tasks: [
          {
            instanceId: instanceId as string,
            nodeId: nodeId as string,
            timeoutMs: Number(timeoutMs),
            prompt: prompt as string,
            skillIds,
          },
        ],
      });
    }
    case "pkg": {
      const [skillId] = need(1, "pkg <skillId>");
      return await packages.currentForSkill(skillId as string);
    }
    case "stop": {
      const [clientId] = need(1, "stop <clientId>");
      await scheduler.requestStop(clientId as string);
      return { stopRequested: true, clientId };
    }
    case "cancel": {
      if (args.length === 0) throw new Error("参数不足：cancel <instanceId...>");
      return await scheduler.cancelInstances(args);
    }
    case "inspect": {
      const [taskId] = need(1, "inspect <taskId>");
      return await scheduler.inspect(taskId as string);
    }
    default:
      throw new Error(`未知命令：${command ?? "<空>"}`);
  }
}

try {
  console.log(JSON.stringify(await main(), null, 2));
} finally {
  await db.close();
}
