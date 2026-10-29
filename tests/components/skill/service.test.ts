import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  NameConflictError,
  RevisionConflictError,
  ValidationError,
} from "../../../src/core/kernel/index.ts";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
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
