import {
  FileConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
  type FileData,
} from "../../core/kernel/index.ts";
import type { DraftFileResult } from "./contract.ts";
import {
  FILE_LIMIT_BYTES,
  FILE_LIMIT_COUNT,
  PACKAGE_LIMIT_BYTES,
  SKILL_MD,
  SKILL_MD_LIMIT_BYTES,
} from "./package.ts";
import { draftPrefix, attachmentPath, listFiles, readData, toFile } from "./draft-types.ts";
import type { SkillDraftDeps } from "./draft-types.ts";
import { requireDraft } from "./draft-drafts.ts";

async function requireFile(
  deps: SkillDraftDeps,
  id: string,
  path: string,
): Promise<void> {
  if ((await deps.store.head(`${draftPrefix(id)}/${path}`)) === null) {
    throw new NotFoundError("DraftFile", path);
  }
}

async function currentFiles(
  deps: SkillDraftDeps,
  id: string,
): Promise<Map<string, number>> {
  const files = await listFiles(deps.store, id);
  return new Map(files.map((file) => [file.path, file.size]));
}

export async function uploadDraftFile(
  deps: SkillDraftDeps,
  id: string,
  path: string,
  data: FileData,
): Promise<DraftFileResult> {
  await requireDraft(deps, id);
  const target = attachmentPath(path);
  const bytes = await readData(data);
  const files = await currentFiles(deps, id);
  const replacing = files.has(target);
  const count = files.size + (replacing ? 0 : 1);
  if (count > FILE_LIMIT_COUNT) {
    throw new PayloadTooLargeError("file_count", FILE_LIMIT_COUNT, count);
  }
  if (bytes.byteLength > FILE_LIMIT_BYTES) {
    throw new PayloadTooLargeError("file_bytes", FILE_LIMIT_BYTES, bytes.byteLength);
  }
  const sumWithoutTarget = [...files.entries()]
    .filter(([file]) => file !== target)
    .reduce((sum, [, size]) => sum + size, 0);
  const total =
    sumWithoutTarget + bytes.byteLength + (files.has(SKILL_MD) ? 0 : SKILL_MD_LIMIT_BYTES);
  if (total > PACKAGE_LIMIT_BYTES) {
    throw new PayloadTooLargeError("package_bytes", PACKAGE_LIMIT_BYTES, total);
  }

  await deps.store.put(`${draftPrefix(id)}/${target}`, bytes);
  const next = await listFiles(deps.store, id);
  return { file: toFile(target, bytes.byteLength), files: next };
}

export async function renameDraftFile(
  deps: SkillDraftDeps,
  id: string,
  path: string,
  newPath: string,
): Promise<DraftFileResult> {
  await requireDraft(deps, id);
  const source = attachmentPath(path);
  const target = attachmentPath(newPath);
  if (source === target) throw new ValidationError("newPath", "新旧路径不能相同");
  await requireFile(deps, id, source);
  if ((await deps.store.head(`${draftPrefix(id)}/${target}`)) !== null) {
    throw new FileConflictError(source, target);
  }
  await deps.store.move(`${draftPrefix(id)}/${source}`, `${draftPrefix(id)}/${target}`);
  const moved = await deps.store.head(`${draftPrefix(id)}/${target}`);
  if (moved === null) throw new NotFoundError("DraftFile", target);
  return {
    file: toFile(target, moved.size),
    files: await listFiles(deps.store, id),
  };
}

export async function deleteDraftFile(
  deps: SkillDraftDeps,
  id: string,
  path: string,
): Promise<void> {
  await requireDraft(deps, id);
  const target = attachmentPath(path);
  await requireFile(deps, id, target);
  await deps.store.delete(`${draftPrefix(id)}/${target}`);
}
