import { createHash } from "node:crypto";

/** 包字节的 sha256，十六进制小写；摘要由字节派生，不接受调用方传入。 */
export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function packageIdOf(skillId: string, revision: number): string {
  return `${skillId}.${revision}`;
}

export function parsePackageId(packageId: string): { skillId: string; revision: number } | null {
  const match = /^([0-9a-f-]{36})\.([1-9][0-9]*)$/i.exec(packageId);
  const skillId = match?.[1];
  const revision = match?.[2];
  if (skillId === undefined || revision === undefined) return null;
  return { skillId, revision: Number(revision) };
}

export function etagOf(digest: string): string {
  return `"sha256-${digest}"`;
}
