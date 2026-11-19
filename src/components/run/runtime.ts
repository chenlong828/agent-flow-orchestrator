import type { RunDeps } from "./deps.ts";
import { createCore, type RunCore } from "./core.ts";
import { createDispatchOps, type DispatchOps } from "./dispatch-ops.ts";
import { createNodeOps, type NodeOps } from "./node-ops.ts";
import { createInputOps, type InputOps } from "./input-ops.ts";

export type RunRuntime = RunCore & NodeOps & DispatchOps & InputOps;

/** 一次 run 编排的共享运行时：核心状态、节点行与派发原语。 */
export function createRuntime(deps: RunDeps): RunRuntime {
  const core = createCore(deps);
  const nodes = createNodeOps(core);
  const dispatch = createDispatchOps(core);
  const inputs = createInputOps(core);
  return { ...core, ...nodes, ...dispatch, ...inputs };
}
