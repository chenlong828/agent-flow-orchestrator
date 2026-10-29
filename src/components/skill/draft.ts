import { posix } from "node:path";
import {
  DraftExpiredError,
  FileConflictError,
  NameConflictError,
  NotFoundError,
  PackageUnavailableError,
  PayloadTooLargeError,
  ReferencedError,
  RevisionConflictError,
  ValidationError,
  type Clock,
  type FileData,
  type FileStore,
  type IdGenerator,
  type ReferenceGuard,
} from "../../core/kernel/index.ts";
import { isForeignKeyViolation, isUniqueViolation, type Db } from "../../core/platform/index.ts";
import {
  FILE_LIMIT_BYTES,
  FILE_LIMIT_COUNT,
  PACKAGE_LIMIT_BYTES,
  SKILL_MD,
  SKILL_MD_LIMIT_BYTES,
  buildSkillPackage,
  readSkillPackage,
  validatePackagePath,
  type SkillPackageEntry,
} from "./package.ts";
import type {
  DraftFile,
  DraftFileResult,
  SaveSkill,
  SaveSkillResult,
  SkillDraft,
  SkillDraftService,
} from "./contract.ts";

type DraftRow = {
  id: string;
  skill_id: string | null;
  base_revision: number | null;
  base_version: string | null;
  expires_at: Date | string;
  created_at: Date | string;
};

type SkillRow = {
  id: string;
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

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function draftPrefix(id: string): string {
  return `drafts/${id}`;
}

function toFile(path: string, size: number): DraftFile {
  return { path, size, readOnly: path === SKILL_MD };
}

async function readData(data: FileData): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(await new Response(data).arrayBuffer());
}

