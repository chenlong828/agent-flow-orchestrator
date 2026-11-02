import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeTestDb, getTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import {
  createFileStore,
  systemClock,
  uuidv7Ids,
} from "../../../src/core/platform/index.ts";
import {
  DraftExpiredError,
  FileConflictError,
  NameConflictError,
  PackageUnavailableError,
  PreconditionRequiredError,
  ReferencedError,
  RevisionConflictError,
  SkillMdTooLargeError,
  ValidationError,
} from "../../../src/core/kernel/index.ts";
import type { FileStore, ReferenceGuard } from "../../../src/core/kernel/index.ts";
import { createSkillDraftService } from "../../../src/components/skill/draft-service.ts";
import { readSkillPackage } from "../../../src/components/skill/package.ts";
import { seedAll } from "../../../scripts/seed.ts";

let db: Awaited<ReturnType<typeof getTestDb>>;
let store: FileStore;
let skillId: string;
const directories: string[] = [];

beforeAll(async () => {
  db = await getTestDb();
});

beforeEach(async () => {
  await resetBusinessData();
  const directory = await mkdtemp(join(tmpdir(), "agentflow-skill-draft-"));
  directories.push(directory);
  store = createFileStore(join(directory, "skills"));
  await seedAll(db, store);
  const row = await db.one<{ id: string }>(
    "select id from skill where name = 'CRES 技能'",
  );
  skillId = row!.id;
});

afterAll(async () => {
  await closeTestDb();
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function service(
  clock = systemClock,
  ttlHours = 24,
  guard?: ReferenceGuard,
) {
  return createSkillDraftService({
    db,
    store,
    clock,
    ids: uuidv7Ids,
    draftTtlHours: ttlHours,
    actor: "tester",
    guard: guard ?? { check: async () => [] },
  });
}

describe("Skill 草稿生命周期", () => {
  test("新建草稿为空，取消后 404", async () => {
    const drafts = service();
    const draft = await drafts.createDraft(null);

    expect(draft).toMatchObject({
      skillId: null,
      baseRevision: null,
      baseVersion: null,
      files: [],
    });
    expect((await drafts.getDraft(draft.id)).files).toEqual([]);

    await drafts.cancelDraft(draft.id);
    const missing = await drafts.getDraft(draft.id).catch((caught) => caught);
    expect(missing.code).toBe("not_found");
  });

  test("已有 Skill 复制完整包，上传/覆盖/改名/删除附件", async () => {
    const drafts = service();
    const draft = await drafts.createDraft(skillId);

    expect(draft.skillId).toBe(skillId);
    expect(draft.baseRevision).toBe(1);
    expect(draft.baseVersion).toBe("v1.4");
    expect(draft.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "references/usage.md",
    ]);
    expect(draft.files[0]!.readOnly).toBe(true);
    expect(draft.files[1]!.readOnly).toBe(false);

    const uploaded = await drafts.uploadDraftFile(
      draft.id,
      "scripts/run.sh",
      new TextEncoder().encode("echo hi"),
    );
    expect(uploaded.file).toMatchObject({ path: "scripts/run.sh", size: 7 });
    expect(uploaded.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "references/usage.md",
      "scripts/run.sh",
    ]);

    const overwritten = await drafts.uploadDraftFile(
      draft.id,
      "scripts/run.sh",
      new TextEncoder().encode("echo bye"),
    );
    expect(overwritten.file.size).toBe(8);

    const renamed = await drafts.renameDraftFile(
      draft.id,
      "scripts/run.sh",
      "references/run.sh",
    );
    expect(renamed.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "references/run.sh",
      "references/usage.md",
    ]);

    await drafts.deleteDraftFile(draft.id, "references/run.sh");
    expect((await drafts.getDraft(draft.id)).files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "references/usage.md",
    ]);
  });

  test("改名冲突、SKILL.md 附件与非法路径被拒绝", async () => {
    const drafts = service();
    const draft = await drafts.createDraft(skillId);

    await drafts.uploadDraftFile(draft.id, "references/a.md", new Uint8Array([1]));
    const conflict = await drafts
      .renameDraftFile(draft.id, "references/a.md", "references/usage.md")
      .catch((caught) => caught);
    expect(conflict).toBeInstanceOf(FileConflictError);

    for (const path of ["SKILL.md", "../x.md", "root.md"]) {
      const error = await drafts
        .uploadDraftFile(draft.id, path, new Uint8Array([1]))
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(ValidationError);
    }
  });

  test("过期草稿读取返回 draft_expired，取消按 204 处理", async () => {
    let now = new Date("2026-10-29T00:00:00.000Z");
    const clock = { now: () => now };
    const drafts = service(clock, 1);
    const draft = await drafts.createDraft(null);
    now = new Date("2026-10-29T02:00:00.000Z");

    const expired = await drafts.getDraft(draft.id).catch((caught) => caught);
    expect(expired).toBeInstanceOf(DraftExpiredError);
    expect(expired.details).toEqual({ expiresAt: "2026-10-29T01:00:00.000Z" });

    await drafts.cancelDraft(draft.id);
    const missing = await drafts.getDraft(draft.id).catch((caught) => caught);
    expect(missing.code).toBe("not_found");
  });

  test("已有 Skill 包缺失时建草稿返回 package_unavailable", async () => {
    const row = await db.one<{ package_key: string }>(
      "select package_key from skill where id = $1",
      [skillId],
    );
    await store.delete(`packages/${row!.package_key}`);

    const error = await service()
      .createDraft(skillId)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(PackageUnavailableError);
  });
});

