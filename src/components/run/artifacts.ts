import {
  InvalidStateError,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_SESSION_LOG_BYTES,
  PayloadTooLargeError,
  RunNotFoundError,
  TaskNotFoundError,
  ValidationError,
} from "../../core/kernel/index.ts";
import { inspectArchive } from "./archive.ts";
import type { ArchiveInput, SessionLogInput } from "./types.ts";
import type { RunRuntime } from "./runtime.ts";
import { ensureAttempt } from "./validate.ts";

async function copyArchiveLogs(runtime: RunRuntime, runId: string, instanceId: string): Promise<void> {
  const logs = await runtime.store.listArtifacts(runtime.deps.db, runId, "session_log");
  for (const log of logs) {
    if (log.node_id === null || log.visit === null || log.attempt === null) continue;
    const stream = await runtime.deps.fileStore.get(log.store_key);
    const data = new Uint8Array(await new Response(stream).arrayBuffer());
    await runtime.deps.fileStore.put(
      `history/${instanceId}/${runId}/logs/${log.node_id}-${log.visit}-a${log.attempt}.jsonl.gz`,
      data,
    );
  }
}

async function attachSessionLog(
  runtime: RunRuntime,
  input: SessionLogInput,
): Promise<{ stored: "created" | "replaced" | "unchanged" }> {
  const row = await runtime.store.findNodeByTask(runtime.deps.db, input.taskId);
  if (row === null) throw new TaskNotFoundError(input.taskId);
  const attempt = ensureAttempt(input.attempt);
  if (input.bytes.byteLength > MAX_SESSION_LOG_BYTES) {
    throw new PayloadTooLargeError(
      "session_log_bytes",
      MAX_SESSION_LOG_BYTES,
      input.bytes.byteLength,
    );
  }
  if (input.bytes[0] !== 0x1f || input.bytes[1] !== 0x8b) {
    throw new ValidationError("bytes", "必须是 gzip 压缩的 ndjson");
  }
  const existing = await runtime.store.findArtifact(runtime.deps.db, {
    runId: row.run_id,
    kind: "session_log",
    nodeId: row.node_id,
    visit: row.visit,
    attempt,
  });
  if (existing !== null && existing.sha256 === input.sha256) return { stored: "unchanged" };
  const key = `runs/${row.run_id}/nodes/${row.node_id}-${row.visit}-a${attempt}.jsonl.gz`;
  await runtime.deps.fileStore.put(key, input.bytes);
  const now = runtime.deps.clock.now();
  await runtime.deps.db.transaction((tx) =>
    runtime.store.insertArtifact(tx, {
      id: runtime.deps.ids.next(),
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

async function storeArchive(
  runtime: RunRuntime,
  input: ArchiveInput,
): Promise<{ stored: "created" | "replaced" | "unchanged" }> {
  const run = await runtime.loadRun(input.runId);
  const instance = await runtime.deps.instance.get(run.instance_id);
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
  const existing = await runtime.store.findArtifact(runtime.deps.db, {
    runId: run.id,
    kind: "archive",
  });
  if (existing !== null && existing.sha256 === input.sha256) return { stored: "unchanged" };
  const key = `history/${run.instance_id}/${run.id}/task-space.tar.gz`;
  await runtime.deps.fileStore.put(key, input.bytes);
  await copyArchiveLogs(runtime, run.id, run.instance_id);
  const now = runtime.deps.clock.now();
  await runtime.deps.db.transaction(async (tx) => {
    await runtime.store.replaceArchiveArtifact(tx, {
      id: runtime.deps.ids.next(),
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
    await runtime.store.markArchived(tx, run.id, "stored", now);
  });
  return { stored: existing === null ? "created" : "replaced" };
}

export function createArtifacts(runtime: RunRuntime) {
  return {
    attachSessionLog: (input: SessionLogInput) => attachSessionLog(runtime, input),
    storeArchive: (input: ArchiveInput) => storeArchive(runtime, input),

    async archiveRequestsFor(clientId: string) {
      const ttl = runtime.deps.archivePendingTtlMs ?? 600000;
      const cutoff = new Date(runtime.deps.clock.now().getTime() - ttl);
      await runtime.deps.db.transaction((tx) => runtime.store.expirePendingArchives(tx, cutoff));
      const rows = await runtime.store.listArchivePending(runtime.deps.db, clientId);
      return rows.map((row) => ({
        runId: row.id,
        instanceId: row.instance_id,
        workspacePath: row.workspace_path,
        taskSpacePath: row.task_space_path,
      }));
    },

    async ackArchived(clientId: string, runIds: string[]): Promise<void> {
      await runtime.deps.db.transaction((tx) =>
        runtime.store.ackArchived(tx, clientId, runIds, runtime.deps.clock.now()),
      );
    },

    async readSessionLog(input: {
      runId: string;
      nodeId: string;
      visit?: number;
      attempt?: number;
    }) {
      const artifact = await runtime.store.findArtifact(runtime.deps.db, {
        runId: input.runId,
        kind: "session_log",
        nodeId: input.nodeId,
        ...(input.visit === undefined ? {} : { visit: input.visit }),
        ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
      });
      if (artifact === null) return null;
      return {
        stream: await runtime.deps.fileStore.get(artifact.store_key),
        sizeBytes: artifact.size_bytes,
        sha256: artifact.sha256,
      };
    },
  };
}
