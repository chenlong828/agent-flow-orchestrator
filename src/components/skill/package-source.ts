import {
  NotFoundError,
  PackageNotFoundError,
  PackageUnavailableError,
  type FileStore,
  type SkillPackageRef,
  type SkillPackageSource,
} from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import { etagOf, packageIdOf, parsePackageId, sha256Hex } from "./digest.ts";

type PackageRow = {
  id: string;
  name: string;
  package_key: string;
  package_digest: string;
  package_size: number;
  version: string;
  revision: number;
};

export type SkillPackageSourceDeps = {
  db: Db;
  store: FileStore;
};

const COLUMNS = "id, name, package_key, package_digest, package_size, version, revision";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

export function createSkillPackageSource(deps: SkillPackageSourceDeps): SkillPackageSource {
  async function readPackageBytes(row: PackageRow): Promise<Uint8Array> {
    try {
      return await readAll(await deps.store.get(`packages/${row.package_key}`));
    } catch (error) {
      throw new PackageUnavailableError(row.id, error);
    }
  }

  function toRef(row: PackageRow, digest: string): SkillPackageRef {
    return {
      packageId: packageIdOf(row.id, row.revision),
      skillId: row.id,
      name: row.name,
      version: row.version,
      digest: `sha256:${digest}`,
      sizeBytes: row.package_size > 0 ? row.package_size : 0,
      etag: etagOf(digest),
    };
  }

  async function describeRow(row: PackageRow): Promise<SkillPackageRef> {
    if (row.package_digest !== "") {
      return toRef(row, row.package_digest);
    }
    const data = await readPackageBytes(row);
    return toRef(row, sha256Hex(data));
  }

  return {
    async currentForSkill(skillId: string): Promise<SkillPackageRef> {
      const row = await deps.db.one<PackageRow>(
        `select ${COLUMNS} from skill where id = $1`,
        [skillId],
      );
      if (row === null) throw new NotFoundError("Skill", skillId);
      return describeRow(row);
    },

    async describe(packageId: string): Promise<SkillPackageRef | null> {
      const parsed = parsePackageId(packageId);
      if (parsed === null) return null;
      const row = await deps.db.one<PackageRow>(
        `select ${COLUMNS} from skill where id = $1`,
        [parsed.skillId],
      );
      if (row === null || row.revision !== parsed.revision) return null;
      return describeRow(row);
    },

    async open(packageId: string): Promise<{ ref: SkillPackageRef; data: Uint8Array }> {
      const parsed = parsePackageId(packageId);
      if (parsed === null) throw new PackageNotFoundError(packageId);
      const row = await deps.db.one<PackageRow>(
        `select ${COLUMNS} from skill where id = $1`,
        [parsed.skillId],
      );
      if (row === null || row.revision !== parsed.revision) {
        throw new PackageNotFoundError(packageId);
      }
      const data = await readPackageBytes(row);
      const digest = sha256Hex(data);
      if (row.package_digest !== "" && row.package_digest !== digest) {
        throw new PackageUnavailableError(row.id, new Error("包摘要与库内记录不一致"));
      }
      const ref = toRef(row, digest);
      return { ref: { ...ref, sizeBytes: data.byteLength }, data };
    },
  };
}
