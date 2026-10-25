import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;
let harnessId: string;
let skillIds: string[];
let toolIds: string[];

function expertBody(name = "方案设计专家") {
  return {
    name,
    color: "#7c3aed",
    role: "在遗留方案基础上给出变更方案",
    persona: ["全局观", "谨慎"],
    duty: "输出技术方案与任务拆分",
    skillOrder: "先检索现状，再设计",
    verifyOrder: "完整性对照",
    notes: "优先复用公共能力",
    refs: [{ label: "架构设计红线的 Brief", refType: "经验" }],
  };
}

async function createExpert(name = "方案设计专家") {
  const response = await call(ctx.app, "POST", "/api/v1/experts", { body: expertBody(name) });
  expect(response.status).toBe(201);
  return response.body as Record<string, any>;
}

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await resetBusinessData();
  const harness = await ctx.harnessService.create({
    name: "build-01",
    kind: "container",
    address: "10.0.4.11:7801",
    accessMode: "container_registry",
    concurrencyMax: 20,
    queuePolicy: "fifo",
  });
  harnessId = harness.id;
  const skill1 = await ctx.skillService.create({
    name: "CRES 技能",
    categoryCode: "coding",
    summary: "s",
    sections: { overview: "o", steps: "s", examples: "e", scripts: "sc", verification: "v" },
  });
  const skill2 = await ctx.skillService.create({
    name: "调用链分析",
    categoryCode: "retrieval",
    summary: "s",
    sections: { overview: "o", steps: "s", examples: "e", scripts: "sc", verification: "v" },
  });
  skillIds = [skill1.id, skill2.id];
  const tool1 = await ctx.toolService.create({
    name: "trace",
    kind: "cli",
    invocation: "trace {p}",
    harnessId,
    timeoutMs: 30000,
  });
  const tool2 = await ctx.toolService.create({
    name: "dsl-search",
    kind: "mcp",
    invocation: "dsl.search",
    harnessId,
    timeoutMs: 60000,
  });
  toolIds = [tool1.id, tool2.id];
});

afterAll(async () => {
  await closeTestDb();
});

