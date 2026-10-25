import { ensureDatabase } from "../src/core/platform/index.ts";
import { loadConfig } from "../src/core/config/index.ts";

const config = await loadConfig();
await ensureDatabase(config.databaseUrl);
console.log(`数据库已就绪：${new URL(config.databaseUrl).pathname.slice(1)}`);
