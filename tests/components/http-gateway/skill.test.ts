import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";

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

async function createSkill(name = "CRES 技能") {
  const response = await call(ctx.app, "POST", "/api/v1/skills", { body: skillBody(name) });
  expect(response.status).toBe(201);
  return response.body as Record<string, any>;
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

describe("Skill HTTP 契约", () => {
  test("GET /skill-categories 返回 4 条参考数据", async () => {
    const response = await call(ctx.app, "GET", "/api/v1/skill-categories");
    expect(response.status).toBe(200);
    expect(response.body.items.map((item: any) => item.code)).toEqual([
      "coding",
      "retrieval",
      "review",
      "testing",
    ]);
  });

  test("POST 201、Location、v1.0 与完整五章/子表", async () => {
    const response = await call(ctx.app, "POST", "/api/v1/skills", { body: skillBody() });
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(`/api/v1/skills/${response.body.id}`);
    expect(response.body).toMatchObject({
      version: "v1.0",
      categoryCode: "coding",
      categoryLabel: "编码",
      enabled: true,
      usedByCount: 0,
      revision: 1,
    });
    expect(response.body.sections).toEqual(sections());
    expect(response.body.refs[1].path).toBe("/knowledge/cres.md");
    expect(response.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("GET 列表按 category/tag/enabled 筛选", async () => {
    await createSkill("CRES 技能");
    await call(ctx.app, "POST", "/api/v1/skills", {
      body: { ...skillBody("业务功能树检索"), categoryCode: "retrieval", tags: ["检索"] },
    });
    const coding = await call(ctx.app, "GET", "/api/v1/skills?category=coding");
    expect(coding.status).toBe(200);
    expect(coding.body.total).toBe(1);
    expect(coding.body.items[0].categoryLabel).toBe("编码");

    const tagged = await call(ctx.app, "GET", "/api/v1/skills?tag=检索&enabled=true");
    expect(tagged.body.total).toBe(1);
    expect(tagged.body.items[0].name).toBe("业务功能树检索");
  });

  test("GET 详情 200；不存在 404", async () => {
    const created = await createSkill();
    const detail = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.triggers).toEqual(["写需求", "出方案"]);
    expect(detail.body.pitfalls).toEqual(["跳过步骤 2"]);

    const missing = await call(
      ctx.app,
      "GET",
      "/api/v1/skills/0191f2f0-0000-7000-8000-000000000000",
    );
    expect(missing.status).toBe(404);
  });

  test("PUT 200 递增版本并整体替换子表；缺 If-Match 428；旧版本 409", async () => {
    const created = await createSkill();
    const updated = await call(ctx.app, "PUT", `/api/v1/skills/${created.id}`, {
      body: { ...skillBody("CRES 技能 v2"), tags: ["新标签"], triggers: [], refs: [] },
      headers: withRevision(1),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe("v1.1");
    expect(updated.body.tags).toEqual(["新标签"]);
    expect(updated.body.triggers).toEqual([]);
    expect(updated.body.revision).toBe(2);

    const missing = await call(ctx.app, "PUT", `/api/v1/skills/${created.id}`, {
      body: skillBody(),
    });
    expect(missing.status).toBe(428);

    const stale = await call(ctx.app, "PUT", `/api/v1/skills/${created.id}`, {
      body: skillBody(),
      headers: withRevision(1),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentRevision).toBe(2);
  });

  test("PATCH enabled 200；启用状态可回读", async () => {
    const created = await createSkill();
    const disabled = await call(ctx.app, "PATCH", `/api/v1/skills/${created.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(1),
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);
    const detail = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(detail.body.enabled).toBe(false);
  });

  test("POST 拒绝 version/enabled 未知字段、非法分类、五章缺失与超长摘要", async () => {
    const versionField = await call(ctx.app, "POST", "/api/v1/skills", {
      body: { ...skillBody("x1"), version: "v9.9" },
    });
    expect(versionField.status).toBe(400);
    expect(versionField.body.error.code).toBe("validation_error");

    const badCategory = await call(ctx.app, "POST", "/api/v1/skills", {
      body: { ...skillBody("x2"), categoryCode: "unknown" },
    });
    expect(badCategory.status).toBe(400);
    expect(badCategory.body.error.details.field).toBe("categoryCode");

    const missingSection = await call(ctx.app, "POST", "/api/v1/skills", {
      body: {
        ...skillBody("x3"),
        sections: { overview: "o", steps: "s", examples: "e", scripts: "sc" },
      },
    });
    expect(missingSection.status).toBe(400);

    const longSummary = await call(ctx.app, "POST", "/api/v1/skills", {
      body: { ...skillBody("x4"), summary: "字".repeat(201) },
    });
    expect(longSummary.status).toBe(400);
    expect(longSummary.body.error.details.field).toBe("summary");
  });

  test("DELETE 204；被专家引用 409；重复删除 404", async () => {
    const created = await createSkill();
    const expert = await ctx.expertService.create({
      name: "方案设计专家",
      color: "#7c3aed",
      role: "设计",
    });
    await ctx.expertService.setSkills(expert.id, 1, [created.id]);

    const blocked = await call(ctx.app, "DELETE", `/api/v1/skills/${created.id}`, {
      headers: withRevision(1),
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("referenced");
    expect(blocked.body.error.details.references[0].name).toBe("方案设计专家");

    await ctx.expertService.setSkills(expert.id, 2, []);
    const deleted = await call(ctx.app, "DELETE", `/api/v1/skills/${created.id}`, {
      headers: withRevision(1),
    });
    expect(deleted.status).toBe(204);

    const again = await call(ctx.app, "DELETE", `/api/v1/skills/${created.id}`, {
      headers: withRevision(1),
    });
    expect(again.status).toBe(404);
  });

  test("GET references 返回引用方；非法 limit/sort 400", async () => {
    const created = await createSkill();
    const response = await call(ctx.app, "GET", `/api/v1/skills/${created.id}/references`);
    expect(response.status).toBe(200);
    expect(response.body.asset).toEqual({
      type: "skill",
      id: created.id,
      name: "CRES 技能",
    });
    expect(response.body.items).toEqual([]);

    const badSort = await call(ctx.app, "GET", "/api/v1/skills?sort=version:up");
    expect(badSort.status).toBe(400);
  });
});
