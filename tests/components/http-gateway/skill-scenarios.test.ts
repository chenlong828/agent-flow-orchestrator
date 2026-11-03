import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { call, createTestContext, withRevision, type TestContext } from "../../helpers/app.ts";
import {
  parseSkillMarkdown,
  readSkillPackage,
} from "../../../src/components/skill/package.ts";

let ctx: TestContext;

type DraftBody = {
  id: string;
  skillId: string | null;
  baseRevision: number | null;
  baseVersion: string | null;
  expiresAt: string;
  createdAt: string;
  files: { path: string; size: number; readOnly: boolean }[];
};

function basePath(): string {
  return "http://127.0.0.1:3000";
}

async function createDraft(skillId?: string): Promise<DraftBody> {
  const response = await call(ctx.app, "POST", "/api/v1/skill-drafts", {
    body: skillId === undefined ? {} : { skillId },
  });
  expect(response.status).toBe(201);
  return response.body as DraftBody;
}

async function upload(draftId: string, path: string, content: string): Promise<Response> {
  const form = new FormData();
  form.set("path", path);
  form.set("file", new File([content], "file.txt", { type: "text/plain" }));
  return ctx.app(
    new Request(`${basePath()}/api/v1/skill-drafts/${draftId}/files`, {
      method: "POST",
      body: form,
    }),
  );
}

function saveBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "CRES 技能",
    categoryCode: "coding",
    description: "基于 Call Trace 定位符号引用链",
    tags: ["规范"],
    body: "## 适用场景\n\n内容\n",
    ...overrides,
  };
}

async function saveDraft(
  draftId: string,
  overrides: Record<string, unknown> = {},
  revision?: number,
) {
  return call(ctx.app, "POST", `/api/v1/skill-drafts/${draftId}/save`, {
    body: saveBody(overrides),
    headers: revision === undefined ? undefined : withRevision(revision),
  });
}

async function createSkill(
  name = "CRES 技能",
  categoryCode = "coding",
  tags: string[] = ["规范"],
): Promise<{ id: string; revision: number; version: string }> {
  const draft = await createDraft();
  const response = await saveDraft(draft.id, { name, categoryCode, tags });
  expect(response.status).toBe(201);
  return response.body as { id: string; revision: number; version: string };
}

