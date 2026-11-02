import { posix } from "node:path";
import {
  PackageUnavailableError,
  ValidationError,
  type Clock,
  type FileData,
  type FileStore,
  type IdGenerator,
  type ReferenceGuard,
} from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import {
  SKILL_MD,
  readSkillPackage,
  validatePackagePath,
  type SkillPackageEntry,
} from "./package.ts";
import type { DraftFile, SaveSkill } from "./contract.ts";

export type DraftRow = {
  id: string;
  skill_id: string | null;
  base_revision: number | null;
  base_version: string | null;
  expires_at: Date | string;
  created_at: Date | string;
};

export type SkillRow = {
  id: string;
  package_key: string;
  version: string;
  revision: number;
};

export type CurrentSkill = {
  id: string;
  name: string;
  package_key: string;
  version: string;
  revision: number;
};

export type SkillDraftDeps = {
  db: Db;
  store: FileStore;
  clock: Clock;
  ids: IdGenerator;
  draftTtlHours: number;
  actor: string;
  guard: ReferenceGuard;
};

export function draftPrefix(id: string): string {
  return `drafts/${id}`;
}

export function toFile(path: string, size: number): DraftFile {
  return { path, size, readOnly: path === SKILL_MD };
}

export async function readData(data: FileData): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await new Response(data).arrayBuffer());
}

export async function listFiles(store: FileStore, id: string): Promise<DraftFile[]> {
  const prefix = draftPrefix(id);
  const files = await store.list(prefix);
  return files
    .map((file) => {
      const path = file.key.slice(prefix.length + 1);
      return toFile(path, file.size);
    })
    .sort((left, right) => {
      if (left.path === SKILL_MD) return -1;
      if (right.path === SKILL_MD) return 1;
      return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    });
}

export async function ensureDraftDirectory(store: FileStore, id: string): Promise<void> {
  const prefix = draftPrefix(id);
  const marker = `${prefix}/.keep`;
  await store.put(marker, new Uint8Array());
  await store.delete(marker);
}

export async function removeDraftTree(store: FileStore, id: string): Promise<void> {
  const prefix = draftPrefix(id);
  const files = await store.list(prefix);
  for (const file of files) await store.delete(file.key);
  const directories = new Set<string>();
  for (const file of files) {
    let directory = posix.dirname(file.key);
    while (directory !== prefix && directory !== ".") {
      directories.add(directory);
      directory = posix.dirname(directory);
    }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    await store.delete(directory);
  }
  await store.delete(prefix);
}

export function attachmentPath(path: string): string {
  if (path === SKILL_MD) {
    throw new ValidationError("path", "SKILL.md 由服务端生成，不能作为附件");
  }
  return validatePackagePath(path);
}

export async function readPackage(
  store: FileStore,
  skill: SkillRow,
): Promise<SkillPackageEntry[]> {
  try {
    const data = new Uint8Array(
      await new Response(await store.get(`packages/${skill.package_key}`)).arrayBuffer(),
    );
    return readSkillPackage(data);
  } catch (error) {
    throw new PackageUnavailableError(skill.id, error);
  }
}

export function nextVersion(version: string): string {
  const match = /^v([0-9]+)\.([0-9]+)$/.exec(version);
  if (match === null) throw new ValidationError("version", `版本号不合法：${version}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return minor === 9 ? `v${major + 1}.0` : `v${major}.${minor + 1}`;
}

export function normalizeSave(input: SaveSkill): {
  name: string;
  categoryCode: string;
  description: string;
  tags: string[];
  body: string;
} {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > 80) {
    throw new ValidationError("name", "长度必须在 1 到 80 之间");
  }
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  if (description.length < 1 || description.length > 400) {
    throw new ValidationError("description", "长度必须在 1 到 400 之间");
  }
  const categoryCode =
    typeof input.categoryCode === "string" ? input.categoryCode.trim() : "";
  if (categoryCode.length < 1 || categoryCode.length > 50) {
    throw new ValidationError("categoryCode", "长度必须在 1 到 50 之间");
  }
  if (typeof input.body !== "string") {
    throw new ValidationError("body", "必须是字符串");
  }
  if (input.tags !== undefined && !Array.isArray(input.tags)) {
    throw new ValidationError("tags", "必须是数组");
  }
  const tags = (input.tags ?? []).map((tag) => {
    if (typeof tag !== "string" || tag.trim() === "") {
      throw new ValidationError("tags", "标签不能为空");
    }
    return tag.trim();
  });
  return {
    name,
    categoryCode,
    description,
    tags: [...new Set(tags)],
    body: input.body,
  };
}
