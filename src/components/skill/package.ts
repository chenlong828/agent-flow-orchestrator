import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  PayloadTooLargeError,
  SkillMdTooLargeError,
  ValidationError,
} from "../../core/kernel/index.ts";

export const SKILL_MD = "SKILL.md";
export const SKILL_MD_LIMIT_BYTES = 16_384;
export const FILE_LIMIT_BYTES = 20 * 1024 * 1024;
export const FILE_LIMIT_COUNT = 100;
export const PACKAGE_LIMIT_BYTES = 100 * 1024 * 1024;
const PATH_LIMIT_BYTES = 512;
const PATH_SEGMENT_LIMIT_BYTES = 255;

export type SkillMarkdownInput = {
  name: string;
  description: string;
  version: string;
  body: string;
};

export type SkillPackageFile = {
  path: string;
  data: Uint8Array;
};

export type SkillPackageInput = SkillMarkdownInput & {
  files?: SkillPackageFile[];
};

export type SkillPackageEntry = {
  path: string;
  data: Uint8Array;
};

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const VERSION = /^v[0-9]+\.[0-9]+$/;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function yamlScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

function normalizeBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

export function validatePackagePath(path: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new ValidationError("path", "包内路径不能为空");
  }
  if (utf8Length(path) > PATH_LIMIT_BYTES) {
    throw new ValidationError("path", `包内路径不能超过 ${PATH_LIMIT_BYTES} 字节`);
  }
  if (path.startsWith("/") || path.endsWith("/") || path.includes("\\")) {
    throw new ValidationError("path", `包内路径必须是相对 POSIX 路径：${path}`);
  }
  if (CONTROL_CHARACTER.test(path)) {
    throw new ValidationError("path", "包内路径不能包含控制字符");
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        utf8Length(segment) > PATH_SEGMENT_LIMIT_BYTES,
    )
  ) {
    throw new ValidationError("path", `包内路径包含非法路径段：${path}`);
  }
  if (path !== SKILL_MD && !path.startsWith("scripts/") && !path.startsWith("references/")) {
    throw new ValidationError(
      "path",
      `附件只能放在 scripts/ 或 references/ 下：${path}`,
    );
  }
  return path;
}

export function buildSkillMarkdown(input: SkillMarkdownInput): string {
  if (input.name.trim() === "") throw new ValidationError("name", "不能为空");
  if (input.description.trim() === "") {
    throw new ValidationError("description", "不能为空");
  }
  if (!VERSION.test(input.version)) {
    throw new ValidationError("version", `版本号不合法：${input.version}`);
  }

  const body = normalizeBody(input.body);
  const markdown = [
    "---",
    `name: ${yamlScalar(input.name)}`,
    `description: ${yamlScalar(input.description)}`,
    `version: ${yamlScalar(input.version)}`,
    "---",
    body,
  ].join("\n");
  const content = `${markdown.replace(/\n+$/, "")}\n`;
  const actual = utf8Length(content);
  if (actual > SKILL_MD_LIMIT_BYTES) {
    throw new SkillMdTooLargeError(SKILL_MD_LIMIT_BYTES, actual);
  }
  return content;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    const entry = CRC_TABLE[(crc ^ byte) & 0xff];
    if (entry === undefined) throw new Error("CRC 表索引越界");
    crc = entry ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function writeUInt16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUInt32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function createZip(entries: SkillPackageEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const now = dosDateTime(new Date());
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const compressed = new Uint8Array(deflateRawSync(entry.data));
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(local.buffer);
    writeUInt32(localView, 0, 0x04034b50);
    writeUInt16(localView, 4, 20);
    writeUInt16(localView, 6, 0x0800);
    writeUInt16(localView, 8, 8);
    writeUInt16(localView, 10, now.time);
    writeUInt16(localView, 12, now.date);
    writeUInt32(localView, 14, crc);
    writeUInt32(localView, 18, compressed.byteLength);
    writeUInt32(localView, 22, entry.data.byteLength);
    writeUInt16(localView, 26, name.byteLength);
    writeUInt16(localView, 28, 0);
    local.set(name, 30);
    localParts.push(local, compressed);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    writeUInt32(centralView, 0, 0x02014b50);
    writeUInt16(centralView, 4, 20);
    writeUInt16(centralView, 6, 20);
    writeUInt16(centralView, 8, 0x0800);
    writeUInt16(centralView, 10, 8);
    writeUInt16(centralView, 12, now.time);
    writeUInt16(centralView, 14, now.date);
    writeUInt32(centralView, 16, crc);
    writeUInt32(centralView, 20, compressed.byteLength);
    writeUInt32(centralView, 24, entry.data.byteLength);
    writeUInt16(centralView, 28, name.byteLength);
    writeUInt16(centralView, 30, 0);
    writeUInt16(centralView, 32, 0);
    writeUInt16(centralView, 34, 0);
    writeUInt16(centralView, 36, 0);
    writeUInt32(centralView, 38, 0);
    writeUInt32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);

    localOffset += local.byteLength + compressed.byteLength;
  }

  const centralDirectory = concat(centralParts);
  const localFiles = concat(localParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUInt32(endView, 0, 0x06054b50);
  writeUInt16(endView, 4, 0);
  writeUInt16(endView, 6, 0);
  writeUInt16(endView, 8, entries.length);
  writeUInt16(endView, 10, entries.length);
  writeUInt32(endView, 12, centralDirectory.byteLength);
  writeUInt32(endView, 16, localFiles.byteLength);
  writeUInt16(endView, 20, 0);

  return concat([localFiles, centralDirectory, end]);
}