async function downloadSkill(id: string, headers: Record<string, string> = {}) {
  return ctx.app(
    new Request(`${basePath()}/api/v1/skills/${id}/download`, { headers }),
  );
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

describe("SCN-0002 Skill 草稿与发布", () => {
  test("TC-SKL-001 新建草稿上传附件后保存生成 v1.0 包，草稿被消费", async () => {
    const draft = await createDraft();
    expect(draft).toMatchObject({
      skillId: null,
      baseRevision: null,
      baseVersion: null,
      files: [],
    });
    expect(new Date(draft.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const uploaded = await upload(draft.id, "scripts/run.sh", "echo hi");
    expect(uploaded.status).toBe(200);
    const uploadedBody = (await uploaded.json()) as {
      files: { path: string; size: number; readOnly: boolean }[];
    };
    expect(uploadedBody.files.map((file) => file.path)).toEqual(["scripts/run.sh"]);
    expect(uploadedBody.files[0]).toMatchObject({
      path: "scripts/run.sh",
      size: 7,
      readOnly: false,
    });
    expect((await upload(draft.id, "references/usage.md", "# 用法\n")).status).toBe(200);

    const saved = await saveDraft(draft.id, {
      name: "场景发布技能",
      tags: ["发布", "发布"],
      body: "## 适用场景\n\n场景正文\n",
    });
    expect(saved.status).toBe(201);
    expect(saved.headers.get("location")).toBe(`/api/v1/skills/${saved.body.id}`);
    expect(saved.body).toMatchObject({ revision: 1, version: "v1.0" });
    expect(Object.hasOwn(saved.body, "created")).toBe(false);
    expect((await call(ctx.app, "GET", `/api/v1/skill-drafts/${draft.id}`)).status).toBe(404);

    const detail = await call(ctx.app, "GET", `/api/v1/skills/${saved.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      name: "场景发布技能",
      categoryCode: "coding",
      categoryLabel: "编码",
      version: "v1.0",
      enabled: true,
      revision: 1,
      usedByCount: 0,
    });
    expect(detail.body.tags).toEqual(["发布"]);
    expect(detail.body.body).toBe("## 适用场景\n\n场景正文\n");
    expect(detail.body.files.map((file: { path: string }) => file.path)).toEqual([
      "SKILL.md",
      "references/usage.md",
      "scripts/run.sh",
    ]);
    expect(detail.body.files.every((file: { readOnly: boolean }) => file.readOnly)).toBe(true);

    const list = await call(
      ctx.app,
      "GET",
      "/api/v1/skills?q=场景发布&category=coding&tag=发布",
    );
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].name).toBe("场景发布技能");
  });

  test("TC-SKL-002 已有 Skill 草稿复制整包，保存递增 minor 并更新文档与下载", async () => {
    const created = await createSkill("场景迭代技能");
    const draft = await createDraft(created.id);
    expect(draft).toMatchObject({
      skillId: created.id,
      baseRevision: 1,
      baseVersion: "v1.0",
    });
    expect(draft.files.map((file) => file.path)).toEqual(["SKILL.md"]);
    expect(draft.files[0]).toMatchObject({ path: "SKILL.md", readOnly: true });

    expect((await upload(draft.id, "scripts/old.sh", "old")).status).toBe(200);
    const renamed = await call(ctx.app, "PATCH", `/api/v1/skill-drafts/${draft.id}/files`, {
      body: { path: "scripts/old.sh", newPath: "references/new.sh" },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.files.map((file: { path: string }) => file.path)).toEqual([
      "SKILL.md",
      "references/new.sh",
    ]);

    const saved = await saveDraft(
      draft.id,
      { name: "场景迭代技能", body: "## 适用场景\n\n第二版正文\n" },
      1,
    );
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ id: created.id, revision: 2, version: "v1.1" });

    const detail = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(detail.body.body).toBe("## 适用场景\n\n第二版正文\n");
    expect(detail.body.files.map((file: { path: string }) => file.path)).toEqual([
      "SKILL.md",
      "references/new.sh",
    ]);

    const document = await ctx.app(
      new Request(`${basePath()}/api/v1/skills/${created.id}/document`),
    );
    expect(document.status).toBe(200);
    expect(document.headers.get("etag")).toBe('"2"');
    const markdown = await document.text();
    expect(parseSkillMarkdown(markdown)).toMatchObject({
      name: "场景迭代技能",
      version: "v1.1",
      body: "## 适用场景\n\n第二版正文\n",
    });

    const download = await downloadSkill(created.id);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(
      encodeURIComponent("场景迭代技能-v1.1.zip"),
    );
    const entries = readSkillPackage(new Uint8Array(await download.arrayBuffer()));
    expect(entries.map((entry) => entry.path)).toEqual(["SKILL.md", "references/new.sh"]);
    expect(new TextDecoder().decode(entries[1]!.data)).toBe("old");
  });

  test("TC-SKL-003 保存失败保留草稿与旧 Skill，改名后可重试成功", async () => {
    const existing = await createSkill("已存在技能");
    const draft = await createDraft();
    expect((await upload(draft.id, "scripts/keep.sh", "keep")).status).toBe(200);

    const conflict = await saveDraft(draft.id, { name: "已存在技能" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("name_conflict");

    const keptDraft = await call(ctx.app, "GET", `/api/v1/skill-drafts/${draft.id}`);
    expect(keptDraft.status).toBe(200);
    expect(keptDraft.body.files.map((file: { path: string }) => file.path)).toEqual([
      "scripts/keep.sh",
    ]);
    const unchanged = await call(ctx.app, "GET", `/api/v1/skills/${existing.id}`);
    expect(unchanged.body).toMatchObject({
      name: "已存在技能",
      revision: 1,
      version: "v1.0",
    });

    const saved = await saveDraft(draft.id, { name: "改名后技能" });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ revision: 1, version: "v1.0" });
    const detail = await call(ctx.app, "GET", `/api/v1/skills/${saved.body.id}`);
    expect(detail.body.files.map((file: { path: string }) => file.path)).toEqual([
      "SKILL.md",
      "scripts/keep.sh",
    ]);
  });

  test("TC-SKL-004 更新保存缺 If-Match 返回 428、旧版本 409，失败保留草稿", async () => {
    const created = await createSkill("并发技能");
    const draft = await createDraft(created.id);
    expect((await upload(draft.id, "references/a.md", "a")).status).toBe(200);

    const missing = await saveDraft(draft.id, { name: "并发技能 v2" });
    expect(missing.status).toBe(428);
    expect(missing.body.error.code).toBe("precondition_required");

    const stale = await saveDraft(draft.id, { name: "并发技能 v2" }, 99);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("revision_conflict");
    expect(stale.body.error.details.currentRevision).toBe(1);

    const fresh = await createDraft();
    const wrong = await saveDraft(fresh.id, { name: "新建带 If-Match" }, 1);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("validation_error");

    const afterFailure = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(afterFailure.body).toMatchObject({ revision: 1, version: "v1.0" });
    const keptDraft = await call(ctx.app, "GET", `/api/v1/skill-drafts/${draft.id}`);
    expect(keptDraft.status).toBe(200);
    expect(keptDraft.body.files.map((file: { path: string }) => file.path)).toEqual([
      "SKILL.md",
      "references/a.md",
    ]);

    const saved = await saveDraft(draft.id, { name: "并发技能 v2" }, 1);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ revision: 2, version: "v1.1" });
  });
});

describe("SCN-0003 Skill 检索与供给", () => {
  test("TC-SKR-001 列表按检索、分类、标签与启停过滤，并返回分类与引用计数", async () => {
    const first = await createSkill("检索技能 A", "coding", ["检索"]);
    const second = await createSkill("检索技能 B", "review", ["审视"]);
    const expert = await call(ctx.app, "POST", "/api/v1/experts", {
      body: {
        name: "检索专家",
        color: "#123456",
        role: "检索 Skill",
        skillIds: [first.id],
      },
    });
    expect(expert.status).toBe(201);

    const byCategory = await call(ctx.app, "GET", "/api/v1/skills?category=coding");
    expect(byCategory.body.total).toBe(1);
    expect(byCategory.body.items[0]).toMatchObject({
      id: first.id,
      name: "检索技能 A",
      categoryLabel: "编码",
      usedByCount: 1,
      tags: ["检索"],
    });

    const byTag = await call(ctx.app, "GET", "/api/v1/skills?tag=审视");
    expect(byTag.body.items.map((item: { id: string }) => item.id)).toEqual([second.id]);

    const searched = await call(
      ctx.app,
      "GET",
      "/api/v1/skills?q=检索技能&sort=name:asc",
    );
    expect(searched.body.items.map((item: { name: string }) => item.name)).toEqual([
      "检索技能 A",
      "检索技能 B",
    ]);

    const disabledOnly = await call(ctx.app, "GET", "/api/v1/skills?enabled=false");
    expect(disabledOnly.body.total).toBe(0);

    const categories = await call(ctx.app, "GET", "/api/v1/skill-categories");
    expect(categories.body.items.map((item: { code: string }) => item.code)).toEqual([
      "coding",
      "retrieval",
      "review",
      "testing",
    ]);
  });

  test("TC-SKR-002 详情返回正文与文件清单，文档原文可按 ETag 条件读取", async () => {
    const created = await createSkill("场景文档技能");
    const draft = await createDraft(created.id);
    expect((await upload(draft.id, "references/usage.md", "# 用法\n")).status).toBe(200);
    const saved = await saveDraft(
      draft.id,
      { name: "场景文档技能", body: "## 适用场景\n\n文档正文\n" },
      1,
    );
    expect(saved.status).toBe(200);

    const detail = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.body).toBe("## 适用场景\n\n文档正文\n");
    expect(detail.body.files.map((file: { path: string }) => file.path)).toEqual([
      "SKILL.md",
      "references/usage.md",
    ]);
    expect(detail.body.files.every((file: { readOnly: boolean }) => file.readOnly)).toBe(true);

    const document = await ctx.app(
      new Request(`${basePath()}/api/v1/skills/${created.id}/document`),
    );
    expect(document.status).toBe(200);
    expect(document.headers.get("content-type")).toContain("text/markdown");
    expect(document.headers.get("etag")).toBe('"2"');
    const markdown = await document.text();
    expect(markdown.endsWith("\n")).toBe(true);
    expect(parseSkillMarkdown(markdown)).toMatchObject({
      name: "场景文档技能",
      description: "基于 Call Trace 定位符号引用链",
      version: "v1.1",
      body: "## 适用场景\n\n文档正文\n",
    });

    const notModified = await ctx.app(
      new Request(`${basePath()}/api/v1/skills/${created.id}/document`, {
        headers: { "if-none-match": '"2"' },
      }),
    );
    expect(notModified.status).toBe(304);
  });

  test("TC-SKR-003 下载 zip 含当前包内容且支持 304，停用后仍可读", async () => {
    const created = await createSkill("场景下载技能");
    const draft = await createDraft(created.id);
    expect((await upload(draft.id, "scripts/run.sh", "echo hi")).status).toBe(200);
    expect(
      (
        await saveDraft(
          draft.id,
          { name: "场景下载技能", body: "## 适用场景\n\n下载正文\n" },
          1,
        )
      ).status,
    ).toBe(200);

    const download = await downloadSkill(created.id);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
    const disposition = download.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment;");
    expect(disposition).toContain(encodeURIComponent("场景下载技能-v1.1.zip"));
    expect(download.headers.get("etag")).toBe('"2"');
    const entries = readSkillPackage(new Uint8Array(await download.arrayBuffer()));
    expect(entries.map((entry) => entry.path)).toEqual(["SKILL.md", "scripts/run.sh"]);
    expect(new TextDecoder().decode(entries[1]!.data)).toBe("echo hi");

    const notModified = await downloadSkill(created.id, { "if-none-match": '"2"' });
    expect(notModified.status).toBe(304);
    expect((await notModified.arrayBuffer()).byteLength).toBe(0);

    const disabled = await call(ctx.app, "PATCH", `/api/v1/skills/${created.id}/enabled`, {
      body: { enabled: false },
      headers: withRevision(2),
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({ enabled: false, revision: 3 });

    const detail = await call(ctx.app, "GET", `/api/v1/skills/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.enabled).toBe(false);
    const document = await ctx.app(
      new Request(`${basePath()}/api/v1/skills/${created.id}/document`),
    );
    expect(document.status).toBe(200);
    expect(document.headers.get("etag")).toBe('"3"');
    expect((await downloadSkill(created.id)).status).toBe(200);
  });

  test("TC-SKR-004 未知 Skill 的详情、文档与下载返回 404，不返回 304", async () => {
    const missing = "0191f2f0-aaaa-7000-8000-000000000000";
    for (const path of [
      `/api/v1/skills/${missing}`,
      `/api/v1/skills/${missing}/document`,
      `/api/v1/skills/${missing}/download`,
    ]) {
      const response = await call(ctx.app, "GET", path, {
        headers: { "if-none-match": '"1"' },
      });
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("not_found");
    }

    const list = await call(ctx.app, "GET", "/api/v1/skills?q=不存在的技能");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);
  });
});
