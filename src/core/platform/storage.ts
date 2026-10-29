import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FileData, FileStat, FileStore } from "../kernel/index.ts";

/** 平台内部存储错误；不映射为业务错误，由调用方决定是否转 HTTP。 */
export class StorageError extends Error {
  readonly operation: string;
  readonly key?: string;

  constructor(
    operation: string,
    message: string,
    key?: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StorageError";
    this.operation = operation;
    this.key = key;
  }
}

export type FileStoreFactory = {
  create(root: string): FileStore;
};

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function wrap(
  operation: string,
  key: string | undefined,
  error: unknown,
  message?: string,
): StorageError {
  if (error instanceof StorageError) return error;
  const suffix = error instanceof Error ? `：${error.message}` : "";
  return new StorageError(
    operation,
    message ?? `文件存储 ${operation} 失败${suffix}`,
    key,
    error,
  );
}

function validateKey(key: string, operation: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new StorageError(operation, "存储键不能为空", key);
  }
  if (key.startsWith("/")) {
    throw new StorageError(operation, `存储键不能是绝对路径：${key}`, key);
  }
  if (key.includes("\\")) {
    throw new StorageError(operation, `存储键不能包含反斜杠：${key}`, key);
  }
  if (CONTROL_CHARACTER.test(key)) {
    throw new StorageError(operation, "存储键不能包含控制字符", key);
  }
  const parts = key.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new StorageError(operation, `存储键包含非法路径段：${key}`, key);
  }
  return key;
}

function normalizePrefix(prefix: string): string {
  if (prefix === "") return "";
  if (prefix.startsWith("/")) {
    throw new StorageError("list", `前缀不能是绝对路径：${prefix}`, prefix);
  }
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (normalized === "") {
    throw new StorageError("list", "前缀不能是根目录", prefix);
  }
  return validateKey(normalized, "list");
}

function targetPath(root: string, key: string, operation: string): string {
  return join(root, ...validateKey(key, operation).split("/"));
}

function fileStat(key: string, value: { size: number; mtime: Date }): FileStat {
  return { key, size: value.size, modifiedAt: value.mtime };
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAll(handle: FileHandle, data: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < data.byteLength) {
    const { bytesWritten } = await handle.write(
      data,
      offset,
      data.byteLength - offset,
      null,
    );
    if (bytesWritten === 0) throw new Error("写入返回 0 字节");
    offset += bytesWritten;
  }
}

async function writeData(handle: FileHandle, data: FileData): Promise<void> {
  if (data instanceof Uint8Array) {
    await handle.writeFile(data);
    return;
  }
  if (typeof data !== "object" || data === null || !("getReader" in data)) {
    throw new TypeError("FileData 必须是 Uint8Array 或 ReadableStream");
  }
  const reader = data.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) await writeAll(handle, value);
    }
  } finally {
    reader.releaseLock();
  }
}

class FileStoreImpl implements FileStore {
  constructor(private readonly root: string) {}

  async put(key: string, data: FileData): Promise<void> {
    const target = targetPath(this.root, key, "put");
    let handle: FileHandle | undefined;
    let temporary: string | undefined;
    try {
      await mkdir(dirname(target), { recursive: true });
      temporary = join(dirname(target), `.tmp-${randomUUID()}`);
      handle = await open(temporary, "w");
      await writeData(handle, data);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, target);
      temporary = undefined;
      await syncDirectory(dirname(target));
    } catch (error) {
      if (handle !== undefined) {
        await handle.close().catch(() => undefined);
      }
      if (temporary !== undefined) {
        await unlink(temporary).catch(() => undefined);
      }
      throw wrap("put", key, error);
    }
  }

  async get(key: string): Promise<ReadableStream<Uint8Array>> {
    const path = targetPath(this.root, key, "get");
    try {
      const info = await stat(path);
      if (!info.isFile()) {
        throw new StorageError("get", `不是文件：${key}`, key);
      }
      return Bun.file(path).stream();
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (isNotFound(error)) {
        throw new StorageError("get", `文件不存在：${key}`, key, error);
      }
      throw wrap("get", key, error);
    }
  }

  async head(key: string): Promise<FileStat | null> {
    const path = targetPath(this.root, key, "head");
    try {
      const info = await stat(path);
      return info.isFile() ? fileStat(key, info) : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw wrap("head", key, error);
    }
  }

  async list(prefix: string): Promise<FileStat[]> {
    const normalized = normalizePrefix(prefix);
    const base =
      normalized === ""
        ? this.root
        : targetPath(this.root, normalized, "list");
    const files: FileStat[] = [];

    const walk = async (directory: string, relative: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const childKey = relative === "" ? entry.name : `${relative}/${entry.name}`;
        const childPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(childPath, childKey);
        } else if (entry.isFile()) {
          files.push(fileStat(childKey, await stat(childPath)));
        }
      }
    };

    try {
      const info = await stat(base).catch((error) => {
        if (isNotFound(error)) return null;
        throw error;
      });
      if (info === null) return [];
      if (info.isFile()) return [fileStat(normalized, info)];
      if (!info.isDirectory()) return [];
      await walk(base, normalized === "" ? "" : normalized);
      return files.sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      );
    } catch (error) {
      throw wrap("list", normalized, error);
    }
  }

  async delete(key: string): Promise<void> {
    const path = targetPath(this.root, key, "delete");
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (isNotFound(error)) return;
      throw wrap("delete", key, error);
    }

    try {
      if (info.isDirectory()) {
        await rmdir(path);
      } else {
        await unlink(path);
      }
    } catch (error) {
      throw wrap("delete", key, error);
    }
  }

  async move(from: string, to: string): Promise<void> {
    const source = targetPath(this.root, from, "move");
    const target = targetPath(this.root, to, "move");
    try {
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
      await syncDirectory(dirname(source));
      const targetDirectory = dirname(target);
      if (targetDirectory !== dirname(source)) {
        await syncDirectory(targetDirectory);
      }
    } catch (error) {
      throw wrap("move", from, error);
    }
  }
}

/** 根目录在 create 时创建；之后所有键都相对于该根。 */
export function createFileStore(root: string): FileStore {
  if (typeof root !== "string" || root.trim() === "") {
    throw new StorageError("create", "存储根不能为空");
  }
  const resolved = resolve(root);
  try {
    mkdirSync(resolved, { recursive: true });
  } catch (error) {
    throw wrap("create", undefined, error, `无法创建存储根：${resolved}`);
  }
  return new FileStoreImpl(resolved);
}

export const fileStoreFactory: FileStoreFactory = {
  create: createFileStore,
};
