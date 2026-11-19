import { createHash } from "node:crypto";
import { ValidationError } from "../../core/kernel/index.ts";
import type { RunInputMediaType } from "./types.ts";

const EXT_BY_MEDIA: Record<RunInputMediaType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF87 = "GIF87a";
const GIF89 = "GIF89a";
const RIFF = "RIFF";
const WEBP = "WEBP";

const WINDOWS_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

const MAX_NAME_LENGTH = 120;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return text;
}

/** 按魔数判定图片类型；不信任客户端声明的 Content-Type。 */
export function sniffMediaType(bytes: Uint8Array): RunInputMediaType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  if (bytes.length >= 6) {
    const head = asciiAt(bytes, 0, 6);
    if (head === GIF87 || head === GIF89) return "image/gif";
  }
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === RIFF && asciiAt(bytes, 8, 4) === WEBP) {
    return "image/webp";
  }
  return null;
}

/**
 * 清洗 task-space 文件名：
 * - 只保留最后一段、去控制字符/Windows 非法字符、去首尾点与空格；
 * - 不得以点开头（client 的 WorkspaceInputsPort 会拒绝）；
 * - 扩展名对齐魔数类型；
 * - 长度 ≤120；Windows 保留名加 `_` 前缀；
 * - `used` 存在时按 `-2`/`-3` 去重。
 */
export function sanitizeInputName(
  raw: string,
  mediaType: RunInputMediaType,
  used?: Set<string>,
): string {
  const ext = EXT_BY_MEDIA[mediaType];
  let base = raw
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");

  if (base === "" || base === "." || base === "..") base = "image";
  base = IMAGE_EXT.test(base) ? base.replace(IMAGE_EXT, ext) : `${base}${ext}`;
  base = base.slice(0, MAX_NAME_LENGTH).replace(/[. ]+$/, "");
  if (base === "" || base === ext) base = `image${ext}`;

  const stem = base.slice(0, base.length - ext.length);
  if (WINDOWS_RESERVED.has(stem.toUpperCase())) base = `_${base}`;

  if (used === undefined) return base;
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    const suffixStem = stem.length > 0 ? stem : "image";
    candidate = `${suffixStem}-${index}${ext}`.slice(0, MAX_NAME_LENGTH);
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function ensureInputId(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) {
    throw new ValidationError(field, "必须是 UUID");
  }
  return value;
}
