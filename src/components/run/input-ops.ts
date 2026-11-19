import {
  ClientUnsupportedError,
  InputNotFoundError,
  InvalidStateError,
  PayloadTooLargeError,
  RunNotFoundError,
  ValidationError,
  toIso,
} from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import type { RunCore } from "./core.ts";
import { sanitizeInputName, sha256Hex, sniffMediaType } from "./inputs.ts";
import type {
  ExecutorRunInputRef,
  RunInputContent,
  RunInputMediaType,
  RunInputStaged,
  RunInputUpload,
  RunInputView,
} from "./types.ts";
import type { RunInputRow } from "./store-input.ts";

function mediaTypeOf(row: RunInputRow): RunInputMediaType {
  return row.media_type;
}

function viewOf(row: RunInputRow): RunInputView {
  return {
    inputId: row.id,
    name: row.name,
    mediaType: mediaTypeOf(row),
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    createdAt: toIso(row.created_at),
  };
}

function downloadPath(runId: string, inputId: string): string {
  return `/runs/${encodeURIComponent(runId)}/inputs/${encodeURIComponent(inputId)}`;
}

async function stageInput(core: RunCore, input: RunInputUpload): Promise<RunInputStaged> {
  const { deps, store } = core;
  if (input.bytes.byteLength === 0) throw new ValidationError("file", "图片不能为空");
  if (input.bytes.byteLength > deps.maxInputFileBytes) {
    throw new PayloadTooLargeError("run_input_file_bytes", deps.maxInputFileBytes, input.bytes.byteLength);
  }
  const mediaType = sniffMediaType(input.bytes);
  if (mediaType === null) throw new ValidationError("file", "只支持 PNG/JPEG/WebP/GIF 图片");

  const inputId = deps.ids.next();
  const storeKey = `inputs/${inputId}`;
  const name = sanitizeInputName(input.name, mediaType);
  await deps.fileStore.put(storeKey, input.bytes);
  try {
    await store.insertInput(deps.db, {
      id: inputId,
      runId: null,
      position: null,
      name,
      mediaType,
      sizeBytes: input.bytes.byteLength,
      sha256: sha256Hex(input.bytes),
      storeKey,
      state: "staged",
      now: deps.clock.now(),
    });
  } catch (error) {
    await deps.fileStore.delete(storeKey).catch(() => undefined);
    throw error;
  }
  const row = await store.findInput(deps.db, inputId);
  if (row === null) throw new Error("暂存初始资料写入后未找到");
  return viewOf(row);
}

async function deleteStagedInput(core: RunCore, inputId: string): Promise<void> {
  const { deps, store } = core;
  const row = await store.findInput(deps.db, inputId);
  if (row === null) throw new InputNotFoundError(inputId);
  if (row.state !== "staged") throw new InvalidStateError("input_bound");
  const deleted = await store.deleteStagedInput(deps.db, inputId);
  if (deleted !== null) await deps.fileStore.delete(deleted.store_key).catch(() => undefined);
}

async function listInputs(core: RunCore, runId: string): Promise<RunInputView[]> {
  await core.loadRun(runId);
  return (await core.store.listBoundInputs(core.deps.db, runId)).map(viewOf);
}

async function readContent(core: RunCore, row: RunInputRow): Promise<RunInputContent> {
  return {
    stream: await core.deps.fileStore.get(row.store_key),
    sizeBytes: Number(row.size_bytes),
    mediaType: mediaTypeOf(row),
    sha256: row.sha256,
    name: row.name,
  };
}

async function readInput(core: RunCore, runId: string, inputId: string): Promise<RunInputContent> {
  await core.loadRun(runId);
  const row = await core.store.findBoundInput(core.deps.db, runId, inputId);
  if (row === null) throw new InputNotFoundError(inputId);
  return await readContent(core, row);
}

async function listExecutorInputs(
  core: RunCore,
  clientId: string,
  runId: string,
): Promise<ExecutorRunInputRef[]> {
  const run = await core.loadRun(runId);
  if (run.client_id !== clientId) throw new RunNotFoundError(runId);
  return (await core.store.listBoundInputs(core.deps.db, runId)).map((row) => ({
    ...viewOf(row),
    downloadPath: downloadPath(runId, row.id),
  }));
}

async function readExecutorInput(
  core: RunCore,
  clientId: string,
  runId: string,
  inputId: string,
): Promise<RunInputContent> {
  const run = await core.loadRun(runId);
  if (run.client_id !== clientId) throw new RunNotFoundError(runId);
  const row = await core.store.findBoundInput(core.deps.db, runId, inputId);
  if (row === null) throw new InputNotFoundError(inputId);
  return await readContent(core, row);
}

async function ensureClientSupports(core: RunCore, clientId: string): Promise<void> {
  const [presence] = await core.deps.scheduler.presence([clientId]);
  if (presence === undefined || presence.lastPollAt === null) {
    throw new ClientUnsupportedError("run-inputs", "client_not_seen");
  }
  if (!(presence.capabilities ?? []).includes("run-inputs")) {
    throw new ClientUnsupportedError("run-inputs", "capability_missing");
  }
}

async function bindForStart(
  core: RunCore,
  tx: Db,
  runId: string,
  refs: { inputId: string }[],
  now: Date,
): Promise<void> {
  if (refs.length === 0) return;
  if (refs.length > core.deps.maxInputFiles) {
    throw new PayloadTooLargeError("run_input_count", core.deps.maxInputFiles, refs.length);
  }
  const ids = refs.map((ref) => ref.inputId);
  if (new Set(ids).size !== ids.length) throw new ValidationError("inputs", "inputId 不能重复");
  const rows = await core.store.lockInputs(tx, ids);
  if (rows.length !== ids.length) throw new ValidationError("inputs", "包含不存在的暂存项");
  const byId = new Map(rows.map((row) => [row.id, row]));
  let total = 0;
  for (const id of ids) {
    const row = byId.get(id);
    if (row === undefined) throw new ValidationError("inputs", "包含不存在的暂存项");
    if (row.state !== "staged") throw new ValidationError("inputs", "包含已绑定的暂存项");
    total += Number(row.size_bytes);
  }
  if (total > core.deps.maxInputBytes) {
    throw new PayloadTooLargeError("run_input_bytes", core.deps.maxInputBytes, total);
  }
  const used = new Set<string>();
  for (let index = 0; index < refs.length; index += 1) {
    const id = refs[index]?.inputId;
    const row = id === undefined ? undefined : byId.get(id);
    if (id === undefined || row === undefined) continue;
    const name = sanitizeInputName(row.name, row.media_type, used);
    await core.store.bindInput(tx, id, { runId, position: index + 1, name, now });
  }
}

export function createInputOps(core: RunCore) {
  return {
    stageInput: (input: RunInputUpload) => stageInput(core, input),
    deleteStagedInput: (inputId: string) => deleteStagedInput(core, inputId),
    listInputs: (runId: string) => listInputs(core, runId),
    readInput: (runId: string, inputId: string) => readInput(core, runId, inputId),
    listExecutorInputs: (clientId: string, runId: string) => listExecutorInputs(core, clientId, runId),
    readExecutorInput: (clientId: string, runId: string, inputId: string) =>
      readExecutorInput(core, clientId, runId, inputId),
    ensureClientSupports: (clientId: string) => ensureClientSupports(core, clientId),
    bindForStart: (tx: Db, runId: string, refs: { inputId: string }[], now: Date) =>
      bindForStart(core, tx, runId, refs, now),
  };
}

export type InputOps = ReturnType<typeof createInputOps>;
