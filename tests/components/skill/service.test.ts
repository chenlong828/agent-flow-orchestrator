import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  NotFoundError,
  ReferencedError,
  RevisionConflictError,
  ValidationError,
  normalizePageQuery,
} from "../../../src/core/kernel/index.ts";
import {
  CategoryNotFoundError,
  type SkillSections,
} from "../../../src/components/skill/index.ts";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";
import { fakeGuard } from "../../helpers/fakes.ts";
import { createSkillService } from "../../../src/components/skill/index.ts";
import { systemClock, uuidv7Ids } from "../../../src/core/platform/index.ts";

let ctx: TestContext;

function sections(prefix = "") {
  return {
    overview: `${prefix}概览`,
    steps: `${prefix}步骤`,
    examples: `${prefix}示例`,
    scripts: `${prefix}脚本`,
    verification: `${prefix}验证`,
  };
}

function skillBody(name = "CRES 技能") {
  return {
    name,
    categoryCode: "coding",
    summary: "按 CRES 规范产出需求与方案文档",
    tags: ["规范", "文档"],
    triggers: ["写需求", "出方案"],
    sections: sections(),
    pitfalls: ["跳过步骤 2"],
    refs: [
      { label: "CRES 规范", refType: "规范" },
      { label: "workspace:/knowledge/cres.md", refType: "运行期注入", path: "/knowledge/cres.md" },
    ],
  };
}

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
  test("新建为 v1.0，五章与有序子表完整回读", async () => {
    const created = await ctx.skillService.create(skillBody());
    expect(created).toMatchObject({ revision: 1, version: "v1.0" });
    const detail = await ctx.catalog.getSkill(created.id);
    expect(detail.version).toBe("v1.0");
    expect(detail.categoryLabel).toBe("编码");
    expect(detail.sections).toEqual(sections());
    expect(detail.tags).toEqual(["规范", "文档"]);
    expect(detail.triggers).toEqual(["写需求", "出方案"]);
    expect(detail.pitfalls).toEqual(["跳过步骤 2"]);
    expect(detail.refs[1]).toEqual({
      label: "workspace:/knowledge/cres.md",
      refType: "运行期注入",
      path: "/knowledge/cres.md",
    });
  });

  test("分类不存在、摘要超长、五章缺失、标签重复都被拒绝", async () => {
    const badCategory = await ctx.skillService
      .create({ ...skillBody("x1"), categoryCode: "unknown" })
      .catch((e) => e);
    expect(badCategory).toBeInstanceOf(CategoryNotFoundError);
    expect(badCategory.details.field).toBe("categoryCode");

    const longSummary = await ctx.skillService
      .create({ ...skillBody("x2"), summary: "字".repeat(201) })
      .catch((e) => e);
    expect(longSummary).toBeInstanceOf(ValidationError);
    expect(longSummary.details.field).toBe("summary");

    const missingSection = await ctx.skillService
      .create({
        ...skillBody("x3"),
        sections: { overview: "o", steps: "s", examples: "e", scripts: "sc" } as unknown as SkillSections,
      })
      .catch((e) => e);
    expect(missingSection).toBeInstanceOf(ValidationError);
    expect(missingSection.details.field).toBe("sections.verification");

    const duplicateTag = await ctx.skillService
      .create({ ...skillBody("x4"), tags: ["a", "a"] })
      .catch((e) => e);
    expect(duplicateTag).toBeInstanceOf(ValidationError);
    expect(duplicateTag.details.field).toBe("tags");
  });

  test("更新递增 minor 版本并整体替换子表，旧 revision 冲突", async () => {
    const created = await ctx.skillService.create(skillBody());
    const updated = await ctx.skillService.update(created.id, 1, {
      ...skillBody("CRES 技能 v2"),
      tags: ["新标签"],
      triggers: [],
      refs: [],
    });
    expect(updated).toMatchObject({ revision: 2, version: "v1.1" });
    const detail = await ctx.catalog.getSkill(created.id);
    expect(detail.tags).toEqual(["新标签"]);
    expect(detail.triggers).toEqual([]);
    expect(detail.refs).toEqual([]);

    const stale = await ctx.skillService.update(created.id, 1, skillBody()).catch((e) => e);
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect(stale.details.currentRevision).toBe(2);
  });

  test("版本从 v1.9 进位到 v2.0", async () => {
    const created = await ctx.skillService.create(skillBody());
    await ctx.db.query("update skill set version = 'v1.9' where id = $1", [created.id]);
    const updated = await ctx.skillService.update(created.id, 1, skillBody());
    expect(updated.version).toBe("v2.0");
  });

  test("被专家引用时拒绝删除；无引用时删除并级联子表", async () => {
    const created = await ctx.skillService.create(skillBody());
    const guard = fakeGuard([{ type: "expert", id: "expert-1", name: "方案设计专家" }]);
    const guarded = createSkillService({
      db: ctx.db,
      clock: systemClock,
      ids: uuidv7Ids,
      guard,
      actor: "tester",
    });
    const error = await guarded.delete(created.id, 1).catch((e) => e);
    expect(error).toBeInstanceOf(ReferencedError);
    expect(error.details.references[0].name).toBe("方案设计专家");

    await ctx.skillService.delete(created.id, 1);
    const rows = await ctx.db.query("select 1 from skill_section where skill_id = $1", [created.id]);
    expect(rows.length).toBe(0);
    const missing = await ctx.catalog.getSkill(created.id).catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);
  });
});

describe("Skill 读契约", () => {
  test("列表按分类、标签、启停筛选并返回分类标签与引用计数", async () => {
    await ctx.skillService.create(skillBody("CRES 技能"));
    await ctx.skillService.create({
      ...skillBody("业务功能树检索"),
      categoryCode: "retrieval",
      tags: ["检索"],
    });
    await ctx.skillService.create({
      ...skillBody("LDP 技能"),
      categoryCode: "coding",
      tags: ["低代码"],
    });

    const coding = await ctx.catalog.listSkills({
      categoryCode: "coding",
      page: normalizePageQuery(),
    });
    expect(coding.total).toBe(2);
    expect(coding.items.every((item) => item.categoryLabel === "编码")).toBe(true);

    const tagged = await ctx.catalog.listSkills({ tag: "检索", page: normalizePageQuery() });
    expect(tagged.total).toBe(1);
    expect(tagged.items[0]?.name).toBe("业务功能树检索");
    expect(tagged.items[0]?.usedByCount).toBe(0);
  });

  test("分类列表为 4 条参考数据，顺序稳定", async () => {
    const categories = await ctx.catalog.listSkillCategories();
    expect(categories).toEqual([
      { code: "coding", label: "编码", position: 0 },
      { code: "retrieval", label: "检索", position: 1 },
      { code: "review", label: "审视", position: 2 },
      { code: "testing", label: "测试", position: 3 },
    ]);
  });
});