export function buildSkillPackage(input: SkillPackageInput): Uint8Array {
  const markdown = buildSkillMarkdown(input);
  const markdownBytes = new TextEncoder().encode(markdown);
  const files = input.files ?? [];

  if (files.length + 1 > FILE_LIMIT_COUNT) {
    throw new PayloadTooLargeError(
      "file_count",
      FILE_LIMIT_COUNT,
      files.length + 1,
    );
  }

  let totalBytes = markdownBytes.byteLength;
  const seen = new Set<string>([SKILL_MD]);
  const entries: SkillPackageEntry[] = [
    { path: SKILL_MD, data: markdownBytes },
  ];

  for (const file of files) {
    const path = validatePackagePath(file.path);
    if (seen.has(path)) {
      throw new ValidationError("path", `包内路径重复：${path}`);
    }
    seen.add(path);
    const size = file.data.byteLength;
    if (size > FILE_LIMIT_BYTES) {
      throw new PayloadTooLargeError("file_bytes", FILE_LIMIT_BYTES, size);
    }
    totalBytes += size;
    entries.push({ path, data: file.data });
  }

  if (totalBytes > PACKAGE_LIMIT_BYTES) {
    throw new PayloadTooLargeError("package_bytes", PACKAGE_LIMIT_BYTES, totalBytes);
  }

  return createZip(entries);
}

export type ParsedSkillMarkdown = SkillMarkdownInput;

function unyamlScalar(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    throw new ValidationError("frontmatter", "frontmatter 值必须是双引号标量");
  }
  return value
    .slice(1, -1)
    .replace(/\\(["\\rn])/g, (_match, escaped: string) => {
      if (escaped === "r") return "\r";
      if (escaped === "n") return "\n";
      return escaped;
    });
}

function requireFrontmatterValue(
  values: Map<string, string>,
  key: string,
): string {
  const value = values.get(key);
  if (value === undefined) {
    throw new ValidationError("frontmatter", `缺少 ${key}`);
  }
  return value;
}