async function listFiles(store: FileStore, id: string): Promise<DraftFile[]> {
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

async function ensureDraftDirectory(store: FileStore, id: string): Promise<void> {
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

function attachmentPath(path: string): string {
  if (path === SKILL_MD) {
    throw new ValidationError("path", "SKILL.md 由服务端生成，不能作为附件");
  }
  return validatePackagePath(path);
}

async function readPackage(store: FileStore, skill: SkillRow): Promise<SkillPackageEntry[]> {
  try {
    const data = new Uint8Array(
      await new Response(await store.get(`packages/${skill.package_key}`)).arrayBuffer(),
    );
    return readSkillPackage(data);
  } catch (error) {
    throw new PackageUnavailableError(skill.id, error);
  }
}


type CurrentSkill = {
  id: string;
  name: string;
  package_key: string;
  version: string;
  revision: number;
};

function nextVersion(version: string): string {
  const match = /^v([0-9]+)\.([0-9]+)$/.exec(version);
  if (match === null) throw new ValidationError("version", `版本号不合法：${version}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return minor === 9 ? `v${major + 1}.0` : `v${major}.${minor + 1}`;
}

function normalizeSave(input: SaveSkill): {
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

export function createSkillDraftService(deps: SkillDraftDeps): SkillDraftService {
  const { db, store, clock, ids, draftTtlHours, actor, guard } = deps;

  async function findDraft(id: string): Promise<DraftRow | null> {
    return db.one<DraftRow>(
      `select id, skill_id, base_revision, base_version, expires_at, created_at
       from skill_draft where id = $1`,
      [id],
    );
  }

  function assertNotExpired(row: DraftRow): void {
    if (new Date(row.expires_at).getTime() <= clock.now().getTime()) {
      throw new DraftExpiredError(toIso(row.expires_at));
    }
  }

  async function requireDraft(id: string): Promise<DraftRow> {
    const row = await findDraft(id);
    if (row === null) throw new NotFoundError("SkillDraft", id);
    assertNotExpired(row);
    return row;
  }

  async function toDraft(row: DraftRow): Promise<SkillDraft> {
    return {
      id: row.id,
      skillId: row.skill_id,
      baseRevision: row.base_revision,
      baseVersion: row.base_version,
      expiresAt: toIso(row.expires_at),
      createdAt: toIso(row.created_at),
      files: await listFiles(store, row.id),
    };
  }

  async function requireFile(id: string, path: string): Promise<void> {
    if ((await store.head(`${draftPrefix(id)}/${path}`)) === null) {
      throw new NotFoundError("DraftFile", path);
    }
  }

  async function currentFiles(id: string): Promise<Map<string, number>> {
    const files = await listFiles(store, id);
    return new Map(files.map((file) => [file.path, file.size]));
  }

  return {
    async createDraft(skillId: string | null, requestActor?: string | null): Promise<SkillDraft> {
      const now = clock.now();
      const id = ids.next();
      const expiresAt = new Date(now.getTime() + draftTtlHours * 3_600_000);
      let baseVersion: string | null = null;
      let baseRevision: number | null = null;

      try {
        if (skillId !== null) {
          const skill = await db.one<SkillRow>(
            "select id, package_key, version, revision from skill where id = $1",
            [skillId],
          );
          if (skill === null) throw new NotFoundError("Skill", skillId);
          baseVersion = skill.version;
          baseRevision = skill.revision;
          const entries = await readPackage(store, skill);
          for (const entry of entries) {
            await store.put(`${draftPrefix(id)}/${entry.path}`, entry.data);
          }
        } else {
          await ensureDraftDirectory(store, id);
        }

        await db.query(
          `insert into skill_draft
            (id, skill_id, base_revision, base_version, expires_at, created_at,
             created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [id, skillId, baseRevision, baseVersion, expiresAt, now, requestActor ?? actor],
        );
        return toDraft({
          id,
          skill_id: skillId,
          base_revision: baseRevision,
          base_version: baseVersion,
          expires_at: expiresAt,
          created_at: now,
        });
      } catch (error) {
        await removeDraftTree(store, id).catch(() => undefined);
        throw error;
      }
    },

    async getDraft(id: string): Promise<SkillDraft> {
      return toDraft(await requireDraft(id));
    },

    async uploadDraftFile(
      id: string,
      path: string,
      data: FileData,
    ): Promise<DraftFileResult> {
      await requireDraft(id);
      const target = attachmentPath(path);
      const bytes = await readData(data);
      const files = await currentFiles(id);
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
        sumWithoutTarget +
        bytes.byteLength +
        (files.has(SKILL_MD) ? 0 : SKILL_MD_LIMIT_BYTES);
      if (total > PACKAGE_LIMIT_BYTES) {
        throw new PayloadTooLargeError("package_bytes", PACKAGE_LIMIT_BYTES, total);
      }

      await store.put(`${draftPrefix(id)}/${target}`, bytes);
      const next = await listFiles(store, id);
      return {
        file: toFile(target, bytes.byteLength),
        files: next,
      };
    },

    async renameDraftFile(
      id: string,
      path: string,
      newPath: string,
    ): Promise<DraftFileResult> {
      await requireDraft(id);
      const source = attachmentPath(path);
      const target = attachmentPath(newPath);
      if (source === target) throw new ValidationError("newPath", "新旧路径不能相同");
      await requireFile(id, source);
      if ((await store.head(`${draftPrefix(id)}/${target}`)) !== null) {
        throw new FileConflictError(source, target);
      }
      await store.move(`${draftPrefix(id)}/${source}`, `${draftPrefix(id)}/${target}`);
      return {
        file: toFile(target, (await store.head(`${draftPrefix(id)}/${target}`))!.size),
        files: await listFiles(store, id),
      };
    },

    async deleteDraftFile(id: string, path: string): Promise<void> {
      await requireDraft(id);
      const target = attachmentPath(path);
      await requireFile(id, target);
      await store.delete(`${draftPrefix(id)}/${target}`);
    },

    async cancelDraft(id: string): Promise<void> {
      const row = await findDraft(id);
      if (row === null) throw new NotFoundError("SkillDraft", id);
      await db.query("delete from skill_draft where id = $1", [id]);
      await removeDraftTree(store, id).catch(() => undefined);
    },

    async saveDraft(
      id: string,
      baseRevision: number | null,
      input: SaveSkill,
      requestActor?: string | null,
    ): Promise<SaveSkillResult> {
      const proposed = normalizeSave(input);
      const draft = await findDraft(id);
      if (draft === null) throw new NotFoundError("SkillDraft", id);
      assertNotExpired(draft);

      let current: CurrentSkill | null = null;
      let version = "v1.0";
      if (draft.skill_id === null) {
        if (baseRevision !== null) {
          throw new ValidationError("baseRevision", "新建草稿不能带 baseRevision");
        }
      } else {
        current = await db.one<CurrentSkill>(
          "select id, name, package_key, version, revision from skill where id = $1",
          [draft.skill_id],
        );
        if (current === null) throw new NotFoundError("Skill", draft.skill_id);
        if (
          baseRevision !== current.revision ||
          draft.base_revision !== current.revision
        ) {
          throw new RevisionConflictError(current.revision);
        }
        version = nextVersion(current.version);
      }

      const category = await db.one<{ code: string }>(
        "select code from skill_category where code = $1",
        [proposed.categoryCode],
      );
      if (category === null) {
        throw new ValidationError("categoryCode", "分类不存在");
      }

      const attachments: { path: string; data: Uint8Array }[] = [];
      for (const file of await store.list(draftPrefix(id))) {
        const path = file.key.slice(draftPrefix(id).length + 1);
        if (path === SKILL_MD) continue;
        const data = await readData(await store.get(file.key));
        attachments.push({ path, data });
      }

      const packageBytes = buildSkillPackage({
        name: proposed.name,
        description: proposed.description,
        version,
        body: proposed.body,
        files: attachments,
      });
      const packageKey = `${ids.next()}.zip`;
      await store.put(`packages/${packageKey}`, packageBytes);

      const actorValue = requestActor ?? actor;
      try {
        const result = await db.transaction(async (tx) => {
          const lockedDraft = await tx.one<DraftRow>(
            `select id, skill_id, base_revision, base_version, expires_at, created_at
             from skill_draft where id = $1 for update`,
            [id],
          );
          if (lockedDraft === null) throw new NotFoundError("SkillDraft", id);
          assertNotExpired(lockedDraft);

          const categoryRow = await tx.one<{ code: string }>(
            "select code from skill_category where code = $1",
            [proposed.categoryCode],
          );
          if (categoryRow === null) {
            throw new ValidationError("categoryCode", "分类不存在");
          }

          let skillId: string;
          let revision: number;
          let oldPackageKey: string | null = null;
          if (lockedDraft.skill_id === null) {
            skillId = ids.next();
            revision = 1;
            const now = clock.now();
            await tx.query(
              `insert into skill
                (id, name, category_code, description, package_key, version,
                 enabled, revision, created_at, updated_at, created_by, updated_by)
               values ($1, $2, $3, $4, $5, $6, true, 1, $7, $7, $8, $8)`,
              [
                skillId,
                proposed.name,
                proposed.categoryCode,
                proposed.description,
                packageKey,
                version,
                now,
                actorValue,
              ],
            );
          } else {
            const latest = await tx.one<CurrentSkill>(
              "select id, name, package_key, version, revision from skill where id = $1 for update",
              [lockedDraft.skill_id],
            );
            if (latest === null) throw new NotFoundError("Skill", lockedDraft.skill_id);
            if (baseRevision !== latest.revision) {
              throw new RevisionConflictError(latest.revision);
            }
            skillId = latest.id;
            revision = latest.revision + 1;
            oldPackageKey = latest.package_key;
            const now = clock.now();
            const changed = await tx.query<{ id: string }>(
              `update skill set
                 name = $1, category_code = $2, description = $3,
                 package_key = $4, version = $5, revision = revision + 1,
                 updated_at = $6, updated_by = $7
               where id = $8 and revision = $9
               returning id`,
              [
                proposed.name,
                proposed.categoryCode,
                proposed.description,
                packageKey,
                version,
                now,
                actorValue,
                skillId,
                latest.revision,
              ],
            );
            if (changed.length === 0) throw new RevisionConflictError(latest.revision);
          }

          await tx.query("delete from skill_tag where skill_id = $1", [skillId]);
          for (const [position, tag] of proposed.tags.entries()) {
            await tx.query(
              "insert into skill_tag (skill_id, position, tag) values ($1, $2, $3)",
              [skillId, position, tag],
            );
          }
          await tx.query("delete from skill_draft where id = $1", [id]);

          return { id: skillId, revision, version, oldPackageKey };
        });

        await removeDraftTree(store, id).catch(() => undefined);
        if (result.oldPackageKey !== null) {
          await store.delete(`packages/${result.oldPackageKey}`).catch(() => undefined);
        }
        return { id: result.id, revision: result.revision, version: result.version };
      } catch (error) {
        await store.delete(`packages/${packageKey}`).catch(() => undefined);
        if (isUniqueViolation(error)) throw new NameConflictError(proposed.name);
        throw error;
      }
    },

    async setEnabled(
      id: string,
      revision: number,
      enabled: boolean,
      requestActor?: string | null,
    ): Promise<{ id: string; revision: number }> {
      const current = await db.one<CurrentSkill>(
        "select id, name, package_key, version, revision from skill where id = $1",
        [id],
      );
      if (current === null) throw new NotFoundError("Skill", id);
      if (current.revision !== revision) throw new RevisionConflictError(current.revision);
      const changed = await db.query<{ id: string }>(
        `update skill set enabled = $1, revision = revision + 1,
           updated_at = $2, updated_by = $3
         where id = $4 and revision = $5 returning id`,
        [enabled, clock.now(), requestActor ?? actor, id, revision],
      );
      if (changed.length === 0) throw new RevisionConflictError(current.revision + 1);
      return { id, revision: revision + 1 };
    },

    async delete(id: string, revision: number): Promise<void> {
      const current = await db.one<CurrentSkill>(
        "select id, name, package_key, version, revision from skill where id = $1",
        [id],
      );
      if (current === null) throw new NotFoundError("Skill", id);
      if (current.revision !== revision) throw new RevisionConflictError(current.revision);
      const references = await guard.check("skill", id);
      if (references.length > 0) {
        throw new ReferencedError({ type: "skill", id, name: current.name }, references);
      }

      const drafts = await db.query<{ id: string }>(
        "select id from skill_draft where skill_id = $1",
        [id],
      );
      try {
        await db.transaction(async (tx) => {
          const changed = await tx.query<{ id: string }>(
            "delete from skill where id = $1 and revision = $2 returning id",
            [id, revision],
          );
          if (changed.length === 0) throw new RevisionConflictError(current.revision);
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          const latest = await guard.check("skill", id);
          throw new ReferencedError({ type: "skill", id, name: current.name }, latest);
        }
        throw error;
      }
      await store.delete(`packages/${current.package_key}`).catch(() => undefined);
      for (const draft of drafts) {
        await removeDraftTree(store, draft.id).catch(() => undefined);
      }
    },

    async gc(graceMs = 0): Promise<{ packages: number; drafts: number }> {
      const rows = await db.query<{ package_key: string }>("select package_key from skill");
      const current = new Set(rows.map((row) => `packages/${row.package_key}`));
      const now = clock.now().getTime();
      let packages = 0;
      for (const file of await store.list("packages/")) {
        if (current.has(file.key)) continue;
        if (now - file.modifiedAt.getTime() < graceMs) continue;
        await store.delete(file.key).catch(() => undefined);
        packages += 1;
      }

      const expired = await db.query<{ id: string }>(
        "select id from skill_draft where expires_at <= $1",
        [clock.now()],
      );
      for (const draft of expired) {
        await db.query("delete from skill_draft where id = $1", [draft.id]);
        await removeDraftTree(store, draft.id).catch(() => undefined);
      }
      return { packages, drafts: expired.length };
    },
  };
}
