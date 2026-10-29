import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

async function createDraft(skillId?: string) {
  const response = await call(ctx.app, "POST", "/api/v1/skill-drafts", {
    body: skillId === undefined ? {} : { skillId },
  });
  expect(response.status).toBe(201);
  return response.body as Record<string, any>;
}

async function saveDraft(
  draftId: string,
  body: Record<string, unknown> = {},
  revision?: number,
) {
  return call(ctx.app, "POST", `/api/v1/skill-drafts/${draftId}/save`, {
    body: {
      name: "CRES 技能",
      categoryCode: "coding",
      description: "基于 Call Trace 定位符号引用链",
      tags: ["规范"],
      body: "## 适用场景\n\n内容\n",
      ...body,
    },
    headers: revision === undefined ? undefined : withRevision(revision),
  });
}

async function createSkill(name = "CRES 技能", categoryCode = "coding") {
  const draft = await createDraft();
  const response = await saveDraft(draft.id, { name, categoryCode });
  expect(response.status).toBe(201);
  return response.body as { id: string; revision: number; version: string };
}

async function upload(draftId: string, path: string, content: string) {
  const form = new FormData();
  form.set("path", path);
  form.set("file", new File([content], "file.txt", { type: "text/plain" }));
  return ctx.app(
    new Request(`http://127.0.0.1:3000/api/v1/skill-drafts/${draftId}/files`, {
      method: "POST",
      body: form,
    }),
  );
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

  test("草稿保存创建 Skill：201、Location、v1.0，列表与详情投影", async () => {
    const draft = await createDraft();
    const response = await saveDraft(draft.id);
    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(`/api/v1/skills/${response.body.id}`);
    expect(response.body).toMatchObject({ revision: 1, version: "v1.0" });
    expect(response.body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.hasOwn(response.body, "created")).toBe(false);

    const detail = await call(ctx.app, "GET", `/api/v1/skills/${response.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      name: "CRES 技能",
      categoryCode: "coding",
      categoryLabel: "编码",
      description: "基于 Call Trace 定位符号引用链",
      version: "v1.0",
      enabled: true,
      tags: ["规范"],
      usedByCount: 0,
      revision: 1,
    });
    expect(detail.body.body).toBe("## 适用场景\n\n内容\n");
    expect(detail.body.files).toEqual([
      { path: "SKILL.md", size: expect.any(Number), readOnly: true },
    ]);

    const list = await call(ctx.app, "GET", "/api/v1/skills?category=coding&tag=规范");
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].name).toBe("CRES 技能");
  });

  test("草稿文件上传、改名、删除与文件清单", async () => {
    const draft = await createDraft();
    const uploaded = await upload(draft.id, "scripts/run.sh", "echo hi");
    expect(uploaded.status).toBe(200);
    const body = await uploaded.json();
    expect(body.file.path).toBe("scripts/run.sh");
    expect(body.files.map((file: any) => file.path)).toEqual(["scripts/run.sh"]);

    const renamed = await call(ctx.app, "PATCH", `/api/v1/skill-drafts/${draft.id}/files`, {
      body: { path: "scripts/run.sh", newPath: "references/run.sh" },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.files.map((file: any) => file.path)).toEqual([
      "references/run.sh",
    ]);

    const deleted = await call(
      ctx.app,
      "DELETE",
      `/api/v1/skill-drafts/${draft.id}/files?path=references/run.sh`,
    );
    expect(deleted.status).toBe(204);
    const detail = await call(ctx.app, "GET", `/api/v1/skill-drafts/${draft.id}`);
    expect(detail.body.files.map((file: any) => file.path)).toEqual([]);
  });

  test("更新草稿保存：缺 If-Match 428、旧 revision 409、成功 v1.1", async () => {
    const created = await createSkill();
    const draft = await createDraft(created.id);
    const missing = await saveDraft(draft.id, { name: "CRES 技能 v2" });
    expect(missing.status).toBe(428);

    const extra = await saveDraft((await createDraft()).id, { name: "新建带 If-Match" }, 1);
    expect(extra.status).toBe(400);

    const stale = await saveDraft(draft.id, { name: "CRES 技能 v2" }, 9);
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentRevision).toBe(1);

    const updated = await saveDraft(draft.id, { name: "CRES 技能 v2" }, 1);
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ revision: 2, version: "v1.1" });
    expect(updated.body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.hasOwn(updated.body, "created")).toBe(false);
    const detail = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(detail.body.name).toBe("CRES 技能 v2");
  });

  test("文档与下载：内容协商、ETag 与 304", async () => {
    const created = await createSkill();
    const document = await callText(`/api/v1/skills/${created.id}/document`);
    expect(document.status).toBe(200);
    expect(document.headers.get("content-type")).toContain("text/markdown");
    expect(document.text).toContain("## 适用场景");
    const etag = document.headers.get("etag")!;
    expect((await callText(`/api/v1/skills/${created.id}/document`, { "if-none-match": etag })).status).toBe(304);

    const download = await ctx.app(
      new Request(`http://127.0.0.1:3000/api/v1/skills/${created.id}/download`),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const notModified = await ctx.app(
      new Request(`http://127.0.0.1:3000/api/v1/skills/${created.id}/download`, {
        headers: { "if-none-match": `"${created.revision}"` },
      }),
    );
    expect(notModified.status).toBe(304);
  });

  test("启停、删除与不存在路径", async () => {
    const created = await createSkill();
    const disabled = await call(ctx.app, "PATCH", `/api/v1/skills/${created.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(1),
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);
    expect(disabled.body.revision).toBe(2);

    const deleted = await call(ctx.app, "DELETE", `/api/v1/skills/${created.id}`, {
      headers: withRevision(2),
    });
    expect(deleted.status).toBe(204);
    expect((await call(ctx.app, "GET", `/api/v1/skills/${created.id}`)).status).toBe(404);
    expect((await call(ctx.app, "POST", "/api/v1/skills", { body: {} })).status).toBe(404);
  });

  test("保存校验未知字段、非 multipart 415 与 SKILL.md 附件 400", async () => {
    const draft = await createDraft();
    const unknown = await saveDraft(draft.id, { enabled: true });
    expect(unknown.status).toBe(400);

    const plain = await ctx.app(
      new Request(`http://127.0.0.1:3000/api/v1/skill-drafts/${draft.id}/files`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(plain.status).toBe(415);

    const skillMd = await upload(draft.id, "SKILL.md", "x");
    expect(skillMd.status).toBe(400);
  });

  test("草稿创建：空 body 201、未知字段与非 UUID 400", async () => {
    const empty = await call(ctx.app, "POST", "/api/v1/skill-drafts");
    expect(empty.status).toBe(201);

    const unknown = await call(ctx.app, "POST", "/api/v1/skill-drafts", {
      body: { skillId: null, extra: 1 },
    });
    expect(unknown.status).toBe(400);

    const badId = await call(ctx.app, "POST", "/api/v1/skill-drafts", {
      body: { skillId: "not-a-uuid" },
    });
    expect(badId.status).toBe(400);
  });
});
