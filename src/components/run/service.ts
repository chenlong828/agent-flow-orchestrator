import {
  InvalidArchiveError,
  InvalidStateError,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_SESSION_LOG_BYTES,
  NotFoundError,
  PayloadTooLargeError,
  RunConflictError,
  RunNotFoundError,
  SessionLogMissingError,
  TaskNotFoundError,
  ValidationError,
  normalizePageQuery,
  toIso,
} from "../../core/kernel/index.ts";
import type { Page } from "../../core/kernel/index.ts";
import type { WorkflowGraph, WorkflowNode } from "../workflow/index.ts";
import { inspectArchive } from "./archive.ts";
import type { RunDeps } from "./deps.ts";
import {
  assertRunnableGraph,
  graphOf,
  isAncestor,
  nodeById,
  rollbackTarget,
  seqOut,
  startNode,
} from "./graph-checks.ts";
import { composeNodePrompt } from "./prompt.ts";
import { createRunStore, toNodeView, toRunSummary } from "./store.ts";
import type {
  ArchiveInput,
  DecideInput,
  RunDetail,
  RunNodeRow,
  RunRow,
  RunService,
  RunSummary,
  SessionLogInput,
  StartRun,
  StoredState,
} from "./types.ts";
import { ensureAbsolutePath, ensureAttempt, taskSpaceFor } from "./validate.ts";
import { parseVerdict } from "./verdict.ts";

type ErrorView = { code: string; message: string } | null;

function errorView(value: unknown): ErrorView {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof parsed !== "object" || parsed === null) return null;
  const code = (parsed as { code?: unknown }).code;
  const message = (parsed as { message?: unknown }).message;
  return {
    code: typeof code === "string" ? code : "internal",
    message: typeof message === "string" ? message : "",
  };
}

function detailOf(run: RunRow, nodes: RunNodeRow[]): RunDetail {
  return {
    ...toRunSummary(run),
    finalMessage: run.final_message,
    nodes: nodes.map(toNodeView),
  };
}

function pathBetween(graph: WorkflowGraph, from: string, to: string): WorkflowNode[] {
  const path: WorkflowNode[] = [];
  let current = from;
  for (let guard = 0; guard <= graph.nodes.length; guard += 1) {
    const node = nodeById(graph, current);
    if (node === null) return [];
    path.push(node);
    if (current === to) return path;
    const out = seqOut(graph, node.id);
    if (out.length !== 1) return [];
    current = out[0]!.to;
  }
  return [];
}

