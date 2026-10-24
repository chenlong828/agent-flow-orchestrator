import { loadConfig, ensureDatabase } from "../src/core/platform/index.ts";

const config = loadConfig();
await ensureDatabase(config.databaseUrl);
console.log(`数据库已就绪：${new URL(config.databaseUrl).pathname.slice(1)}`);
