import { createHash } from "node:crypto";

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function skillSetDigest(
  packages: { packageId: string; version: string; digest: string; sizeBytes: number }[],
): string {
  const canonical = [...packages]
    .sort((left, right) => left.packageId.localeCompare(right.packageId))
    .map((item) => [item.packageId, item.version, item.digest, item.sizeBytes]);
  return `sha256:${sha256Hex(new TextEncoder().encode(JSON.stringify(canonical)))}`;
}