describe("专家 HTTP 契约", () => {
  test("POST 201、Location、五区与人设/引用完整返回", async () => {
    const response = await call(ctx.app, "POST", "/api/v1/experts", {
      body: expertBody(),
      headers: { "x-actor": "bob" },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(`/api/v1/experts/${response.body.id}`);
    expect(response.body).toMatchObject({
      name: "方案设计专家",
      color: "#7c3aed",
      enabled: true,
      persona: ["全局观", "谨慎"],
      skillCount: 0,
      toolCount: 0,
      refCount: 0,
      revision: 1,
    });
    expect(response.body.refs).toEqual([
      { label: "架构设计红线的 Brief", refType: "经验", path: null },
    ]);
  });

  test("GET 列表返回计数与人设，并支持筛选", async () => {
    await createExpert("expert-a");
    await createExpert("expert-b");
    const list = await call(ctx.app, "GET", "/api/v1/experts?limit=10&sort=name:asc");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.items[0]).toMatchObject({
      name: "expert-a",
      skillCount: 0,
      toolCount: 0,
      persona: ["全局观", "谨慎"],
    });
  });

  test("GET 详情返回解析后的 Skill/工具摘要；不存在 404", async () => {
    const created = await createExpert();
    await ctx.expertService.setSkills(created.id, 1, skillIds);
    await ctx.expertService.setTools(created.id, 2, [toolIds[1]!]);
    const detail = await call(ctx.app, "GET", `/api/v1/experts/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.skills.map((skill: any) => skill.name)).toEqual([
      "CRES 技能",
      "调用链分析",
    ]);
    expect(detail.body.skills[0].categoryLabel).toBe("编码");
    expect(detail.body.tools).toEqual([
      { id: toolIds[1], name: "dsl-search", kind: "mcp", status: "unverified" },
    ]);

    const missing = await call(
      ctx.app,
      "GET",
      "/api/v1/experts/0191f2f0-0000-7000-8000-000000000000",
    );
    expect(missing.status).toBe(404);
  });

  test("PUT 200 并整体替换人设/引用；缺 If-Match 428；旧版本 409", async () => {
    const created = await createExpert();
    const updated = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}`, {
      body: { ...expertBody("方案设计专家 v2"), persona: ["独立"], refs: [] },
      headers: withRevision(1),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("方案设计专家 v2");
    expect(updated.body.persona).toEqual(["独立"]);
    expect(updated.body.refs).toEqual([]);
    expect(updated.body.revision).toBe(2);

    const missing = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}`, {
      body: expertBody(),
    });
    expect(missing.status).toBe(428);

    const stale = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}`, {
      body: expertBody(),
      headers: withRevision(1),
    });
    expect(stale.status).toBe(409);
  });

  test("PATCH enabled 200；非法颜色 400", async () => {
    const created = await createExpert();
    const disabled = await call(ctx.app, "PATCH", `/api/v1/experts/${created.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(1),
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);

    const badColor = await call(ctx.app, "POST", "/api/v1/experts", {
      body: { ...expertBody("x1"), color: "purple" },
    });
    expect(badColor.status).toBe(400);
    expect(badColor.body.error.details.field).toBe("color");
  });

  test("PUT /experts/{id}/skills 200 保持顺序；重复/不存在 400；旧版本 409", async () => {
    const created = await createExpert();
    const ok = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/skills`, {
      body: { items: skillIds.map((skillId) => ({ skillId })) },
      headers: withRevision(1),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.skills.map((skill: any) => skill.id)).toEqual(skillIds);
    expect(ok.body.revision).toBe(2);

    const duplicate = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/skills`, {
      body: { items: [{ skillId: skillIds[0] }, { skillId: skillIds[0] }] },
      headers: withRevision(2),
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.details.field).toBe("items");

    const missing = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/skills`, {
      body: { items: [{ skillId: "0191f2f0-0000-7000-8000-000000000000" }] },
      headers: withRevision(2),
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("validation_error");

    const stale = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/skills`, {
      body: { items: [] },
      headers: withRevision(1),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentRevision).toBe(2);

    const unchanged = await call(ctx.app, "GET", `/api/v1/experts/${created.id}`);
    expect(unchanged.body.skills.map((skill: any) => skill.id)).toEqual(skillIds);
  });

  test("PUT /experts/{id}/tools 200 整体替换；缺 If-Match 428", async () => {
    const created = await createExpert();
    const first = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/tools`, {
      body: { items: toolIds.map((toolId) => ({ toolId })) },
      headers: withRevision(1),
    });
    expect(first.status).toBe(200);
    expect(first.body.tools.map((tool: any) => tool.id)).toEqual(toolIds);

    const replace = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/tools`, {
      body: { items: [{ toolId: toolIds[1] }] },
      headers: withRevision(2),
    });
    expect(replace.status).toBe(200);
    expect(replace.body.tools.map((tool: any) => tool.id)).toEqual([toolIds[1]]);

    const missingPrecondition = await call(
      ctx.app,
      "PUT",
      `/api/v1/experts/${created.id}/tools`,
      { body: { items: [] } },
    );
    expect(missingPrecondition.status).toBe(428);
  });

  test("DELETE 204 并清理装配；专家无 references 端点", async () => {
    const created = await createExpert();
    await ctx.expertService.setSkills(created.id, 1, [skillIds[0]!]);
    const deleted = await call(ctx.app, "DELETE", `/api/v1/experts/${created.id}`, {
      headers: withRevision(2),
    });
    expect(deleted.status).toBe(204);
    const rows = await ctx.db.query("select 1 from expert_skill where expert_id = $1", [created.id]);
    expect(rows.length).toBe(0);

    const refs = await call(ctx.app, "GET", `/api/v1/experts/${created.id}/references`);
    expect(refs.status).toBe(404);
  });

  test("POST 拒绝未知字段与非法装配字段", async () => {
    const unknown = await call(ctx.app, "POST", "/api/v1/experts", {
      body: { ...expertBody("x1"), skillCount: 3 },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("validation_error");

    const created = await createExpert();
    const badItem = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/skills`, {
      body: { items: [{ skillId: skillIds[0], name: "x" }] },
      headers: withRevision(1),
    });
    expect(badItem.status).toBe(400);
    expect(badItem.body.error.code).toBe("validation_error");
  });

  test("API-22 空库返回默认分页信封，支持 q/启停筛选与分页排序", async () => {
    const empty = await call(ctx.app, "GET", "/api/v1/experts");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ items: [], total: 0, limit: 50, offset: 0 });

    const alpha = await createExpert("alpha");
    await createExpert("beta");
    await createExpert("gamma");
    await call(ctx.app, "PATCH", `/api/v1/experts/${alpha.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(1),
    });

    const searched = await call(ctx.app, "GET", "/api/v1/experts?q=BETA&unknown=1");
    expect(searched.body.total).toBe(1);
    expect(searched.body.items[0].name).toBe("beta");

    const disabled = await call(ctx.app, "GET", "/api/v1/experts?enabled=false");
    expect(disabled.body.total).toBe(1);
    expect(disabled.body.items[0].name).toBe("alpha");

    const page = await call(ctx.app, "GET", "/api/v1/experts?limit=1&offset=1&sort=name:desc");
    expect(page.body).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect(page.body.items.map((item: any) => item.name)).toEqual(["beta"]);
  });

  test("API-23 详情返回五区完整字段与空装配", async () => {
    const created = await createExpert("detail-expert");
    const detail = await call(ctx.app, "GET", `/api/v1/experts/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      name: "detail-expert",
      color: "#7c3aed",
      role: "在遗留方案基础上给出变更方案",
      enabled: true,
      persona: ["全局观", "谨慎"],
      duty: "输出技术方案与任务拆分",
      skillOrder: "先检索现状，再设计",
      verifyOrder: "完整性对照",
      notes: "优先复用公共能力",
      skillCount: 0,
      toolCount: 0,
      refCount: 0,
      skills: [],
      tools: [],
      revision: 1,
    });
    expect(detail.body.refs).toEqual([
      { label: "架构设计红线的 Brief", refType: "经验", path: null },
    ]);
    expect(detail.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("API-24 最小创建体使用默认值，并允许创建即停用", async () => {
    const minimal = await call(ctx.app, "POST", "/api/v1/experts", {
      body: { name: "minimal-expert", color: "#000000", role: "最小专家" },
    });
    expect(minimal.status).toBe(201);
    expect(minimal.body).toMatchObject({
      enabled: true,
      persona: [],
      duty: "",
      skillOrder: "",
      verifyOrder: "",
      notes: "",
      refs: [],
      skillCount: 0,
      toolCount: 0,
      refCount: 0,
      revision: 1,
    });

    const disabled = await call(ctx.app, "POST", "/api/v1/experts", {
      body: { ...expertBody("disabled-expert"), enabled: false },
    });
    expect(disabled.status).toBe(201);
    expect(disabled.body.enabled).toBe(false);
  });

  test("API-25 更新五区不覆盖已装配的 Skill/工具", async () => {
    const created = await createExpert("assembled-expert");
    await ctx.expertService.setSkills(created.id, 1, skillIds);
    await ctx.expertService.setTools(created.id, 2, toolIds);

    const updated = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}`, {
      body: { ...expertBody("assembled-expert-2"), persona: [], refs: [] },
      headers: withRevision(3),
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: "assembled-expert-2",
      persona: [],
      refs: [],
      skillCount: 2,
      toolCount: 2,
      revision: 4,
    });
    expect(updated.body.skills.map((skill: any) => skill.id)).toEqual(skillIds);
    expect(updated.body.tools.map((tool: any) => tool.id)).toEqual(toolIds);
  });

  test("API-26 可重新启用；缺少 If-Match 428；资源不存在 404", async () => {
    const created = await createExpert("toggle-expert");
    const disabled = await call(ctx.app, "PATCH", `/api/v1/experts/${created.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(1),
    });
    expect(disabled.body).toMatchObject({ enabled: false, revision: 2 });

    const enabled = await call(ctx.app, "PATCH", `/api/v1/experts/${created.id}/enabled`, {
      body: { enabled: true },
      headers: withRevision(2),
    });
    expect(enabled.body).toMatchObject({ enabled: true, revision: 3 });

    const missingPrecondition = await call(
      ctx.app,
      "PATCH",
      `/api/v1/experts/${created.id}/enabled`,
      { body: { enabled: false } },
    );
    expect(missingPrecondition.status).toBe(428);

    const missing = await call(
      ctx.app,
      "PATCH",
      "/api/v1/experts/0191f2f0-0000-7000-8000-000000000000/enabled",
      { body: { enabled: true }, headers: withRevision(1) },
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");

    const stale = await call(ctx.app, "PATCH", `/api/v1/experts/${created.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(2),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("revision_conflict");
    expect(stale.body.error.details.currentRevision).toBe(3);
  });

  test("API-27 删除使用旧 revision 返回 409；删除后重复调用 404", async () => {
    const created = await createExpert("delete-expert");
    const stale = await call(ctx.app, "DELETE", `/api/v1/experts/${created.id}`, {
      headers: withRevision(2),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentRevision).toBe(1);

    const deleted = await call(ctx.app, "DELETE", `/api/v1/experts/${created.id}`, {
      headers: withRevision(1),
    });
    expect(deleted.status).toBe(204);
    const again = await call(ctx.app, "DELETE", `/api/v1/experts/${created.id}`, {
      headers: withRevision(1),
    });
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe("not_found");
  });

  test("API-28 装配可清空；重复 Skill 与不存在目标返回 400；缺 If-Match 428", async () => {
    const created = await createExpert("skill-assembly");
    const first = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/skills`, {
      body: { items: skillIds.map((skillId) => ({ skillId })) },
      headers: withRevision(1),
    });
    expect(first.body.skillCount).toBe(2);

    const cleared = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/skills`, {
      body: { items: [] },
      headers: withRevision(2),
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.skills).toEqual([]);
    expect(cleared.body.skillCount).toBe(0);

    const duplicate = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/skills`, {
      body: { items: [{ skillId: skillIds[0] }, { skillId: skillIds[0] }] },
      headers: withRevision(3),
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.details.field).toBe("items");

    const missingTarget = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/skills`, {
      body: { items: [{ skillId: "0191f2f0-0000-7000-8000-000000000000" }] },
      headers: withRevision(3),
    });
    expect(missingTarget.status).toBe(400);
    expect(missingTarget.body.error.code).toBe("validation_error");

    const missingPrecondition = await call(
      ctx.app,
      "PUT",
      `/api/v1/experts/${created.id}/skills`,
      { body: { items: [] } },
    );
    expect(missingPrecondition.status).toBe(428);
  });

  test("API-29 装配可清空；重复工具与不存在目标返回 400；缺 If-Match 428", async () => {
    const created = await createExpert("tool-assembly");
    const first = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/tools`, {
      body: { items: toolIds.map((toolId) => ({ toolId })) },
      headers: withRevision(1),
    });
    expect(first.body.toolCount).toBe(2);

    const cleared = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/tools`, {
      body: { items: [] },
      headers: withRevision(2),
    });
    expect(cleared.body.tools).toEqual([]);
    expect(cleared.body.toolCount).toBe(0);

    const duplicate = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/tools`, {
      body: { items: [{ toolId: toolIds[0] }, { toolId: toolIds[0] }] },
      headers: withRevision(3),
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error.details.field).toBe("items");

    const missingTarget = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/tools`, {
      body: { items: [{ toolId: "0191f2f0-0000-7000-8000-000000000000" }] },
      headers: withRevision(3),
    });
    expect(missingTarget.status).toBe(400);
    expect(missingTarget.body.error.code).toBe("validation_error");

    const missingPrecondition = await call(
      ctx.app,
      "PUT",
      `/api/v1/experts/${created.id}/tools`,
      { body: { items: [] } },
    );
    expect(missingPrecondition.status).toBe(428);

    const stale = await call(ctx.app, "PUT", `/api/v1/experts/${created.id}/tools`, {
      body: { items: [] },
      headers: withRevision(1),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("revision_conflict");
    expect(stale.body.error.details.currentRevision).toBe(3);
  });
});