describe("Skill 保存、启停与 GC", () => {
  test("新建草稿保存为 v1.0，消费草稿并写入新包", async () => {
    const drafts = service();
    const draft = await drafts.createDraft(null);
    await drafts.uploadDraftFile(
      draft.id,
      "scripts/run.sh",
      new TextEncoder().encode("echo hi"),
    );

    const saved = await drafts.saveDraft(draft.id, null, {
      name: "新建 Skill",
      categoryCode: "coding",
      description: "新建草稿保存",
      tags: ["新", "新", "保存"],
      body: "## 适用场景\n\n内容",
    });
    expect(saved).toMatchObject({ revision: 1, version: "v1.0", created: true });
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const row = await db.one<{ package_key: string; tags: number; revision: number }>(
      `select s.package_key, s.revision,
        (select count(*)::int from skill_tag t where t.skill_id = s.id) as tags
       from skill s where s.name = '新建 Skill'`,
    );
    expect(row).toMatchObject({ revision: 1, tags: 2 });
    const entries = readSkillPackage(
      new Uint8Array(
        await new Response(await store.get(`packages/${row!.package_key}`)).arrayBuffer(),
      ),
    );
    expect(entries.map((entry) => entry.path)).toEqual([
      "SKILL.md",
      "scripts/run.sh",
    ]);
    expect((await drafts.getDraft(draft.id).catch((caught) => caught)).code).toBe(
      "not_found",
    );
  });

  test("更新按 minor+1，旧包删除并消费草稿；v1.9 进位到 v2.0", async () => {
    const drafts = service();
    const draft = await drafts.createDraft(skillId);
    const before = await db.one<{ package_key: string }>(
      "select package_key from skill where id = $1",
      [skillId],
    );
    const saved = await drafts.saveDraft(draft.id, 1, {
      name: "CRES 技能",
      categoryCode: "coding",
      description: "更新描述",
      tags: ["CRES"],
      body: "## 更新",
    });
    expect(saved).toMatchObject({ revision: 2, version: "v1.5", created: false });
    expect(await store.head(`packages/${before!.package_key}`)).toBeNull();

    await db.query("update skill set version = 'v1.9' where id = $1", [skillId]);
    const draft2 = await drafts.createDraft(skillId);
    const saved2 = await drafts.saveDraft(draft2.id, 2, {
      name: "CRES 技能",
      categoryCode: "coding",
      description: "再更新",
      tags: [],
      body: "## 再更新",
    });
    expect(saved2).toMatchObject({ revision: 3, version: "v2.0" });
  });

  test("保存规则：更新草稿缺 baseRevision 返回 428，新建草稿带 baseRevision 返回 400", async () => {
    const drafts = service();
    const updateDraft = await drafts.createDraft(skillId);
    const missing = await drafts
      .saveDraft(updateDraft.id, null, {
        name: "CRES 技能",
        categoryCode: "coding",
        description: "缺 If-Match",
        body: "",
      })
      .catch((caught) => caught);
    expect(missing).toBeInstanceOf(PreconditionRequiredError);
    expect((await drafts.getDraft(updateDraft.id)).id).toBe(updateDraft.id);

    const newDraft = await drafts.createDraft(null);
    const extra = await drafts
      .saveDraft(newDraft.id, 1, {
        name: "新建 Skill 带 If-Match",
        categoryCode: "coding",
        description: "多带 If-Match",
        body: "",
      })
      .catch((caught) => caught);
    expect(extra).toBeInstanceOf(ValidationError);
    expect(extra.details).toMatchObject({ field: "If-Match" });
    expect((await drafts.getDraft(newDraft.id)).id).toBe(newDraft.id);
  });

  test("名称冲突、revision 冲突与 SKILL.md 超限保留草稿", async () => {
    const drafts = service();
    const conflictDraft = await drafts.createDraft(null);
    const nameError = await drafts
      .saveDraft(conflictDraft.id, null, {
        name: "CRES 技能",
        categoryCode: "coding",
        description: "冲突",
        body: "",
      })
      .catch((caught) => caught);
    expect(nameError).toBeInstanceOf(NameConflictError);
    expect((await drafts.getDraft(conflictDraft.id)).id).toBe(conflictDraft.id);

    const updateDraft = await drafts.createDraft(skillId);
    const revisionError = await drafts
      .saveDraft(updateDraft.id, 99, {
        name: "CRES 技能",
        categoryCode: "coding",
        description: "冲突",
        body: "",
      })
      .catch((caught) => caught);
    expect(revisionError).toBeInstanceOf(RevisionConflictError);

    const oversized = await drafts.createDraft(null);
    const largeError = await drafts
      .saveDraft(oversized.id, null, {
        name: "超限",
        categoryCode: "coding",
        description: "超限",
        body: "x".repeat(17_000),
      })
      .catch((caught) => caught);
    expect(largeError).toBeInstanceOf(SkillMdTooLargeError);
    expect((await drafts.getDraft(oversized.id)).id).toBe(oversized.id);
  });

  test("启停推进 revision；删除受引用保护并清理包与草稿", async () => {
    const guard: ReferenceGuard = { check: async () => [] };
    const drafts = service(systemClock, 24, guard);
    expect(await drafts.setEnabled(skillId, 1, false)).toEqual({
      id: skillId,
      revision: 2,
    });
    expect(
      (await db.one<{ enabled: boolean }>("select enabled from skill where id = $1", [skillId]))!
        .enabled,
    ).toBe(false);

    const draft = await drafts.createDraft(skillId);
    await db.query("delete from expert_skill where skill_id = $1", [skillId]);
    const packageKey = (
      await db.one<{ package_key: string }>("select package_key from skill where id = $1", [skillId])
    )!.package_key;
    await drafts.delete(skillId, 2);
    expect(await db.one("select id from skill where id = $1", [skillId])).toBeNull();
    expect(await store.head(`packages/${packageKey}`)).toBeNull();
    expect((await drafts.getDraft(draft.id).catch((caught) => caught)).code).toBe(
      "not_found",
    );

    const referenced: ReferenceGuard = {
      check: async () => [{ type: "expert", id: "e1", name: "专家" }],
    };
    const row = await db.one<{ id: string }>("select id from skill where name = 'LDP 技能'");
    const error = await service(systemClock, 24, referenced)
      .delete(row!.id, 1)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ReferencedError);
  });

  test("GC 删除非当前包与过期草稿", async () => {
    const drafts = service();
    const orphanKey = "packages/orphan.zip";
    await store.put(orphanKey, new Uint8Array([1]));
    const expired = await drafts.createDraft(null);
    await db.query(
      "update skill_draft set expires_at = now() - interval '1 hour' where id = $1",
      [expired.id],
    );

    const before = await db.one<{ count: number }>(
      "select count(*)::int from skill where package_key is not null",
    );
    expect(await drafts.gc(0)).toMatchObject({ packages: 1, drafts: 1 });
    expect(await store.head(orphanKey)).toBeNull();
    expect((await drafts.getDraft(expired.id).catch((caught) => caught)).code).toBe(
      "not_found",
    );
    expect(await store.list("packages/")).toHaveLength(before!.count);
  });
});
