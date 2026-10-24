import { join } from "node:path";
import {
  createDb,
  createMigrator,
  ensureDatabase,
  loadConfig,
} from "../src/core/platform/index.ts";

const config = loadConfig();
await ensureDatabase(config.databaseUrl);
const db = createDb(config.databaseUrl);
try {
  const migrator = createMigrator({
    db,
    directory: join(process.cwd(), "db", "migrations"),
  });
  const result = await migrator.up();
  console.log(
    `迁移完成：applied=${result.applied.length} skipped=${result.skipped.length}`,
  );
  for (const file of result.applied) console.log(`  + ${file}`);
} finally {
  await db.close();
}
