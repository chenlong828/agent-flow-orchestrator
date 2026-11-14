import type { Db } from "../../core/platform/index.ts";
import type { WorkflowGraph } from "../workflow/index.ts";
import { nodeById } from "./graph-checks.ts";
import type { PromptEntry } from "./prompt.ts";
import type { RunStore } from "./store.ts";
import type { EnterReason, RunNodeRow, RunRow } from "./types.ts";

function pointerOf(value: RunNodeRow["enter_reason"]): EnterReason | null {
  if (value === null) return null;
  const parsed = typeof value === "string" ? (JSON.parse(value) as EnterReason) : value;
  if (parsed.kind !== "review_fail" && parsed.kind !== "confirm_reject") return null;
  if (typeof parsed.from !== "string" || typeof parsed.fromVisit !== "number") return null;
  return parsed;
}

function verdictOf(row: RunNodeRow | null): Record<string, unknown> | null {
  if (row === null) return null;
  return typeof row.verdict === "string"
    ? (JSON.parse(row.verdict) as Record<string, unknown>)
    : row.verdict;
}

/**
 * 进入原因：行里只存指针，理由正文回查被驳回行的 verdict，保持单一来源。
 * 被驳回行不可变，所以这条查找永远指向同一句理由。
 */
export async function resolveEntry(
  store: RunStore,
  db: Db,
  graph: WorkflowGraph,
  run: RunRow,
  row: RunNodeRow,
): Promise<PromptEntry | undefined> {
  const pointer = pointerOf(row.enter_reason);
  if (pointer === null) return undefined;
  const source = await store.findNode(db, run.id, pointer.from, pointer.fromVisit);
  const verdict = verdictOf(source);
  const field = pointer.kind === "confirm_reject" ? "comment" : "reason";
  const value = verdict?.[field];
  return {
    kind: pointer.kind,
    fromName: nodeById(graph, pointer.from)?.name ?? pointer.from,
    reason: typeof value === "string" ? value : "",
  };
}