export function createRunService(deps: RunDeps): RunService {
  const store = createRunStore();
  const locks = new Map<string, Promise<unknown>>();

  async function withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(runId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    locks.set(runId, current);
    try {
      return await current;
    } finally {
      if (locks.get(runId) === current) locks.delete(runId);
    }
  }

  async function loadRun(runId: string): Promise<RunRow> {
    const run = await store.findRun(deps.db, runId);
    if (run === null) throw new RunNotFoundError(runId);
    return run;
  }

  function graphFor(run: RunRow): WorkflowGraph {
    return graphOf(run.graph_snapshot);
  }

  async function finish(
    runId: string,
    outcome: "succeeded" | "failed" | "cancelled",
    error: ErrorView,
    finalMessage: string | null,
  ): Promise<void> {
    const now = deps.clock.now();
    await deps.db.transaction((tx) =>
      store.finishRun(tx, runId, { outcome, error, finalMessage, now }),
    );
  }

  async function createNode(
    run: RunRow,
    node: WorkflowNode,
    state: "queued" | "waiting_confirm",
  ): Promise<RunNodeRow> {
    const visit = (await store.maxVisit(deps.db, run.id, node.id)) + 1;
    if (visit > deps.maxNodeVisits) {
      await finish(run.id, "failed", {
        code: "visit_limit_exceeded",
        message: `节点 ${node.id} 超过最大重访次数 ${deps.maxNodeVisits}`,
      }, null);
      throw new InvalidStateError("visit_limit_exceeded");
    }
    const now = deps.clock.now();
    await deps.db.transaction(async (tx) => {
      await store.insertNode(tx, {
        runId: run.id,
        nodeId: node.id,
        visit,
        nodeType: node.type,
        expertId: node.expertId,
        state,
        now,
      });
      await store.setCurrentNode(tx, run.id, node.id, now);
      if (state === "waiting_confirm") {
        await store.setRunProgress(tx, run.id, {
          state: "waiting_confirm",
          currentNodeId: node.id,
          now,
        });
      }
    });
    const row = await store.findNode(deps.db, run.id, node.id, visit);
    if (row === null) throw new NotFoundError("run_node", `${run.id}/${node.id}/${visit}`);
    return row;
  }

  async function dispatch(run: RunRow, node: WorkflowNode, row: RunNodeRow): Promise<void> {
    const graph = graphFor(run);
    if (node.expertId === null) throw new ValidationError(`graph.nodes.${node.id}.expertId`, "执行节点必须绑定专家");
    const expert = await deps.expertRead.get(node.expertId);
    const workflow = await deps.workflowRead.get(run.workflow_id);
    const start = startNode(graph);
    const prompt = composeNodePrompt({
      workflowName: workflow.name,
      node,
      expertName: expert.name,
      taskSpacePath: run.task_space_path,
      ...(start?.id === node.id ? { intentMarkdown: run.intent_markdown } : {}),
    });
    const enqueued = await deps.scheduler.enqueue({
      tasks: [
        {
          instanceId: run.instance_id,
          nodeId: node.id,
          prompt,
          timeoutMs: deps.defaultTimeoutMs,
          skillIds: expert.skillIds,
        },
      ],
    });
    const taskId = enqueued.taskIds[0]!;
    const now = deps.clock.now();
    await deps.db.transaction(async (tx) => {
      await store.setNodeDispatched(tx, run.id, node.id, row.visit, taskId, now);
      await store.setRunProgress(tx, run.id, {
        state: "running",
        currentNodeId: node.id,
        now,
      });
    });
  }

  async function settleNode(
    run: RunRow,
    node: WorkflowNode,
    row: RunNodeRow,
    input: {
      state: "succeeded" | "rejected" | "failed";
      verdict?: Record<string, unknown> | null;
      message: string;
      error?: ErrorView;
    },
  ): Promise<void> {
    const now = deps.clock.now();
    await deps.db.transaction((tx) =>
      store.settleNode(tx, {
        runId: run.id,
        nodeId: node.id,
        visit: row.visit,
        state: input.state,
        verdict: input.verdict ?? null,
        message: input.message,
        error: input.error ?? null,
        now,
      }),
    );
  }

  async function applyResult(run: RunRow, row: RunNodeRow, result: { status: string; message: string; error: ErrorView }): Promise<void> {
    const node = nodeById(graphFor(run), row.node_id);
    if (node === null) {
      await finish(run.id, "failed", { code: "missing_node", message: row.node_id }, null);
      return;
    }
    if (result.status === "succeeded") {
      if (node.type === "review") {
        const verdict = parseVerdict(result.message);
        if (verdict === null) {
          await settleNode(run, node, row, {
            state: "failed",
            message: result.message,
            error: { code: "verdict_invalid", message: "缺少合法 verdict JSON" },
          });
          await finish(run.id, "failed", {
            code: "verdict_invalid",
            message: `节点 ${node.id} 的 verdict 不合法`,
          }, null);
          return;
        }
        if (verdict.verdict === "fail") {
          await settleNode(run, node, row, {
            state: "rejected",
            verdict,
            message: result.message,
          });
          const target = rollbackTarget(graphFor(run), node.id);
          if (target === null) {
            await finish(run.id, "failed", {
              code: "missing_rollback_edge",
              message: `节点 ${node.id} 没有回退边`,
            }, null);
            return;
          }
          if (!isAncestor(graphFor(run), target, node.id)) {
            await finish(run.id, "failed", {
              code: "invalid_rollback_target",
              message: `回退目标 ${target} 不是祖先`,
            }, null);
            return;
          }
          return;
        }
        await settleNode(run, node, row, {
          state: "succeeded",
          verdict,
          message: result.message,
        });
        return;
      }
      await settleNode(run, node, row, { state: "succeeded", message: result.message });
      return;
    }
    if (result.status === "cancelled") {
      await settleNode(run, node, row, {
        state: "failed",
        message: result.message,
        error: { code: "cancelled", message: "任务已取消" },
      });
      await finish(run.id, "cancelled", { code: "cancelled", message: "任务已取消" }, null);
      return;
    }
    await settleNode(run, node, row, {
      state: "failed",
      message: result.message,
      error: result.error,
    });
    await finish(run.id, "failed", result.error ?? { code: result.status, message: "任务失败" }, null);
  }

  async function advanceLocked(runId: string): Promise<void> {
    const run = await loadRun(runId);
    if (run.state === "done") return;
    const graph = graphFor(run);
    const start = startNode(graph);
    if (start === null) throw new ValidationError("graph.nodes", "缺少开始节点");
    let currentId = run.current_node_id ?? start.id;
    if (run.current_node_id === null) {
      const now = deps.clock.now();
      await deps.db.transaction((tx) => store.setCurrentNode(tx, run.id, currentId, now));
    }
    for (let guard = 0; guard <= graph.nodes.length * 3; guard += 1) {
      const node = nodeById(graph, currentId);
      if (node === null) {
        await finish(run.id, "failed", { code: "missing_node", message: currentId }, null);
        return;
      }
      let row = await store.findNode(deps.db, run.id, node.id);
      if (node.type === "confirm") {
        if (row === null) row = await createNode(run, node, "waiting_confirm");
        if (row.state === "waiting_confirm") {
          if (run.auto_confirm) {
            await settleNode(run, node, row, { state: "succeeded", message: "auto" });
            row = (await store.findNode(deps.db, run.id, node.id))!;
          } else {
            await setWaitingConfirm(run.id);
            return;
          }
        }
      }
      if (row === null) row = await createNode(run, node, "queued");
      if (row.state === "queued") {
        await dispatch(run, node, row);
        return;
      }
      if (row.state === "dispatched" || row.state === "waiting_confirm") {
        if (row.state === "waiting_confirm") await setWaitingConfirm(run.id);
        return;
      }
      if (row.state === "failed") return;
      if (row.state === "rejected") {
        const target = rollbackTarget(graph, node.id);
        if (target === null) {
          await finish(run.id, "failed", {
            code: "missing_rollback_edge",
            message: `节点 ${node.id} 没有回退边`,
          }, null);
          return;
        }
        const path = pathBetween(graph, target, node.id);
        if (path.length === 0) {
          await finish(run.id, "failed", {
            code: "invalid_rollback_target",
            message: `回退目标 ${target} 不在当前路径上`,
          }, null);
          return;
        }
        for (const revisit of path) {
          await createNode(run, revisit, "queued");
        }
        currentId = target;
        const now = deps.clock.now();
        await deps.db.transaction((tx) => store.setCurrentNode(tx, run.id, target, now));
        continue;
      }
      if (row.state === "succeeded") {
        if (node.type === "end") {
          await finish(run.id, "succeeded", null, row.message);
          return;
        }
        const out = seqOut(graph, node.id);
        if (out.length !== 1) {
          await finish(run.id, "failed", {
            code: "missing_out_edge",
            message: `节点 ${node.id} 没有唯一出边`,
          }, null);
          return;
        }
        currentId = out[0]!.to;
        const now = deps.clock.now();
        await deps.db.transaction((tx) => store.setCurrentNode(tx, run.id, currentId, now));
        continue;
      }
      return;
    }
    await finish(run.id, "failed", { code: "advance_loop", message: "推进超过上限" }, null);
  }

  async function setWaitingConfirm(runId: string): Promise<void> {
    const run = await loadRun(runId);
    if (run.state === "waiting_confirm") return;
    const now = deps.clock.now();
    await deps.db.transaction((tx) =>
      store.setRunProgress(tx, run.id, {
        state: "waiting_confirm",
        currentNodeId: run.current_node_id,
        now,
      }),
    );
  }

  async function handleTaskResult(
    clientId: string,
    result: Parameters<RunService["handleTaskResult"]>[1],
  ): Promise<{ taskId: string; accepted: boolean }> {
    const row = await store.findNodeByTask(deps.db, result.taskId);
    if (row === null) return deps.scheduler.acceptResult(clientId, result);
    const run = await loadRun(row.run_id);
    const log = await store.findArtifact(deps.db, {
      runId: run.id,
      kind: "session_log",
      nodeId: row.node_id,
      visit: row.visit,
      attempt: result.attempt,
    });
    if (log === null) throw new SessionLogMissingError(result.taskId, result.attempt);
    const ack = await deps.scheduler.acceptResult(clientId, result);
    if (!ack.accepted) return ack;
    await withLock(run.id, async () => {
      const fresh = await loadRun(run.id);
      const node = nodeById(graphFor(fresh), row.node_id);
      if (node === null) return;
      await applyResult(fresh, row, {
        status: result.status,
        message: result.message,
        error: result.error as ErrorView,
      });
      if (fresh.state !== "done") {
        const latest = await loadRun(run.id);
        if (latest.state !== "done") await advanceLocked(run.id);
      }
    });
    return ack;
  }

  async function start(input: StartRun): Promise<RunDetail> {
    const workflow = await deps.workflowRead.get(input.workflowId);
    const graph = workflow.graph;
    assertRunnableGraph(graph);
    for (const node of graph.nodes) {
      if (node.expertId !== null) {
        const expert = await deps.expertRead.get(node.expertId);
        if (!expert.enabled) {
          throw new ValidationError(`graph.nodes.${node.id}.expertId`, "专家已停用");
        }
      }
    }
    const harness = await deps.harnessRead.get(input.harnessId);
    if (harness.clientId === null) {
      throw new ValidationError("harnessId", "节点未绑定客户端");
    }
    if (!harness.enabled) throw new ValidationError("harnessId", "节点已停用");
    const clientId = harness.clientId;
    const workspacePath = ensureAbsolutePath("workspacePath", input.workspacePath);
    const existing = await deps.instance.getByBinding(clientId, workspacePath);
    if (existing !== null && existing.state === "retired") {
      throw new ValidationError("workspacePath", "实例已回收");
    }
    const instance =
      existing ??
      (await deps.instance.enroll({
        instanceId: deps.ids.next(),
        clientId,
        workspacePath,
      }));
    const active = await store.findActiveByInstance(deps.db, instance.instanceId);
    if (active !== null) throw new RunConflictError(instance.instanceId);
    const runId = deps.ids.next();
    const start = startNode(graph);
    if (start === null) throw new ValidationError("graph.nodes", "缺少开始节点");
    const now = deps.clock.now();
    const taskSpacePath = taskSpaceFor(workspacePath, runId);
    await deps.db.transaction(async (tx) => {
      await store.insertRun(tx, {
        id: runId,
        workflowId: input.workflowId,
        workflowRevision: workflow.revision,
        graphSnapshot: graph,
        intentMarkdown: input.intentMarkdown,
        harnessId: input.harnessId,
        clientId,
        instanceId: instance.instanceId,
        workspacePath,
        taskSpacePath,
        autoConfirm: input.autoConfirm ?? false,
        now,
        actor: input.actor ?? null,
      });
      await store.insertNode(tx, {
        runId,
        nodeId: start.id,
        visit: 1,
        nodeType: start.type,
        expertId: start.expertId,
        state: "queued",
        now,
      });
      await store.setCurrentNode(tx, runId, start.id, now);
    });
    await advance(runId);
    return get(runId);
  }

  async function advance(runId: string): Promise<void> {
    await withLock(runId, () => advanceLocked(runId));
  }

  async function get(runId: string): Promise<RunDetail> {
    const run = await loadRun(runId);
    return detailOf(run, await store.listNodes(deps.db, run.id));
  }

  async function list(query: Parameters<RunService["list"]>[0]): Promise<Page<RunSummary>> {
    const page = normalizePageQuery(query.page.limit, query.page.offset);
    const { rows, total } = await store.listRuns(deps.db, {
      ...(query.workflowId === undefined ? {} : { workflowId: query.workflowId }),
      ...(query.state === undefined ? {} : { state: query.state }),
      limit: page.limit,
      offset: page.offset,
    });
    return { items: rows.map(toRunSummary), total, limit: page.limit, offset: page.offset };
  }

  async function decide(input: DecideInput): Promise<RunDetail> {
    const run = await loadRun(input.runId);
    if (run.state === "done") throw new InvalidStateError("run 已结束");
    const row = await store.findNode(deps.db, run.id, input.nodeId);
    if (row === null) throw new NotFoundError("run_node", `${run.id}/${input.nodeId}`);
    if (row.state === "succeeded" && input.decision === "pass") return get(run.id);
    if (row.state === "rejected" && input.decision === "reject") return get(run.id);
    if (row.state !== "waiting_confirm") throw new InvalidStateError("节点不在 waiting_confirm");
    const node = nodeById(graphFor(run), row.node_id);
    if (node === null) throw new NotFoundError("节点", row.node_id);
    await withLock(run.id, async () => {
      const fresh = await loadRun(run.id);
      if (input.decision === "pass") {
        await settleNode(fresh, node, row, { state: "succeeded", message: input.comment ?? "" });
        await deps.db.transaction((tx) =>
          store.setRunProgress(tx, run.id, {
            state: "running",
            currentNodeId: run.current_node_id,
            now: deps.clock.now(),
          }),
        );
        await advanceLocked(run.id);
      } else {
        await settleNode(fresh, node, row, {
          state: "rejected",
          message: input.comment ?? "",
          verdict: input.comment === undefined ? null : { decision: "reject", comment: input.comment },
        });
        await advanceLocked(run.id);
      }
    });
    return get(run.id);
  }

  async function cancel(runId: string, actor?: string): Promise<RunDetail> {
    const run = await loadRun(runId);
    if (run.state === "done") return get(run.id);
    await withLock(run.id, async () => {
      const fresh = await loadRun(run.id);
      if (fresh.state === "done") return;
      const row =
        fresh.current_node_id === null
          ? null
          : await store.findNode(deps.db, fresh.id, fresh.current_node_id);
      if (row !== null && row.state !== "succeeded" && row.state !== "rejected" && row.state !== "failed") {
        const node = nodeById(graphFor(fresh), row.node_id);
        if (node !== null) {
          await settleNode(fresh, node, row, {
            state: "failed",
            message: actor === undefined ? "运行已取消" : `运行已取消（${actor}）`,
            error: { code: "cancelled", message: "运行已取消" },
          });
        }
      }
      await finish(fresh.id, "cancelled", { code: "cancelled", message: "运行已取消" }, null);
    });
    await deps.scheduler.cancelInstances([run.instance_id]);
    return get(run.id);
  }

  async function attachSessionLog(input: SessionLogInput): Promise<{ stored: StoredState }> {
    const row = await store.findNodeByTask(deps.db, input.taskId);
    if (row === null) throw new TaskNotFoundError(input.taskId);
    const attempt = ensureAttempt(input.attempt);
    if (input.bytes.byteLength > MAX_SESSION_LOG_BYTES) {
      throw new PayloadTooLargeError("session_log_bytes", MAX_SESSION_LOG_BYTES, input.bytes.byteLength);
    }
    if (input.bytes[0] !== 0x1f || input.bytes[1] !== 0x8b) {
      throw new ValidationError("bytes", "必须是 gzip 压缩的 ndjson");
    }
    const existing = await store.findArtifact(deps.db, {
      runId: row.run_id,
      kind: "session_log",
      nodeId: row.node_id,
      visit: row.visit,
      attempt,
    });
    if (existing !== null && existing.sha256 === input.sha256) return { stored: "unchanged" };
    const key = `runs/${row.run_id}/nodes/${row.node_id}-${row.visit}-a${attempt}.jsonl.gz`;
    await deps.fileStore.put(key, input.bytes);
    const now = deps.clock.now();
    await deps.db.transaction((tx) =>
      store.insertArtifact(tx, {
        id: deps.ids.next(),
        runId: row.run_id,
        nodeId: row.node_id,
        visit: row.visit,
        attempt,
        kind: "session_log",
        storeKey: key,
        sizeBytes: input.bytes.byteLength,
        sha256: input.sha256,
        now,
      }),
    );
    return { stored: existing === null ? "created" : "replaced" };
  }

  async function storeArchive(input: ArchiveInput): Promise<{ stored: StoredState }> {
    const run = await loadRun(input.runId);
    const instance = await deps.instance.get(run.instance_id);
    if (instance === null || instance.clientId !== input.clientId) {
      throw new RunNotFoundError(input.runId);
    }
    if (run.state !== "done") throw new InvalidStateError("run 未进入终态");
    if (input.bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new PayloadTooLargeError("archive_bytes", MAX_ARCHIVE_BYTES, input.bytes.byteLength);
    }
    inspectArchive(input.bytes, {
      maxEntries: MAX_ARCHIVE_ENTRIES,
      maxUncompressedBytes: MAX_ARCHIVE_UNCOMPRESSED_BYTES,
    });
    const existing = await store.findArtifact(deps.db, { runId: run.id, kind: "archive" });
    if (existing !== null && existing.sha256 === input.sha256) return { stored: "unchanged" };
    const key = `history/${run.instance_id}/${run.id}/task-space.tar.gz`;
    await deps.fileStore.put(key, input.bytes);
    const logs = await store.listArtifacts(deps.db, run.id, "session_log");
    for (const log of logs) {
      if (log.node_id === null || log.visit === null || log.attempt === null) continue;
      const stream = await deps.fileStore.get(log.store_key);
      const data = new Uint8Array(await new Response(stream).arrayBuffer());
      await deps.fileStore.put(
        `history/${run.instance_id}/${run.id}/logs/${log.node_id}-${log.visit}-a${log.attempt}.jsonl.gz`,
        data,
      );
    }
    const now = deps.clock.now();
    await deps.db.transaction(async (tx) => {
      await store.replaceArchiveArtifact(tx, {
        id: deps.ids.next(),
        runId: run.id,
        nodeId: null,
        visit: null,
        attempt: null,
        kind: "archive",
        storeKey: key,
        sizeBytes: input.bytes.byteLength,
        sha256: input.sha256,
        now,
      });
      await store.markArchived(tx, run.id, "stored", now);
    });
    return { stored: existing === null ? "created" : "replaced" };
  }

  async function archiveRequestsFor(clientId: string): Promise<{ runId: string; instanceId: string; workspacePath: string; taskSpacePath: string }[]> {
    const rows = await store.listArchivePending(deps.db, clientId);
    return rows.map((row) => ({
      runId: row.id,
      instanceId: row.instance_id,
      workspacePath: row.workspace_path,
      taskSpacePath: row.task_space_path,
    }));
  }

  async function ackArchived(clientId: string, runIds: string[]): Promise<void> {
    await deps.db.transaction((tx) => store.ackArchived(tx, clientId, runIds, deps.clock.now()));
  }

  async function readSessionLog(input: {
    runId: string;
    nodeId: string;
    visit?: number;
    attempt?: number;
  }): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes: number } | null> {
    const artifact = await store.findArtifact(deps.db, {
      runId: input.runId,
      kind: "session_log",
      nodeId: input.nodeId,
      ...(input.visit === undefined ? {} : { visit: input.visit }),
      ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
    });
    if (artifact === null) return null;
    return { stream: await deps.fileStore.get(artifact.store_key), sizeBytes: artifact.size_bytes };
  }

  async function resumePending(): Promise<{ resumed: number }> {
    const runs = await store.listActive(deps.db);
    let resumed = 0;
    for (const run of runs) {
      if (run.current_node_id === null) continue;
      const row = await store.findNode(deps.db, run.id, run.current_node_id);
      if (row === null) continue;
      if (row.state === "waiting_confirm") continue;
      if (row.state === "dispatched" && row.task_id !== null) {
        const snapshot = await deps.scheduler.inspect(row.task_id);
        if (snapshot.state !== "done") continue;
        const status =
          snapshot.outcome === "succeeded"
            ? "succeeded"
            : snapshot.outcome === "cancelled"
              ? "cancelled"
              : snapshot.outcome === "timeout"
                ? "timeout"
                : "failed";
        const node = nodeById(graphFor(run), row.node_id);
        if (node === null) continue;
        const fresh = await loadRun(run.id);
        await applyResult(fresh, row, {
          status,
          message: "",
          error:
            snapshot.outcome === "succeeded" || snapshot.outcome === "cancelled"
              ? null
              : { code: "recovered", message: "重启对账补结算" },
        });
        if ((await loadRun(run.id)).state !== "done") await advance(run.id);
        resumed += 1;
        continue;
      }
      await advance(run.id);
      resumed += 1;
    }
    return { resumed };
  }

  return {
    start,
    advance,
    handleTaskResult,
    attachSessionLog,
    storeArchive,
    archiveRequestsFor,
    ackArchived,
    decide,
    cancel,
    get,
    list,
    readSessionLog,
    resumePending,
  };
}
