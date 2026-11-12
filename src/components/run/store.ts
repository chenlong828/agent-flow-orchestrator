import { createArchiveStore } from "./store-archive.ts";
import { createLogStore } from "./store-log.ts";
import { createNodeReads } from "./store-node-read.ts";
import { createNodeWrites } from "./store-node-write.ts";
import { createRunReads } from "./store-run-read.ts";
import { createRunWrites } from "./store-run-write.ts";

export { toNodeView, toRunSummary } from "./store-view.ts";
export type { NewArtifactRow, NewNodeRow, NewRunRow } from "./store-types.ts";

/** `CMP-run` 的存储门面：run / node / 制品与归档的写入口，按领域拆到兄弟模块。 */
export function createRunStore() {
  return {
    ...createRunReads(),
    ...createRunWrites(),
    ...createNodeReads(),
    ...createNodeWrites(),
    ...createLogStore(),
    ...createArchiveStore(),
  };
}

export type RunStore = ReturnType<typeof createRunStore>;