export function parseSkillMarkdown(markdown: string): ParsedSkillMarkdown {
  const first = markdown.indexOf("\n");
  if (first === -1 || markdown.slice(0, first) !== "---") {
    throw new ValidationError("SKILL.md", "缺少 frontmatter");
  }
  const rest = markdown.slice(first + 1);
  const end = rest.indexOf("\n---");
  if (end === -1) throw new ValidationError("SKILL.md", "frontmatter 未闭合");

  const header = rest.slice(0, end);
  const bodyStart = rest.indexOf("\n", end + 4);
  const body = bodyStart === -1 ? "" : rest.slice(bodyStart + 1);
  const values = new Map<string, string>();
  for (const line of header.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new ValidationError("frontmatter", `无法解析行：${line}`);
    }
    const key = line.slice(0, separator);
    if (!["name", "description", "version"].includes(key)) {
      throw new ValidationError("frontmatter", `不允许的键：${key}`);
    }
    if (values.has(key)) {
      throw new ValidationError("frontmatter", `重复的键：${key}`);
    }
    values.set(key, unyamlScalar(line.slice(separator + 1).trim()));
  }
  if (values.size !== 3) {
    throw new ValidationError("frontmatter", "必须包含 name/description/version");
  }
  const name = requireFrontmatterValue(values, "name");
  const description = requireFrontmatterValue(values, "description");
  const version = requireFrontmatterValue(values, "version");
  if (!VERSION.test(version)) {
    throw new ValidationError("version", `版本号不合法：${version}`);
  }
  return { name, description, version, body };
}

function readUInt16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(
    offset,
    true,
  );
}

function readUInt32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    offset,
    true,
  );
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  const minimum = Math.max(0, data.byteLength - 22 - 0xffff);
  for (let offset = data.byteLength - 22; offset >= minimum; offset -= 1) {
    if (readUInt32(data, offset) === 0x06054b50) return offset;
  }
  throw new ValidationError("zip", "找不到中央目录");
}

export function readSkillPackage(data: Uint8Array): SkillPackageEntry[] {
  const endOffset = findEndOfCentralDirectory(data);
  const count = readUInt16(data, endOffset + 10);
  const centralSize = readUInt32(data, endOffset + 12);
  const centralOffset = readUInt32(data, endOffset + 16);
  if (centralOffset + centralSize > data.byteLength) {
    throw new ValidationError("zip", "中央目录越界");
  }

  const entries: SkillPackageEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (readUInt32(data, offset) !== 0x02014b50) {
      throw new ValidationError("zip", "中央目录项签名不合法");
    }
    const flags = readUInt16(data, offset + 8);
    const method = readUInt16(data, offset + 10);
    const compressedSize = readUInt32(data, offset + 20);
    const uncompressedSize = readUInt32(data, offset + 24);
    const nameLength = readUInt16(data, offset + 28);
    const extraLength = readUInt16(data, offset + 30);
    const commentLength = readUInt16(data, offset + 32);
    const localHeaderOffset = readUInt32(data, offset + 42);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      data.slice(offset + 46, offset + 46 + nameLength),
    );
    validatePackagePath(name);
    if ((flags & 0x0008) !== 0) {
      throw new ValidationError("zip", "不支持 data descriptor");
    }
    if (method !== 8 && method !== 0) {
      throw new ValidationError("zip", `不支持的压缩方式：${method}`);
    }
    if (readUInt32(data, localHeaderOffset) !== 0x04034b50) {
      throw new ValidationError("zip", "本地文件头签名不合法");
    }
    const localNameLength = readUInt16(data, localHeaderOffset + 26);
    const localExtraLength = readUInt16(data, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = data.slice(dataOffset, dataOffset + compressedSize);
    const content =
      method === 8 ? new Uint8Array(inflateRawSync(compressed)) : compressed;
    if (content.byteLength !== uncompressedSize) {
      throw new ValidationError("zip", `文件大小不一致：${name}`);
    }
    entries.push({ path: name, data: content });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  const first = entries[0];
  if (first === undefined || first.path !== SKILL_MD) {
    throw new ValidationError("zip", "SKILL.md 必须是包内首项");
  }
  return entries;
}
