import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  NameConflictError,
  RevisionConflictError,
  ValidationError,
} from "../../../src/core/kernel/index.ts";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { parseSkillMarkdown } from "../../../src/components/skill/package.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

const input = (name = "CRES 技能", body = "## 适用场景\n\n内容\n") => ({
  name,
  categoryCode: "coding",
  description: "基于 Call Trace 定位符号引用链",
  tags: ["规范", "文档"],
  body,
});

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await resetBusinessData();
});

afterAll(async () => {
  await closeTestDb();
});

describe("Skill 写入规则", () => {
  test("新建为 v1.0，标签去重且详情回读正文与包文件", async () => {
    const draft = await ctx.skillDraftService.createDraft(null);
    const saved = await ctx.skillDraftService.saveDraft(draft.id, null, {
      ...input(),
      tags: ["规范", "规范", "文档"],
    });
    expect(saved).toMatchObject({ revision: 1, version: "v1.0" });

    const detail = await ctx.catalog.getSkill(saved.id);
    expect(detail).toMatchObject({
      categoryLabel: "编码",
      description: "基于 Call Trace 定位符号引用链",
      body: "## 适用场景\n\n内容\n",
      tags: ["规范", "文档"],
      usedByCount: 0,
    });
    expect(detail.files).toEqual([
      expect.objectContaining({ path: "SKILL.md", readOnly: true }),
    ]);
  });

  test("更新 minor+1；重新建草稿带旧 revision 冲突", async () => {
    const first = await ctx.skillDraftService.createDraft(null);
    const created = await ctx.skillDraftService.saveDraft(first.id, null, input());
    const draft = await ctx.skillDraftService.createDraft(created.id);
    const updated = await ctx.skillDraftService.saveDraft(draft.id, 1, input("CRES 技能 v2"));
    expect(updated).toMatchObject({ revision: 2, version: "v1.1" });

    const staleDraft = await ctx.skillDraftService.createDraft(created.id);
    const error = await ctx.skillDraftService
      .saveDraft(staleDraft.id, 1, input("CRES 技能 v3"))
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(RevisionConflictError);
  });

  test("名称唯一、分类不存在与空标签被拒绝，失败保留草稿", async () => {
    const first = await ctx.skillDraftService.createDraft(null);
    await ctx.skillDraftService.saveDraft(first.id, null, input());

    const duplicate = await ctx.skillDraftService.createDraft(null);
    const nameError = await ctx.skillDraftService
      .saveDraft(duplicate.id, null, input("CRES 技能"))
      .catch((caught) => caught);
    expect(nameError).toBeInstanceOf(NameConflictError);
    expect((await ctx.skillDraftService.getDraft(duplicate.id)).id).toBe(duplicate.id);

    const badCategory = await ctx.skillDraftService.createDraft(null);
    const categoryError = await ctx.skillDraftService
      .saveDraft(badCategory.id, null, { ...input("x"), categoryCode: "unknown" })
      .catch((caught) => caught);
    expect(categoryError).toBeInstanceOf(ValidationError);
    expect(categoryError.details.field).toBe("categoryCode");

    const emptyTag = await ctx.skillDraftService.createDraft(null);
    const tagError = await ctx.skillDraftService
      .saveDraft(emptyTag.id, null, { ...input("y"), tags: [" "] })
      .catch((caught) => caught);
    expect(tagError).toBeInstanceOf(ValidationError);
    expect(tagError.details.field).toBe("tags");
  });
});

describe("Skill 系统标识（slug）", () => {
  async function saveNew(extra: Record<string, unknown>) {
    const draft = await ctx.skillDraftService.createDraft(null);
    return await ctx.skillDraftService.saveDraft(draft.id, null, {
      ...input(),
      ...extra,
    } as never);
  }

  test("显式 slug 进 SKILL.md 的 name，展示名保留；详情与列表都带 slug", async () => {
    const saved = await saveNew({ slug: "workflow-init" });
    const detail = await ctx.catalog.getSkill(saved.id);
    expect(detail).toMatchObject({ name: "CRES 技能", slug: "workflow-init" });

    const document = await ctx.skillRead.getDocument(saved.id);
    expect(parseSkillMarkdown(document.markdown).name).toBe("workflow-init");

    const page = await ctx.catalog.listSkills({
      q: "workflow-init",
      page: { limit: 10, offset: 0 },
    });
    expect(page.items.map((item) => item.slug)).toEqual(["workflow-init"]);
  });

  test("缺省 slug 由 id 派生为 skill-<id8>", async () => {
    const saved = await saveNew({});
    const detail = await ctx.catalog.getSkill(saved.id);
    const expected = `skill-${saved.id.replaceAll("-", "").slice(-8)}`;
    expect(detail.slug).toBe(expected);
    const document = await ctx.skillRead.getDocument(saved.id);
    expect(parseSkillMarkdown(document.markdown).name).toBe(expected);
  });

  test("slug 形状非法返回 validation_error，field=slug，草稿保留", async () => {
    for (const slug of ["CRES", "workflow_init", "-abc", "a--b", "工作流"]) {
      const draft = await ctx.skillDraftService.createDraft(null);
      const error = await ctx.skillDraftService
        .saveDraft(draft.id, null, { ...input(), slug } as never)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.details).toMatchObject({ field: "slug" });
      await ctx.skillDraftService.cancelDraft(draft.id);
    }
  });

  test("slug 重复返回 name_conflict，field=slug", async () => {
    await saveNew({ slug: "dup-slug" });
    const error = await saveNew({ name: "另一个技能", slug: "dup-slug" }).catch(
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(NameConflictError);
    expect(error.code).toBe("name_conflict");
    expect(error.details).toMatchObject({ field: "slug", value: "dup-slug" });
  });

  test("更新时显式改 slug 生效并重打包；缺省沿用原值", async () => {
    const created = await saveNew({ slug: "first-slug" });

    const keep = await ctx.skillDraftService.createDraft(created.id);
    await ctx.skillDraftService.saveDraft(keep.id, 1, input("CRES 技能 v2"));
    expect((await ctx.catalog.getSkill(created.id)).slug).toBe("first-slug");

    const change = await ctx.skillDraftService.createDraft(created.id);
    const saved = await ctx.skillDraftService.saveDraft(change.id, 2, {
      ...input("CRES 技能 v3"),
      slug: "second-slug",
    });
    const detail = await ctx.catalog.getSkill(created.id);
    expect(detail.slug).toBe("second-slug");
    expect(detail.revision).toBe(3);
    const document = await ctx.skillRead.getDocument(created.id);
    expect(parseSkillMarkdown(document.markdown).name).toBe("second-slug");
    expect(saved.revision).toBe(3);
  });
});
