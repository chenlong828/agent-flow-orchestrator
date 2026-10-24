import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

beforeEach(async () => {
  await resetBusinessData();
});

afterAll(async () => {
  await closeTestDb();
});

describe("B1 全链路旅程（仅通过 HTTP）", () => {
  test("注册资产 → 装配 → 引用保护 → 逐级清理", async () => {
    const health = await call(ctx.app, "GET", "/healthz");
    expect(health.status).toBe(200);

    const harnessCreated = await call(ctx.app, "POST", "/api/v1/harnesses", {
      body: {
        name: "journey-harness",
        kind: "container",
        address: "10.0.0.9:7801",
        accessMode: "container_registry",
        description: "旅程节点",
        concurrencyMax: 10,
        queuePolicy: "fifo",
        tags: ["旅程"],
      },
    });
    expect(harnessCreated.status).toBe(201);
    const harnessId = harnessCreated.body.id as string;

    const harnessList = await call(ctx.app, "GET", "/api/v1/harnesses?q=journey");
    expect(harnessList.body.total).toBe(1);
    expect(harnessList.body.items[0].toolCount).toBe(0);

    const toggledOff = await call(
      ctx.app,
      "PATCH",
      `/api/v1/harnesses/${harnessId}/enabled`,
      { body: { enabled: false }, headers: withRevision(1) },
    );
    expect(toggledOff.body.enabled).toBe(false);
    const toggledOn = await call(
      ctx.app,
      "PATCH",
      `/api/v1/harnesses/${harnessId}/enabled`,
      { body: { enabled: true }, headers: withRevision(2) },
    );
    expect(toggledOn.body.enabled).toBe(true);

    const harnessUpdated = await call(ctx.app, "PUT", `/api/v1/harnesses/${harnessId}`, {
      body: {
        name: "journey-harness",
        kind: "server",
        address: "10.0.0.9:7801",
        accessMode: "agent",
        description: "旅程节点（已改造）",
        concurrencyMax: 30,
        queuePolicy: "priority",
        tags: ["旅程", "已改造"],
      },
      headers: withRevision(3),
    });
    expect(harnessUpdated.status).toBe(200);
    expect(harnessUpdated.body).toMatchObject({ kind: "server", accessMode: "agent", revision: 4 });
    expect(harnessUpdated.body.tags).toEqual(["旅程", "已改造"]);

    const toolCreated = await call(ctx.app, "POST", "/api/v1/tools", {
      body: {
        name: "journey-tool",
        kind: "cli",
        invocation: "journey {input}",
        description: "旅程工具",
        harnessId,
        timeoutMs: 60000,
        params: [{ paramKey: "input", type: "string", description: "输入" }],
      },
    });
    expect(toolCreated.status).toBe(201);
    const toolId = toolCreated.body.id as string;
    expect(toolCreated.body.harnessName).toBe("journey-harness");

    const harnessDetail = await call(ctx.app, "GET", `/api/v1/harnesses/${harnessId}`);
    expect(harnessDetail.body.toolCount).toBe(1);

    const toolUpdated = await call(ctx.app, "PUT", `/api/v1/tools/${toolId}`, {
      body: {
        name: "journey-tool",
        kind: "mcp",
        invocation: "mcp://journey",
        description: "旅程工具（已改造）",
        harnessId,
        timeoutMs: 120000,
        params: [],
      },
      headers: withRevision(1),
    });
    expect(toolUpdated.status).toBe(200);
    expect(toolUpdated.body).toMatchObject({ kind: "mcp", paramCount: 0, revision: 2 });

    const toolList = await call(ctx.app, "GET", `/api/v1/tools?harnessId=${harnessId}`);
    expect(toolList.body.total).toBe(1);
    expect(toolList.body.items[0].usedByCount).toBe(0);

    const categories = await call(ctx.app, "GET", "/api/v1/skill-categories");
    expect(categories.body.items.map((item: any) => item.code)).toEqual([
      "coding",
      "retrieval",
      "review",
      "testing",
    ]);

    const skillCreated = await call(ctx.app, "POST", "/api/v1/skills", {
      body: {
        name: "journey-skill",
        categoryCode: "coding",
        summary: "旅程技能",
        tags: ["旅程"],
        triggers: ["旅程"],
        sections: {
          overview: "概览",
          steps: "步骤",
          examples: "示例",
          scripts: "脚本",
          verification: "验证",
        },
        pitfalls: ["跳过验证"],
        refs: [{ label: "旅程参考", refType: "经验" }],
      },
    });
    expect(skillCreated.status).toBe(201);
    const skillId = skillCreated.body.id as string;
    expect(skillCreated.body.version).toBe("v1.0");

    const skillDisabled = await call(ctx.app, "PATCH", `/api/v1/skills/${skillId}/enabled`, {
      body: { enabled: false },
      headers: withRevision(1),
    });
    expect(skillDisabled.body.enabled).toBe(false);
    const skillEnabled = await call(ctx.app, "PATCH", `/api/v1/skills/${skillId}/enabled`, {
      body: { enabled: true },
      headers: withRevision(2),
    });
    expect(skillEnabled.body.enabled).toBe(true);

    const skillUpdated = await call(ctx.app, "PUT", `/api/v1/skills/${skillId}`, {
      body: {
        name: "journey-skill",
        categoryCode: "coding",
        summary: "旅程技能（已改造）",
        tags: [],
        triggers: [],
        sections: {
          overview: "概览2",
          steps: "步骤2",
          examples: "示例2",
          scripts: "脚本2",
          verification: "验证2",
        },
        pitfalls: [],
        refs: [],
      },
      headers: withRevision(3),
    });
    expect(skillUpdated.status).toBe(200);
    expect(skillUpdated.body).toMatchObject({ version: "v1.1", revision: 4 });

    const skillList = await call(ctx.app, "GET", "/api/v1/skills?category=coding&tag=旅程");
    expect(skillList.body.total).toBe(0);
    const skillDetail = await call(ctx.app, "GET", `/api/v1/skills/${skillId}`);
    expect(skillDetail.body.sections.verification).toBe("验证2");

    const expertCreated = await call(ctx.app, "POST", "/api/v1/experts", {
      body: {
        name: "journey-expert",
        color: "#2563eb",
        role: "旅程专家",
        persona: ["谨慎"],
        duty: "旅程职责",
        skillOrder: "先技能",
        verifyOrder: "后验证",
        notes: "旅程备注",
        refs: [{ label: "旅程经验", refType: "经验" }],
      },
    });
    expect(expertCreated.status).toBe(201);
    const expertId = expertCreated.body.id as string;
    expect(expertCreated.body.refCount).toBe(0);

    const expertUpdated = await call(ctx.app, "PUT", `/api/v1/experts/${expertId}`, {
      body: {
        name: "journey-expert",
        color: "#16a34a",
        role: "旅程专家（已改造）",
        persona: [],
        duty: "旅程职责2",
        skillOrder: "先技能2",
        verifyOrder: "后验证2",
        notes: "旅程备注2",
        refs: [],
      },
      headers: withRevision(1),
    });
    expect(expertUpdated.body.color).toBe("#16a34a");

    const expertDisabled = await call(ctx.app, "PATCH", `/api/v1/experts/${expertId}/enabled`, {
      body: { enabled: false },
      headers: withRevision(2),
    });
    expect(expertDisabled.body.enabled).toBe(false);
    const expertEnabled = await call(ctx.app, "PATCH", `/api/v1/experts/${expertId}/enabled`, {
      body: { enabled: true },
      headers: withRevision(3),
    });
    expect(expertEnabled.body.enabled).toBe(true);

    const boundSkills = await call(ctx.app, "PUT", `/api/v1/experts/${expertId}/skills`, {
      body: { items: [{ skillId }] },
      headers: withRevision(4),
    });
    expect(boundSkills.status).toBe(200);
    expect(boundSkills.body.skills.map((skill: any) => skill.id)).toEqual([skillId]);

    const boundTools = await call(ctx.app, "PUT", `/api/v1/experts/${expertId}/tools`, {
      body: { items: [{ toolId }] },
      headers: withRevision(5),
    });
    expect(boundTools.status).toBe(200);
    expect(boundTools.body.tools.map((tool: any) => tool.id)).toEqual([toolId]);

    const expertDetail = await call(ctx.app, "GET", `/api/v1/experts/${expertId}`);
    expect(expertDetail.body).toMatchObject({ skillCount: 1, toolCount: 1 });
    expect(expertDetail.body.persona).toEqual([]);

    const harnessRefs = await call(ctx.app, "GET", `/api/v1/harnesses/${harnessId}/references`);
    expect(harnessRefs.body.items).toEqual([{ type: "tool", id: toolId, name: "journey-tool" }]);
    const skillRefs = await call(ctx.app, "GET", `/api/v1/skills/${skillId}/references`);
    expect(skillRefs.body.items).toEqual([
      { type: "expert", id: expertId, name: "journey-expert" },
    ]);
    const toolRefs = await call(ctx.app, "GET", `/api/v1/tools/${toolId}/references`);
    expect(toolRefs.body.items).toEqual([
      { type: "expert", id: expertId, name: "journey-expert" },
    ]);

    const expertList = await call(ctx.app, "GET", "/api/v1/experts?enabled=true");
    expect(expertList.body.items[0].refCount).toBe(0);

    for (const [path, revision] of [
      [`/api/v1/harnesses/${harnessId}`, 4],
      [`/api/v1/tools/${toolId}`, 2],
      [`/api/v1/skills/${skillId}`, 4],
    ] as const) {
      const blocked = await call(ctx.app, "DELETE", path, { headers: withRevision(revision) });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("referenced");
    }

    const clearedSkills = await call(ctx.app, "PUT", `/api/v1/experts/${expertId}/skills`, {
      body: { items: [] },
      headers: withRevision(6),
    });
    expect(clearedSkills.status).toBe(200);
    const clearedTools = await call(ctx.app, "PUT", `/api/v1/experts/${expertId}/tools`, {
      body: { items: [] },
      headers: withRevision(7),
    });
    expect(clearedTools.status).toBe(200);

    const expertDeleted = await call(ctx.app, "DELETE", `/api/v1/experts/${expertId}`, {
      headers: withRevision(8),
    });
    expect(expertDeleted.status).toBe(204);
    expect(
      (await call(ctx.app, "DELETE", `/api/v1/tools/${toolId}`, { headers: withRevision(2) })).status,
    ).toBe(204);
    expect(
      (await call(ctx.app, "DELETE", `/api/v1/skills/${skillId}`, { headers: withRevision(4) })).status,
    ).toBe(204);
    expect(
      (
        await call(ctx.app, "DELETE", `/api/v1/harnesses/${harnessId}`, {
          headers: withRevision(4),
        })
      ).status,
    ).toBe(204);

    for (const [path, expected] of [
      ["/api/v1/harnesses", 0],
      ["/api/v1/tools", 0],
      ["/api/v1/skills", 0],
      ["/api/v1/experts", 0],
    ] as const) {
      const list = await call(ctx.app, "GET", path);
      expect(list.body).toMatchObject({ total: expected, items: [] });
    }
  });
});
