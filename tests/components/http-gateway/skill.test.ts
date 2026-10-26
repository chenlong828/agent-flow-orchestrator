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

const DESCRIPTION = "适用：产出需求与方案文档；触发词：写需求、出方案；不适用：纯技术重构。";

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

async function createSkill(name = "CRES 技能") {
  const response = await call(ctx.app, "POST", "/api/v1/skills", { body: skillBody(name) });
  expect(response.status).toBe(201);
  return response.body as Record<string, any>;
}

async function callText(path: string, headers: Record<string, string> = {}) {
  const response = await ctx.app(
    new Request(`http://127.0.0.1:3000${path}`, { headers: new Headers(headers) }),
  );
  return { status: response.status, text: await response.text(), headers: response.headers };
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
    expect(coding.body.items[0].description).toBe(DESCRIPTION);
    expect(coding.body.items[0].triggers).toBeUndefined();

    const tagged = await call(ctx.app, "GET", "/api/v1/skills?tag=检索&enabled=true");
    expect(tagged.body.total).toBe(1);
    expect(tagged.body.items[0].name).toBe("业务功能树检索");
  });

  test("GET 详情 200；不存在 404", async () => {
    const created = await createSkill();
    const detail = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.description).toBe(DESCRIPTION);
    expect(detail.body.triggers).toBeUndefined();
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
      body: { ...skillBody("CRES 技能 v2"), tags: ["新标签"], refs: [] },
      headers: withRevision(1),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe("v1.1");
    expect(updated.body.tags).toEqual(["新标签"]);
    expect(updated.body.refs).toEqual([]);
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

  test("POST 拒绝 version/enabled 未知字段、非法分类、五章缺失、超长描述与旧字段", async () => {
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

    const longDescription = await call(ctx.app, "POST", "/api/v1/skills", {
      body: { ...skillBody("x4"), description: "字".repeat(401) },
    });
    expect(longDescription.status).toBe(400);
    expect(longDescription.body.error.details.field).toBe("description");

    const legacyFields = await call(ctx.app, "POST", "/api/v1/skills", {
      body: { ...skillBody("x5"), summary: "旧摘要", triggers: ["旧触发"] },
    });
    expect(legacyFields.status).toBe(400);
    expect(legacyFields.body.error.details.field).toBe("body");
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

  test("API-14 空库返回默认分页信封，支持 q/启停筛选与分页排序", async () => {
    const empty = await call(ctx.app, "GET", "/api/v1/skills");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ items: [], total: 0, limit: 50, offset: 0 });

    const alpha = await createSkill("alpha");
    await createSkill("beta");
    await createSkill("gamma");
    await call(ctx.app, "PATCH", `/api/v1/skills/${alpha.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(1),
    });

    const searched = await call(ctx.app, "GET", "/api/v1/skills?q=BETA&unknown=1");
    expect(searched.body.total).toBe(1);
    expect(searched.body.items[0].name).toBe("beta");

    const disabled = await call(ctx.app, "GET", "/api/v1/skills?enabled=false");
    expect(disabled.body.total).toBe(1);
    expect(disabled.body.items[0].name).toBe("alpha");

    const page = await call(ctx.app, "GET", "/api/v1/skills?limit=1&offset=1&sort=name:desc");
    expect(page.body).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect(page.body.items.map((item: any) => item.name)).toEqual(["beta"]);
  });

  test("API-15 详情 usedByCount 随专家装配变化", async () => {
    const created = await createSkill("detail-skill");
    const expert = await ctx.expertService.create({
      name: "详情专家",
      color: "#2563eb",
      role: "详情",
    });
    await ctx.expertService.setSkills(expert.id, 1, [created.id]);

    const bound = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(bound.body.usedByCount).toBe(1);
    expect(bound.body.description).toBe(DESCRIPTION);

    await ctx.expertService.setSkills(expert.id, 2, []);
    const cleared = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(cleared.body.usedByCount).toBe(0);
  });

  test("API-16 最小创建体默认空子表，完整创建体保留子表顺序", async () => {
    const response = await call(ctx.app, "POST", "/api/v1/skills", {
      body: {
        name: "minimal-skill",
        categoryCode: "review",
        description: "最小技能",
        sections: sections(),
      },
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      version: "v1.0",
      enabled: true,
      tags: [],
      pitfalls: [],
      refs: [],
      usedByCount: 0,
      revision: 1,
    });

    const full = await call(ctx.app, "POST", "/api/v1/skills", {
      body: {
        ...skillBody("ordered-skill"),
        tags: ["第二标签", "第一标签"],
        refs: [
          { label: "参考乙", refType: "经验" },
          { label: "参考甲", refType: "规范", path: "/knowledge/a.md" },
        ],
      },
    });
    expect(full.status).toBe(201);
    expect(full.body.tags).toEqual(["第二标签", "第一标签"]);
    expect(full.body.refs).toEqual([
      { label: "参考乙", refType: "经验", path: null },
      { label: "参考甲", refType: "规范", path: "/knowledge/a.md" },
    ]);
  });

  test("API-16 拒绝旧字段 summary/triggers 与非法引用 path", async () => {
    const legacyField = await call(ctx.app, "POST", "/api/v1/skills", {
      body: { ...skillBody("trigger-dup"), triggers: ["同一触发"] },
    });
    expect(legacyField.status).toBe(400);
    expect(legacyField.body.error.details.field).toBe("body");

    const badPath = await call(ctx.app, "POST", "/api/v1/skills", {
      body: {
        ...skillBody("bad-ref-path"),
        refs: [{ label: "参考", refType: "经验", path: 1 }],
      },
    });
    expect(badPath.status).toBe(400);
    expect(badPath.body.error.details.field).toBe("refs.0.path");
  });

  test("API-17 连续保存递增版本到 v1.2，并可修改名称", async () => {
    const created = await createSkill("version-skill");
    const first = await call(ctx.app, "PUT", `/api/v1/skills/${created.id}`, {
      body: skillBody("version-skill"),
      headers: withRevision(1),
    });
    expect(first.body).toMatchObject({ version: "v1.1", revision: 2 });

    const second = await call(ctx.app, "PUT", `/api/v1/skills/${created.id}`, {
      body: skillBody("renamed-skill"),
      headers: withRevision(2),
    });
    expect(second.body).toMatchObject({
      name: "renamed-skill",
      version: "v1.2",
      revision: 3,
    });

    const list = await call(ctx.app, "GET", "/api/v1/skills?q=renamed");
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].version).toBe("v1.2");
  });

  test("API-18 可重新启用；缺少 If-Match 428；资源不存在 404", async () => {
    const created = await createSkill("toggle-skill");
    const disabled = await call(ctx.app, "PATCH", `/api/v1/skills/${created.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(1),
    });
    expect(disabled.body).toMatchObject({ enabled: false, revision: 2 });

    const enabled = await call(ctx.app, "PATCH", `/api/v1/skills/${created.id}/enabled`, {
      body: { enabled: true },
      headers: withRevision(2),
    });
    expect(enabled.body).toMatchObject({ enabled: true, revision: 3 });

    const missingPrecondition = await call(
      ctx.app,
      "PATCH",
      `/api/v1/skills/${created.id}/enabled`,
      { body: { enabled: false } },
    );
    expect(missingPrecondition.status).toBe(428);

    const missing = await call(
      ctx.app,
      "PATCH",
      "/api/v1/skills/0191f2f0-0000-7000-8000-000000000000/enabled",
      { body: { enabled: true }, headers: withRevision(1) },
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");

    const stale = await call(ctx.app, "PATCH", `/api/v1/skills/${created.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(2),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("revision_conflict");
    expect(stale.body.error.details.currentRevision).toBe(3);
  });

  test("API-19 删除使用旧 revision 返回 409，且不删除资源", async () => {
    const created = await createSkill("stale-delete-skill");
    const stale = await call(ctx.app, "DELETE", `/api/v1/skills/${created.id}`, {
      headers: withRevision(2),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentRevision).toBe(1);

    const stillThere = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(stillThere.status).toBe(200);
    const deleted = await call(ctx.app, "DELETE", `/api/v1/skills/${created.id}`, {
      headers: withRevision(1),
    });
    expect(deleted.status).toBe(204);
    const missing = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(missing.status).toBe(404);
  });

  test("API-20 引用页返回多个专家；资产不存在 404", async () => {
    const created = await createSkill("multi-ref-skill");
    for (const name of ["专家乙", "专家甲"]) {
      const expert = await ctx.expertService.create({
        name,
        color: "#7c3aed",
        role: "引用",
      });
      await ctx.expertService.setSkills(expert.id, 1, [created.id]);
    }

    const references = await call(ctx.app, "GET", `/api/v1/skills/${created.id}/references`);
    expect(references.status).toBe(200);
    expect(references.body.total).toBe(2);
    expect(references.body.items.every((item: any) => item.type === "expert")).toBe(true);
    expect(references.body.items.map((item: any) => item.name).sort()).toEqual([
      "专家乙",
      "专家甲",
    ]);

    const missing = await call(
      ctx.app,
      "GET",
      "/api/v1/skills/0191f2f0-0000-7000-8000-000000000000/references",
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
  });

  test("API-31 文档输出：markdown、ETag、304、404", async () => {
    const created = await createSkill();
    const response = await callText(`/api/v1/skills/${created.id}/document`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("etag")).toBe('"1"');
    expect(response.text).toContain('name: "CRES 技能"');
    expect(response.text).toContain(`description: "${DESCRIPTION}"`);
    expect(response.text).toContain('version: "v1.0"');
    expect(response.text.indexOf("## 流程总述")).toBeLessThan(
      response.text.indexOf("## 执行步骤"),
    );
    expect(response.text).toContain("- 跳过步骤 2");
    expect(response.text).toContain("## 参考资料");

    const cached = await callText(`/api/v1/skills/${created.id}/document`, {
      "if-none-match": '"1"',
    });
    expect(cached.status).toBe(304);
    expect(cached.text).toBe("");

    const missing = await callText(
      "/api/v1/skills/0191f2f0-0000-7000-8000-000000000000/document",
    );
    expect(missing.status).toBe(404);
  });

  test("API-31 停用的 Skill 照常输出文档", async () => {
    const created = await createSkill("disabled-skill");
    await call(ctx.app, "PATCH", `/api/v1/skills/${created.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(1),
    });
    const response = await callText(`/api/v1/skills/${created.id}/document`);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2"');
    expect(response.text).toContain('name: "disabled-skill"');
  });

  test("API-21 分类参考数据返回稳定顺序与完整字段", async () => {
    const response = await call(ctx.app, "GET", "/api/v1/skill-categories");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.body).toEqual({
      items: [
        { code: "coding", label: "编码", position: 0 },
        { code: "retrieval", label: "检索", position: 1 },
        { code: "review", label: "审视", position: 2 },
        { code: "testing", label: "测试", position: 3 },
      ],
    });
  });
});
