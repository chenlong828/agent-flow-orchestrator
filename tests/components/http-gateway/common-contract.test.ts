import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";

const MISSING_ID = "0191f2f0-0000-7000-8000-000000000000";

let ctx: TestContext;
let harnessId: string;

function harnessBody(name = "contract-harness") {
  return {
    name,
    kind: "container" as const,
    address: "10.0.4.11:7801",
    accessMode: "container_registry" as const,
    concurrencyMax: 10,
    queuePolicy: "fifo" as const,
  };
}

function toolBody(name = "contract-tool") {
  return {
    name,
    kind: "cli" as const,
    invocation: "run {input}",
    harnessId,
    timeoutMs: 30000,
  };
}

function skillBody(name = "contract-skill") {
  return {
    name,
    categoryCode: "coding",
    summary: "契约测试技能",
    sections: {
      overview: "概览",
      steps: "步骤",
      examples: "示例",
      scripts: "脚本",
      verification: "验证",
    },
  };
}

function expertBody(name = "contract-expert") {
  return {
    name,
    color: "#2563eb",
    role: "契约测试专家",
  };
}

async function post(path: string, body: unknown) {
  const response = await call(ctx.app, "POST", path, { body });
  expect(response.status).toBe(201);
  return response.body as Record<string, any>;
}

async function expectNotFound(response: Awaited<ReturnType<typeof call>>) {
  expect(response.status).toBe(404);
  expect(response.body.error.code).toBe("not_found");
}

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await resetBusinessData();
  harnessId = (await post("/api/v1/harnesses", harnessBody())).id;
});

afterAll(async () => {
  await closeTestDb();
});

