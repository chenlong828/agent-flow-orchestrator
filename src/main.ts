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
  createHarnessRead,
  createHarnessService,
} from "./components/harness/index.ts";
import { createToolRead, createToolService } from "./components/tool/index.ts";
import { createSkillRead } from "./components/skill/read.ts";
import { createSkillDraftService } from "./components/skill/draft.ts";
import {
  createExpertRead,
  createExpertService,
} from "./components/expert/index.ts";
import { createCatalog } from "./components/catalog/index.ts";
import { createApiDocs, createHttpApp } from "./components/http-gateway/index.ts";

const config = await loadConfig();

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
const expertRead = createExpertRead({ db });
const catalog = createCatalog({ harnessRead, toolRead, skillRead, expertRead });

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
  harnessService,
  toolService,
  skillDraftService,
  expertService,
  health,
  actor: config.actor,
  docs,
});

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: app,
});

console.log(`AgentFlow B1 编排服务已启动：http://${config.host}:${server.port}`);
console.log(`API 文档：http://${config.host}:${server.port}/docs`);

async function shutdown(): Promise<void> {
  server.stop();
  await db.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
