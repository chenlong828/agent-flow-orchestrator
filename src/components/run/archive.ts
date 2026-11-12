import { InvalidArchiveError } from "../../core/kernel/index.ts";

export type ArchiveInspection = { entries: number; uncompressedBytes: number };

function readSize(header: Uint8Array): number {
  const raw = new TextDecoder().decode(header.subarray(124, 136)).replace(/\0.*$/, "").trim();
  if (raw === "") return 0;
  const value = Number.parseInt(raw, 8);
  if (!Number.isFinite(value) || value < 0) throw new InvalidArchiveError("size");
  return value;
}

function readName(header: Uint8Array): string {
  const name = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0.*$/, "");
  const prefix = new TextDecoder().decode(header.subarray(345, 500)).replace(/\0.*$/, "");
  return prefix === "" ? name : `${prefix}/${name}`;
}

function assertSafePath(name: string): void {
  if (name === "" || name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name)) {
    throw new InvalidArchiveError("absolute_path");
  }
  const segments = name.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new InvalidArchiveError("path_traversal");
  }
}

/** 校验 tar.gz：路径安全、条目数、解压总量；不解压到磁盘。 */
export function inspectArchive(
  bytes: Uint8Array,
  limits: { maxEntries: number; maxUncompressedBytes: number },
): ArchiveInspection {
  let tar: Uint8Array;
  try {
    tar = Bun.gunzipSync(new Uint8Array(bytes));
  } catch {
    throw new InvalidArchiveError("gzip");
  }
  let offset = 0;
  let entries = 0;
  let uncompressedBytes = 0;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readName(header);
    const size = readSize(header);
    const type = String.fromCharCode(header[156] ?? 48);
    if (type !== "0" && type !== "\0" && type !== "5" && type !== "x" && type !== "L") {
      throw new InvalidArchiveError(`entry_type_${type}`);
    }
    if (type !== "x" && type !== "L") {
      assertSafePath(name);
      entries += 1;
      uncompressedBytes += size;
      if (entries > limits.maxEntries) throw new InvalidArchiveError("entry_count");
      if (uncompressedBytes > limits.maxUncompressedBytes) {
        throw new InvalidArchiveError("uncompressed_bytes");
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return { entries, uncompressedBytes };
}