describe("B1 公共契约", () => {
  test("创建端点名称大小写不敏感唯一，冲突返回 409 name_conflict", async () => {
    const cases = [
      { path: "/api/v1/harnesses", body: harnessBody("重复资产"), list: "/api/v1/harnesses" },
      { path: "/api/v1/tools", body: toolBody("重复资产"), list: "/api/v1/tools" },
      { path: "/api/v1/skills", body: skillBody("重复资产"), list: "/api/v1/skills" },
      { path: "/api/v1/experts", body: expertBody("重复资产"), list: "/api/v1/experts" },
    ];

    for (const item of cases) {
      const first = await post(item.path, item.body);
      expect(first.name).toBe("重复资产");
      const duplicate = await call(ctx.app, "POST", item.path, {
        body: { ...item.body, name: "重复资产".toUpperCase() },
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe("name_conflict");
      expect(duplicate.body.error.details).toMatchObject({ field: "name" });

      const list = await call(ctx.app, "GET", `${item.list}?q=重复资产`);
      expect(list.body.total).toBe(1);
    }
  });

  test("更新端点改名冲突返回 409，原资源名称与 revision 不变", async () => {
    const harnessA = await post("/api/v1/harnesses", harnessBody("harness-a"));
    await post("/api/v1/harnesses", harnessBody("harness-b"));
    const harnessConflict = await call(ctx.app, "PUT", `/api/v1/harnesses/${harnessA.id}`, {
      body: harnessBody("harness-b"),
      headers: withRevision(1),
    });
    expect(harnessConflict.status).toBe(409);
    expect(harnessConflict.body.error.code).toBe("name_conflict");
    const harnessAfter = await call(ctx.app, "GET", `/api/v1/harnesses/${harnessA.id}`);
    expect(harnessAfter.body).toMatchObject({ name: "harness-a", revision: 1 });

    const toolA = await post("/api/v1/tools", toolBody("tool-a"));
    await post("/api/v1/tools", toolBody("tool-b"));
    const toolConflict = await call(ctx.app, "PUT", `/api/v1/tools/${toolA.id}`, {
      body: toolBody("tool-b"),
      headers: withRevision(1),
    });
    expect(toolConflict.status).toBe(409);
    expect(toolConflict.body.error.code).toBe("name_conflict");
    const toolAfter = await call(ctx.app, "GET", `/api/v1/tools/${toolA.id}`);
    expect(toolAfter.body).toMatchObject({ name: "tool-a", revision: 1 });

    const skillA = await post("/api/v1/skills", skillBody("skill-a"));
    await post("/api/v1/skills", skillBody("skill-b"));
    const skillConflict = await call(ctx.app, "PUT", `/api/v1/skills/${skillA.id}`, {
      body: skillBody("skill-b"),
      headers: withRevision(1),
    });
    expect(skillConflict.status).toBe(409);
    expect(skillConflict.body.error.code).toBe("name_conflict");
    const skillAfter = await call(ctx.app, "GET", `/api/v1/skills/${skillA.id}`);
    expect(skillAfter.body).toMatchObject({ name: "skill-a", revision: 1, version: "v1.0" });

    const expertA = await post("/api/v1/experts", expertBody("expert-a"));
    await post("/api/v1/experts", expertBody("expert-b"));
    const expertConflict = await call(ctx.app, "PUT", `/api/v1/experts/${expertA.id}`, {
      body: expertBody("expert-b"),
      headers: withRevision(1),
    });
    expect(expertConflict.status).toBe(409);
    expect(expertConflict.body.error.code).toBe("name_conflict");
    const expertAfter = await call(ctx.app, "GET", `/api/v1/experts/${expertA.id}`);
    expect(expertAfter.body).toMatchObject({ name: "expert-a", revision: 1 });
  });

  test("更新、启停、删除与装配缺少 If-Match 一律返回 428", async () => {
    const harness = await post("/api/v1/harnesses", harnessBody("harness-428"));
    const tool = await post("/api/v1/tools", toolBody("tool-428"));
    const skill = await post("/api/v1/skills", skillBody("skill-428"));
    const expert = await post("/api/v1/experts", expertBody("expert-428"));

    const cases = [
      { method: "PUT", path: `/api/v1/harnesses/${harness.id}`, body: harnessBody("harness-428") },
      { method: "PATCH", path: `/api/v1/harnesses/${harness.id}/enabled`, body: { enabled: false } },
      { method: "DELETE", path: `/api/v1/harnesses/${harness.id}` },
      { method: "PUT", path: `/api/v1/tools/${tool.id}`, body: toolBody("tool-428") },
      { method: "DELETE", path: `/api/v1/tools/${tool.id}` },
      { method: "PUT", path: `/api/v1/skills/${skill.id}`, body: skillBody("skill-428") },
      { method: "PATCH", path: `/api/v1/skills/${skill.id}/enabled`, body: { enabled: false } },
      { method: "DELETE", path: `/api/v1/skills/${skill.id}` },
      { method: "PUT", path: `/api/v1/experts/${expert.id}`, body: expertBody("expert-428") },
      { method: "PATCH", path: `/api/v1/experts/${expert.id}/enabled`, body: { enabled: false } },
      { method: "DELETE", path: `/api/v1/experts/${expert.id}` },
      { method: "PUT", path: `/api/v1/experts/${expert.id}/skills`, body: { items: [] } },
      { method: "PUT", path: `/api/v1/experts/${expert.id}/tools`, body: { items: [] } },
    ];

    for (const item of cases) {
      const response = await call(ctx.app, item.method, item.path, { body: item.body });
      expect(response.status).toBe(428);
      expect(response.body.error.code).toBe("precondition_required");
    }
  });

  test("资源或引用目标不存在时，路径端点返回 404 not_found", async () => {
    const writes = [
      { method: "GET", path: `/api/v1/harnesses/${MISSING_ID}` },
      { method: "PUT", path: `/api/v1/harnesses/${MISSING_ID}`, body: harnessBody("x") },
      { method: "PATCH", path: `/api/v1/harnesses/${MISSING_ID}/enabled`, body: { enabled: true } },
      { method: "DELETE", path: `/api/v1/harnesses/${MISSING_ID}` },
      { method: "GET", path: `/api/v1/harnesses/${MISSING_ID}/references` },
      { method: "GET", path: `/api/v1/tools/${MISSING_ID}` },
      { method: "PUT", path: `/api/v1/tools/${MISSING_ID}`, body: toolBody("x") },
      { method: "DELETE", path: `/api/v1/tools/${MISSING_ID}` },
      { method: "GET", path: `/api/v1/tools/${MISSING_ID}/references` },
      { method: "GET", path: `/api/v1/skills/${MISSING_ID}` },
      { method: "PUT", path: `/api/v1/skills/${MISSING_ID}`, body: skillBody("x") },
      { method: "PATCH", path: `/api/v1/skills/${MISSING_ID}/enabled`, body: { enabled: true } },
      { method: "DELETE", path: `/api/v1/skills/${MISSING_ID}` },
      { method: "GET", path: `/api/v1/skills/${MISSING_ID}/references` },
      { method: "GET", path: `/api/v1/experts/${MISSING_ID}` },
      { method: "PUT", path: `/api/v1/experts/${MISSING_ID}`, body: expertBody("x") },
      { method: "PATCH", path: `/api/v1/experts/${MISSING_ID}/enabled`, body: { enabled: true } },
      { method: "DELETE", path: `/api/v1/experts/${MISSING_ID}` },
      { method: "PUT", path: `/api/v1/experts/${MISSING_ID}/skills`, body: { items: [] } },
      { method: "PUT", path: `/api/v1/experts/${MISSING_ID}/tools`, body: { items: [] } },
    ];

    for (const item of writes) {
      const response = await call(ctx.app, item.method, item.path, {
        body: item.body,
        headers: withRevision(1),
      });
      await expectNotFound(response);
    }
  });

  test("列表端点拒绝非法筛选、布尔值与分页参数", async () => {
    const cases = [
      { path: "/api/v1/harnesses?kind=vm", field: "kind" },
      { path: "/api/v1/harnesses?enabled=yes", field: "enabled" },
      { path: "/api/v1/harnesses?health=healthy", field: "health" },
      { path: "/api/v1/harnesses?limit=abc", field: "limit" },
      { path: "/api/v1/harnesses?limit=201", field: "limit" },
      { path: "/api/v1/tools?kind=docker", field: "kind" },
      { path: "/api/v1/tools?status=ready", field: "status" },
      { path: "/api/v1/tools?harnessId=not-a-uuid", field: "harnessId" },
      { path: "/api/v1/skills?enabled=1", field: "enabled" },
      { path: "/api/v1/skills?sort=version:up", field: "sort" },
      { path: "/api/v1/skills?offset=-1", field: "offset" },
      { path: "/api/v1/experts?enabled=falsey", field: "enabled" },
      { path: "/api/v1/experts?sort=createdAt:asc", field: "sort" },
    ];

    for (const item of cases) {
      const response = await call(ctx.app, "GET", item.path);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("validation_error");
      expect(response.body.error.details.field).toBe(item.field);
    }
  });

  test("未知查询参数被忽略，未知请求体字段在 POST 与 PUT 均被拒绝", async () => {
    for (const path of [
      "/api/v1/harnesses",
      "/api/v1/tools",
      "/api/v1/skills",
      "/api/v1/experts",
    ]) {
      const response = await call(ctx.app, "GET", `${path}?unknown=1`);
      expect(response.status).toBe(200);
      expect(response.body.total).toBeTypeOf("number");
    }

    const harness = await post("/api/v1/harnesses", harnessBody("harness-unknown"));
    const tool = await post("/api/v1/tools", toolBody("tool-unknown"));
    const skill = await post("/api/v1/skills", skillBody("skill-unknown"));
    const expert = await post("/api/v1/experts", expertBody("expert-unknown"));

    const createCases = [
      { path: "/api/v1/harnesses", body: { ...harnessBody("c1"), toolCount: 0 } },
      { path: "/api/v1/tools", body: { ...toolBody("c2"), usedByCount: 0 } },
      { path: "/api/v1/skills", body: { ...skillBody("c3"), version: "v9.9" } },
      { path: "/api/v1/experts", body: { ...expertBody("c4"), skillCount: 0 } },
    ];
    for (const item of createCases) {
      const response = await call(ctx.app, "POST", item.path, { body: item.body });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("validation_error");
    }

    const updateCases = [
      { path: `/api/v1/harnesses/${harness.id}`, body: { ...harnessBody("u1"), toolCount: 0 } },
      { path: `/api/v1/tools/${tool.id}`, body: { ...toolBody("u2"), paramCount: 0 } },
      { path: `/api/v1/skills/${skill.id}`, body: { ...skillBody("u3"), version: "v9.9" } },
      { path: `/api/v1/experts/${expert.id}`, body: { ...expertBody("u4"), skillCount: 0 } },
    ];
    for (const item of updateCases) {
      const response = await call(ctx.app, "PUT", item.path, {
        body: item.body,
        headers: withRevision(1),
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("validation_error");
    }
  });

  test("空请求体、非法 JSON 与非对象请求体返回 400 validation_error", async () => {
    const cases = [
      { rawBody: "" },
      { rawBody: "{not-json" },
      { rawBody: "[]" },
      { rawBody: "null" },
    ];
    for (const item of cases) {
      const response = await call(ctx.app, "POST", "/api/v1/harnesses", item);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("validation_error");
      expect(response.body.error.details.field).toBe("body");
    }
  });

  test("启停请求体必须是布尔 enabled，未知字段被拒绝", async () => {
    const harness = await post("/api/v1/harnesses", harnessBody("harness-enabled"));
    const cases = [
      { body: {}, field: "enabled" },
      { body: { enabled: "false" }, field: "enabled" },
      { body: { enabled: true, extra: 1 }, field: "body" },
    ];
    for (const item of cases) {
      const response = await call(
        ctx.app,
        "PATCH",
        `/api/v1/harnesses/${harness.id}/enabled`,
        { body: item.body, headers: withRevision(1) },
      );
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("validation_error");
      expect(response.body.error.details.field).toBe(item.field);
    }
  });

  test("路径 ID 必须是 UUID，非法形状返回 400 并指向 id 字段", async () => {
    const cases = [
      { method: "GET", path: "/api/v1/harnesses/not-a-uuid" },
      { method: "PUT", path: "/api/v1/tools/not-a-uuid", body: toolBody("x") },
      { method: "PATCH", path: "/api/v1/skills/not-a-uuid/enabled", body: { enabled: true } },
      { method: "DELETE", path: "/api/v1/experts/not-a-uuid" },
      { method: "GET", path: "/api/v1/harnesses/not-a-uuid/references" },
    ];
    for (const item of cases) {
      const response = await call(ctx.app, item.method, item.path, {
        body: item.body,
        headers: withRevision(1),
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("validation_error");
      expect(response.body.error.details.field).toBe("id");
    }
  });

  test("嵌套对象与数组元素的未知字段同样返回 400", async () => {
    const cases = [
      {
        path: "/api/v1/tools",
        body: {
          ...toolBody("nested-tool"),
          params: [{ key: "p", type: "string", extra: 1 }],
        },
        field: "params[0]",
      },
      {
        path: "/api/v1/skills",
        body: {
          ...skillBody("nested-skill"),
          sections: {
            overview: "o",
            steps: "s",
            examples: "e",
            scripts: "sc",
            verification: "v",
            extra: "x",
          },
        },
        field: "sections",
      },
      {
        path: "/api/v1/skills",
        body: {
          ...skillBody("nested-ref"),
          refs: [{ label: "参考", refType: "经验", extra: 1 }],
        },
        field: "refs[0]",
      },
      {
        path: "/api/v1/experts",
        body: {
          ...expertBody("nested-expert"),
          refs: [{ label: "参考", refType: "经验", extra: 1 }],
        },
        field: "refs[0]",
      },
    ];

    for (const item of cases) {
      const response = await call(ctx.app, "POST", item.path, { body: item.body });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("validation_error");
      expect(response.body.error.details.field).toBe(item.field);
    }

    const expert = await post("/api/v1/experts", expertBody("assembly-extra"));
    const assembly = await call(ctx.app, "PUT", `/api/v1/experts/${expert.id}/tools`, {
      body: { items: [{ toolId: MISSING_ID, name: "x" }] },
      headers: withRevision(1),
    });
    expect(assembly.status).toBe(400);
    expect(assembly.body.error.details.field).toBe("items[0]");
  });

  test("列表条目支持 updatedAt 倒序默认与显式正序", async () => {
    const older = "2026-01-01T00:00:00.000Z";
    const newer = "2026-01-02T00:00:00.000Z";

    const harnessA = await post("/api/v1/harnesses", harnessBody("sort-harness-a"));
    const harnessB = await post("/api/v1/harnesses", harnessBody("sort-harness-b"));
    await ctx.db.query("update harness set updated_at = $1 where id = $2", [older, harnessA.id]);
    await ctx.db.query("update harness set updated_at = $1 where id = $2", [newer, harnessB.id]);
    const harnessDefault = await call(ctx.app, "GET", "/api/v1/harnesses?q=sort-harness-");
    expect(harnessDefault.body.items.map((item: any) => item.name)).toEqual([
      "sort-harness-b",
      "sort-harness-a",
    ]);
    const harnessAsc = await call(
      ctx.app,
      "GET",
      "/api/v1/harnesses?q=sort-harness-&sort=updatedAt:asc",
    );
    expect(harnessAsc.body.items.map((item: any) => item.name)).toEqual([
      "sort-harness-a",
      "sort-harness-b",
    ]);

    const toolA = await post("/api/v1/tools", toolBody("sort-tool-a"));
    const toolB = await post("/api/v1/tools", toolBody("sort-tool-b"));
    await ctx.db.query("update tool set updated_at = $1 where id = $2", [older, toolA.id]);
    await ctx.db.query("update tool set updated_at = $1 where id = $2", [newer, toolB.id]);
    const toolDefault = await call(ctx.app, "GET", "/api/v1/tools?q=sort-tool-");
    expect(toolDefault.body.items.map((item: any) => item.name)).toEqual([
      "sort-tool-b",
      "sort-tool-a",
    ]);
    const toolAsc = await call(
      ctx.app,
      "GET",
      "/api/v1/tools?q=sort-tool-&sort=updatedAt:asc",
    );
    expect(toolAsc.body.items.map((item: any) => item.name)).toEqual([
      "sort-tool-a",
      "sort-tool-b",
    ]);

    const skillA = await post("/api/v1/skills", skillBody("sort-skill-a"));
    const skillB = await post("/api/v1/skills", skillBody("sort-skill-b"));
    await ctx.db.query("update skill set updated_at = $1 where id = $2", [older, skillA.id]);
    await ctx.db.query("update skill set updated_at = $1 where id = $2", [newer, skillB.id]);
    const skillDefault = await call(ctx.app, "GET", "/api/v1/skills?q=sort-skill-");
    expect(skillDefault.body.items.map((item: any) => item.name)).toEqual([
      "sort-skill-b",
      "sort-skill-a",
    ]);
    const skillAsc = await call(
      ctx.app,
      "GET",
      "/api/v1/skills?q=sort-skill-&sort=updatedAt:asc",
    );
    expect(skillAsc.body.items.map((item: any) => item.name)).toEqual([
      "sort-skill-a",
      "sort-skill-b",
    ]);

    const expertA = await post("/api/v1/experts", expertBody("sort-expert-a"));
    const expertB = await post("/api/v1/experts", expertBody("sort-expert-b"));
    await ctx.db.query("update expert set updated_at = $1 where id = $2", [older, expertA.id]);
    await ctx.db.query("update expert set updated_at = $1 where id = $2", [newer, expertB.id]);
    const expertDefault = await call(ctx.app, "GET", "/api/v1/experts?q=sort-expert-");
    expect(expertDefault.body.items.map((item: any) => item.name)).toEqual([
      "sort-expert-b",
      "sort-expert-a",
    ]);
    const expertAsc = await call(
      ctx.app,
      "GET",
      "/api/v1/experts?q=sort-expert-&sort=updatedAt:asc",
    );
    expect(expertAsc.body.items.map((item: any) => item.name)).toEqual([
      "sort-expert-a",
      "sort-expert-b",
    ]);
  });

  test("创建响应 ID 为 UUIDv7，时间字段为 ISO-8601 UTC", async () => {
    const resources = [
      await post("/api/v1/harnesses", harnessBody("uuid-harness")),
      await post("/api/v1/tools", toolBody("uuid-tool")),
      await post("/api/v1/skills", skillBody("uuid-skill")),
      await post("/api/v1/experts", expertBody("uuid-expert")),
    ];
    const uuidV7 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const resource of resources) {
      expect(resource.id).toMatch(uuidV7);
      expect(resource.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(resource.updatedAt).toBe(resource.createdAt);
    }
  });

  test("契约快照：列表与详情字段集合和 DTO 表一致", async () => {
    const keys = (value: Record<string, unknown>) => Object.keys(value).sort();

    const harness = await post("/api/v1/harnesses", harnessBody("snapshot-harness"));
    const harnessList = await call(ctx.app, "GET", "/api/v1/harnesses?q=snapshot-harness");
    expect(keys(harnessList.body.items[0])).toEqual([
      "accessMode",
      "address",
      "concurrencyMax",
      "enabled",
      "health",
      "id",
      "kind",
      "lastHeartbeatAt",
      "name",
      "queuePolicy",
      "revision",
      "tags",
      "toolCount",
      "updatedAt",
    ]);
    const harnessDetail = await call(ctx.app, "GET", `/api/v1/harnesses/${harness.id}`);
    expect(keys(harnessDetail.body)).toEqual([
      "accessMode",
      "address",
      "concurrencyMax",
      "createdAt",
      "description",
      "enabled",
      "health",
      "id",
      "kind",
      "lastHeartbeatAt",
      "name",
      "queuePolicy",
      "revision",
      "tags",
      "toolCount",
      "updatedAt",
    ]);

    const tool = await post("/api/v1/tools", toolBody("snapshot-tool"));
    const toolList = await call(ctx.app, "GET", "/api/v1/tools?q=snapshot-tool");
    expect(keys(toolList.body.items[0])).toEqual([
      "harnessId",
      "harnessName",
      "id",
      "invocation",
      "kind",
      "lastDebugAt",
      "name",
      "paramCount",
      "revision",
      "status",
      "timeoutMs",
      "updatedAt",
      "usedByCount",
    ]);
    const toolDetail = await call(ctx.app, "GET", `/api/v1/tools/${tool.id}`);
    expect(keys(toolDetail.body)).toEqual([
      "createdAt",
      "description",
      "harnessId",
      "harnessName",
      "id",
      "invocation",
      "kind",
      "lastDebugAt",
      "name",
      "paramCount",
      "params",
      "revision",
      "status",
      "timeoutMs",
      "updatedAt",
      "usedByCount",
    ]);

    const skill = await post("/api/v1/skills", skillBody("snapshot-skill"));
    const skillList = await call(ctx.app, "GET", "/api/v1/skills?q=snapshot-skill");
    expect(keys(skillList.body.items[0])).toEqual([
      "categoryCode",
      "categoryLabel",
      "enabled",
      "id",
      "name",
      "revision",
      "summary",
      "tags",
      "updatedAt",
      "usedByCount",
      "version",
    ]);
    const skillDetail = await call(ctx.app, "GET", `/api/v1/skills/${skill.id}`);
    expect(keys(skillDetail.body)).toEqual([
      "categoryCode",
      "categoryLabel",
      "createdAt",
      "enabled",
      "id",
      "name",
      "pitfalls",
      "refs",
      "revision",
      "sections",
      "summary",
      "tags",
      "triggers",
      "updatedAt",
      "usedByCount",
      "version",
    ]);

    const expert = await post("/api/v1/experts", expertBody("snapshot-expert"));
    const expertList = await call(ctx.app, "GET", "/api/v1/experts?q=snapshot-expert");
    expect(keys(expertList.body.items[0])).toEqual([
      "color",
      "enabled",
      "id",
      "name",
      "persona",
      "refCount",
      "revision",
      "role",
      "skillCount",
      "toolCount",
      "updatedAt",
    ]);
    const expertDetail = await call(ctx.app, "GET", `/api/v1/experts/${expert.id}`);
    expect(keys(expertDetail.body)).toEqual([
      "color",
      "createdAt",
      "duty",
      "enabled",
      "id",
      "name",
      "notes",
      "persona",
      "refCount",
      "refs",
      "revision",
      "role",
      "skillCount",
      "skillOrder",
      "skills",
      "toolCount",
      "tools",
      "updatedAt",
      "verifyOrder",
    ]);
  });

  test("成功响应为 UTF-8 JSON，错误响应同样保持该 Content-Type", async () => {
    const ok = await call(ctx.app, "GET", "/api/v1/harnesses");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/json; charset=utf-8");

    const bad = await call(ctx.app, "GET", "/api/v1/harnesses?limit=0");
    expect(bad.status).toBe(400);
    expect(bad.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});
