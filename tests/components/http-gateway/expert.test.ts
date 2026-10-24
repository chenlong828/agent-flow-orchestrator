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
});
