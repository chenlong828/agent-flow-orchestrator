import { join } from "node:path";
import {
  createDb,
  createFileStore,
  createHealth,
  createMigrator,
  ensureDatabase,
  systemClock,
  uuidv7Ids,
} from "./core/platform/index.ts";
import { loadConfig } from "./core/config/index.ts";
import {
  createHarnessAuthenticator,
  createHarnessNodeDirectory,
  createHarnessRead,
  createHarnessService,
} from "./components/harness/index.ts";
import { createToolRead, createToolService } from "./components/tool/index.ts";
import {
  createSkillDraftService,
  createSkillPackageSource,
  createSkillRead,
  createSkillSlugReader,
} from "./components/skill/index.ts";
import { createInstanceService } from "./components/instance/index.ts";
import { createScheduler } from "./components/scheduler/index.ts";
import { createRunService } from "./components/run/index.ts";
import { createExecutorBackend } from "./executor-backend.ts";
import {
  createExpertRead,
  createExpertService,
} from "./components/expert/index.ts";
import {
  createWorkflowRead,
  createWorkflowService,
} from "./components/workflow/index.ts";
import { createCatalog } from "./components/catalog/index.ts";
import { createApiDocs, createHttpApp } from "./components/http-gateway/index.ts";

const config = await loadConfig();
if (config.executorAuth === "off") {
  console.warn(
    "执行面鉴权已关闭（EXECUTOR_AUTH=off）：允许 X-Client-Id 自注册，仅限开发期；暴露到非 loopback 前必须设 EXECUTOR_AUTH=on",
  );
}

await ensureDatabase(config.databaseUrl);
const db = createDb(config.databaseUrl);
const migrator = createMigrator({
  db,
  directory: join(process.cwd(), "db", "migrations"),
});
const migration = await migrator.up();
if (migration.applied.length > 0) {
  console.log(`已应用迁移：${migration.applied.join(", ")}`);
}

const harnessRead = createHarnessRead({ db });
const toolRead = createToolRead({ db });
const skillStore = createFileStore(config.skillStorageRoot);
const skillRead = createSkillRead(db, skillStore);
const skillSlugReader = createSkillSlugReader({ db });
const expertRead = createExpertRead({ db });
const workflowRead = createWorkflowRead({ db });
const instanceService = createInstanceService({
  db,
  clock: systemClock,
  ids: uuidv7Ids,
});
const skillPackageSource = createSkillPackageSource({ db, store: skillStore });
const scheduler = createScheduler({
  db,
  clock: systemClock,
  ids: uuidv7Ids,
  instance: instanceService,
  packages: skillPackageSource,
  node: createHarnessNodeDirectory(harnessRead),
  maxAttempts: config.taskMaxAttempts,
  retryDelayMs: config.taskRetryDelayMs,
});
const archiveStore = createFileStore(config.archiveRoot);
const runService = createRunService({
  db,
  clock: systemClock,
  ids: uuidv7Ids,
  fileStore: archiveStore,
  workflowRead,
  expertRead,
  harnessRead,
  instance: instanceService,
  scheduler,
  defaultTimeoutMs: config.runDefaultTimeoutMs,
  maxNodeVisits: config.runMaxNodeVisits,
});
await runService.resumePending();
const executorAuthenticator = createHarnessAuthenticator({ db });

const catalog = createCatalog({
  harnessRead,
  presence: scheduler,
  toolRead,
  skillRead,
  expertRead,
  workflowRead,
});

const harnessService = createHarnessService({
  db,
  clock: systemClock,
  ids: uuidv7Ids,
  guard: catalog,
  actor: config.actor,
});
const toolService = createToolService({
  db,
  clock: systemClock,
  ids: uuidv7Ids,
  guard: catalog,
  actor: config.actor,
});
const skillDraftService = createSkillDraftService({
  db,
  store: skillStore,
  clock: systemClock,
  ids: uuidv7Ids,
  guard: catalog,
  draftTtlHours: config.skillDraftTtlHours,
  actor: config.actor,
});
const expertService = createExpertService({
  db,
  clock: systemClock,
  ids: uuidv7Ids,
  actor: config.actor,
  guard: catalog,
  skillSlugs: skillSlugReader,
});
const workflowService = createWorkflowService({
  db,
  clock: systemClock,
  ids: uuidv7Ids,
  actor: config.actor,
  expertStatus: expertRead,
});

const health = createHealth(db);

const docs = await createApiDocs({
  assetsDirectory: join(
    process.cwd(),
    "src",
    "components",
    "http-gateway",
    "docs-assets",
  ),
});

const app = createHttpApp({
  catalog,
  backend: createExecutorBackend({
    scheduler,
    packages: skillPackageSource,
    authenticator: executorAuthenticator,
    run: runService,
  }),
  executorAuth: config.executorAuth,
  executorEnroll: async (clientId, address) => {
    const node = await harnessService.ensureNode(clientId, { address });
    if (node.created) {
      console.log(`执行面自动登记节点：clientId=${clientId}（X-Client-Id，EXECUTOR_AUTH=off）`);
    }
  },
  runService,
  harnessService,
  toolService,
  skillDraftService,
  expertService,
  workflowService,
  health,
  actor: config.actor,
  docs,
});

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: app,
});

console.log(`AgentFlow B1+B3 编排服务已启动：http://${config.host}:${server.port}`);
console.log(`API 文档：http://${config.host}:${server.port}/docs`);

async function shutdown(): Promise<void> {
  server.stop();
  await db.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
