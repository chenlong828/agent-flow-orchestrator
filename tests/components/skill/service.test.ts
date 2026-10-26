import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  NameConflictError,
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

const DESCRIPTION = "适用：产出需求与方案文档；触发词：写需求、出方案。";

function skillBody(name = "CRES 技能") {
  return {
    name,
    categoryCode: "coding",
    description: DESCRIPTION,
    tags: ["规范", "文档"],
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
    expect(detail.description).toBe(DESCRIPTION);
    expect(detail.sections).toEqual(sections());
    expect(detail.tags).toEqual(["规范", "文档"]);
    expect(detail).not.toHaveProperty("triggers");
    expect(detail.pitfalls).toEqual(["跳过步骤 2"]);
    expect(detail.refs[1]).toEqual({
      label: "workspace:/knowledge/cres.md",
      refType: "运行期注入",
      path: "/knowledge/cres.md",
    });
  });

  test("分类不存在、描述超长、五章缺失、标签重复都被拒绝", async () => {
    const badCategory = await ctx.skillService
      .create({ ...skillBody("x1"), categoryCode: "unknown" })
      .catch((e) => e);
    expect(badCategory).toBeInstanceOf(CategoryNotFoundError);
    expect(badCategory.details.field).toBe("categoryCode");

    const longDescription = await ctx.skillService
      .create({ ...skillBody("x2"), description: "字".repeat(401) })
      .catch((e) => e);
    expect(longDescription).toBeInstanceOf(ValidationError);
    expect(longDescription.details.field).toBe("description");

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

  test("名称唯一，引用 path 必须是字符串或空", async () => {
    await ctx.skillService.create(skillBody("unique-skill"));
    const duplicateName = await ctx.skillService
      .create(skillBody("UNIQUE-SKILL"))
      .catch((e) => e);
    expect(duplicateName).toBeInstanceOf(NameConflictError);
    expect(duplicateName.code).toBe("name_conflict");

    const badRefPath = await ctx.skillService
      .create({
        ...skillBody("bad-ref-path"),
        refs: [{ label: "参考", refType: "经验", path: 1 as never }],
      })
      .catch((e) => e);
    expect(badRefPath).toBeInstanceOf(ValidationError);
    expect(badRefPath.details.field).toBe("refs.0.path");
  });

  test("更新拒绝改名冲突，原名称与版本不变", async () => {
    const first = await ctx.skillService.create(skillBody("update-a"));
    await ctx.skillService.create(skillBody("update-b"));
    const conflict = await ctx.skillService
      .update(first.id, 1, skillBody("update-b"))
      .catch((e) => e);
    expect(conflict).toBeInstanceOf(NameConflictError);

    const after = await ctx.catalog.getSkill(first.id);
    expect(after.name).toBe("update-a");
    expect(after.version).toBe("v1.0");
    expect(after.revision).toBe(1);
  });

  test("启停拒绝非布尔值，未知资源 404，旧 revision 409", async () => {
    const badValue = await ctx.skillService
      .setEnabled("0191f2f0-0000-7000-8000-000000000000", 1, "false" as never)
      .catch((e) => e);
    expect(badValue).toBeInstanceOf(ValidationError);
    expect(badValue.details.field).toBe("enabled");

    const missing = await ctx.skillService
      .setEnabled("0191f2f0-0000-7000-8000-000000000000", 1, false)
      .catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);

    const created = await ctx.skillService.create(skillBody("toggle-skill"));
    await ctx.skillService.setEnabled(created.id, 1, false);
    const stale = await ctx.skillService.setEnabled(created.id, 1, true).catch((e) => e);
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect(stale.details.currentRevision).toBe(2);
  });

  test("删除未知资源 404，旧 revision 409", async () => {
    const missing = await ctx.skillService
      .delete("0191f2f0-0000-7000-8000-000000000000", 1)
      .catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);

    const created = await ctx.skillService.create(skillBody("delete-stale"));
    const stale = await ctx.skillService.delete(created.id, 2).catch((e) => e);
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect(stale.details.currentRevision).toBe(1);
  });

  test("更新递增 minor 版本并整体替换子表，旧 revision 冲突", async () => {
    const created = await ctx.skillService.create(skillBody());
    const updated = await ctx.skillService.update(created.id, 1, {
      ...skillBody("CRES 技能 v2"),
      description: "新的路由描述",
      tags: ["新标签"],
      refs: [],
    });
    expect(updated).toMatchObject({ revision: 2, version: "v1.1" });
    const detail = await ctx.catalog.getSkill(created.id);
    expect(detail.description).toBe("新的路由描述");
    expect(detail.tags).toEqual(["新标签"]);
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

describe("Skill 文档合成", () => {
  test("frontmatter 三键 + 五章 + 踩坑 + 参考资料，顺序固定", async () => {
    const created = await ctx.skillService.create(skillBody());
    const document = await ctx.skillRead.getDocument(created.id);
    expect(document.revision).toBe(1);
    const expected =
      [
        "---",
        'name: "CRES 技能"',
        `description: "${DESCRIPTION}"`,
        'version: "v1.0"',
        "---",
        "",
        "## 流程总述",
        "",
        "概览",
        "",
        "## 执行步骤",
        "",
        "步骤",
        "",
        "## 示例",
        "",
        "示例",
        "",
        "## 脚本",
        "",
        "脚本",
        "",
        "## 完成验证",
        "",
        "验证",
        "",
        "## 常见踩坑",
        "",
        "- 跳过步骤 2",
        "",
        "## 参考资料",
        "",
        "- CRES 规范（规范）",
        "- workspace:/knowledge/cres.md（运行期注入） — /knowledge/cres.md",
      ].join("\n") + "\n";
    expect(document.markdown).toBe(expected);
  });

  test("空五章保留标题；无踩坑与引用时两整节省略", async () => {
    const created = await ctx.skillService.create({
      ...skillBody("空文档"),
      sections: { overview: "", steps: "", examples: "", scripts: "", verification: "" },
      pitfalls: [],
      refs: [],
    });
    const document = await ctx.skillRead.getDocument(created.id);
    expect(document.markdown).toContain("## 流程总述\n\n## 执行步骤");
    expect(document.markdown).not.toContain("## 常见踩坑");
    expect(document.markdown).not.toContain("## 参考资料");
    expect(document.markdown.endsWith("\n")).toBe(true);
  });

  test("frontmatter 对引号、反斜杠与换行做转义", async () => {
    const created = await ctx.skillService.create({
      ...skillBody("转义技能"),
      description: '含 "引号" 与\\反斜杠\n第二行',
    });
    const document = await ctx.skillRead.getDocument(created.id);
    expect(document.markdown).toContain(
      'description: "含 \\"引号\\" 与\\\\反斜杠\\n第二行"',
    );
  });

  test("文档读取与详情一致：版本变化后 revision 同步", async () => {
    const created = await ctx.skillService.create(skillBody());
    await ctx.skillService.update(created.id, 1, skillBody("CRES 技能 v2"));
    const document = await ctx.skillRead.getDocument(created.id);
    expect(document.revision).toBe(2);
    expect(document.markdown).toContain('version: "v1.1"');
    expect(document.markdown).toContain('name: "CRES 技能 v2"');
  });

  test("不存在的 Skill 读取文档返回 404", async () => {
    const missing = await ctx.skillRead
      .getDocument("0191f2f0-0000-7000-8000-000000000000")
      .catch((e) => e);
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
    expect(tagged.items[0]?.description).toBe(DESCRIPTION);
    expect(tagged.items[0]).not.toHaveProperty("triggers");
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

  test("列表支持名称/描述检索、启停筛选与排序分页，摘要可单独读取", async () => {
    const first = await ctx.skillService.create(skillBody("read-a"));
    await ctx.skillService.create(skillBody("read-b"));
    await ctx.skillService.create(skillBody("read-c"));
    await ctx.skillService.setEnabled(first.id, 1, false);

    const searched = await ctx.skillRead.list({ q: "READ", page: normalizePageQuery() });
    expect(searched.total).toBe(3);

    const byDescription = await ctx.skillRead.list({
      q: "方案文档",
      page: normalizePageQuery(),
    });
    expect(byDescription.total).toBe(3);

    const disabled = await ctx.skillRead.list({
      enabled: false,
      page: normalizePageQuery(),
    });
    expect(disabled.total).toBe(1);
    expect(disabled.items[0]?.name).toBe("read-a");

    const page = await ctx.skillRead.list({
      page: normalizePageQuery(2, 0),
      sort: "-name",
    });
    expect(page.items.map((item) => item.name)).toEqual(["read-c", "read-b"]);

    const summary = await ctx.skillRead.getSummary(first.id);
    expect(summary).toMatchObject({
      name: "read-a",
      version: "v1.0",
      tags: ["规范", "文档"],
      description: DESCRIPTION,
    });

    const missing = await ctx.skillRead
      .getSummary("0191f2f0-0000-7000-8000-000000000000")
      .catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);
  });
});
