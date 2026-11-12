import type { RunService } from "./types.ts";
import type { RunDeps } from "./deps.ts";
import { createAdvance } from "./advance.ts";
import { createArtifacts } from "./artifacts.ts";
import { createCommands } from "./commands.ts";
import { createQueries } from "./queries.ts";
import { createResultHandler } from "./results.ts";
import { createRuntime } from "./runtime.ts";

/** `CMP-run` 服务门面：推进、结算、命令、查询与制品。 */
export function createRunService(deps: RunDeps): RunService {
  const runtime = createRuntime(deps);
  const queries = createQueries(runtime);
  const commands = createCommands(runtime, queries);
  const artifacts = createArtifacts(runtime);

  return {
    start: commands.start,
    advance: createAdvance(runtime),
    handleTaskResult: createResultHandler(runtime),
    attachSessionLog: artifacts.attachSessionLog,
    storeArchive: artifacts.storeArchive,
    archiveRequestsFor: artifacts.archiveRequestsFor,
    ackArchived: artifacts.ackArchived,
    decide: commands.decide,
    cancel: commands.cancel,
    get: queries.get,
    list: queries.list,
    readSessionLog: artifacts.readSessionLog,
    resumePending: queries.resumePending,
  };
}
