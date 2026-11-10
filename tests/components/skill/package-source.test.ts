import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PackageNotFoundError, PackageUnavailableError } from "../../../src/core/kernel/index.ts";
import { sha256Hex } from "../../../src/components/skill/digest.ts";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";

let ctx: TestContext;

beforeEach(async () => {
  await resetBusinessData();
  ctx = await createTestContext();
});

afterAll(async () => {
  await closeTestDb();
});

describe("执行面制品供给", () => {
  test("当前包引用：packageId、摘要、大小与 ETag 由字节派生", async () => {
    const skill = await ctx.skillService.create({
      name: "制品供给",
      categoryCode: "coding",
      description: "用于执行面制品供给测试",
    });
    const ref = await ctx.packages.currentForSkill(skill.id);

    expect(ref.packageId).toBe(`${skill.id}.1`);
    expect(ref.skillId).toBe(skill.id);
    expect(ref.version).toBe("v1.0");
    expect(ref.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ref.etag).toBe(`"sha256-${ref.digest.replace(/^sha256:/, "")}"`);
    expect(ref.sizeBytes).toBeGreaterThan(0);

    const opened = await ctx.packages.open(ref.packageId);
    expect(sha256Hex(opened.data)).toBe(ref.digest.replace(/^sha256:/, ""));
    expect(opened.data.byteLength).toBe(ref.sizeBytes);
    expect(await ctx.packages.describe(ref.packageId)).toEqual(ref);
  });

  test("未知 packageId 与过期版本返回 null，open 抛 package_not_found", async () => {
    const skill = await ctx.skillService.create({
      name: "版本失效",
      categoryCode: "coding",
      description: "用于版本失效测试",
    });
    expect(await ctx.packages.describe(`${skill.id}.99`)).toBeNull();
    expect(await ctx.packages.describe("not-a-package")).toBeNull();
    await expect(ctx.packages.open(`${skill.id}.99`)).rejects.toBeInstanceOf(PackageNotFoundError);
  });

  test("保存新版本后旧 packageId 不再可下载，新版本引用变化", async () => {
    const skill = await ctx.skillService.create({
      name: "升级失效",
      categoryCode: "coding",
      description: "用于升级失效测试",
    });
    const before = await ctx.packages.currentForSkill(skill.id);

    const draft = await ctx.skillDraftService.createDraft(skill.id);
    await ctx.skillDraftService.saveDraft(draft.id, 1, {
      name: "升级失效",
      categoryCode: "coding",
      description: "用于升级失效测试",
      body: "## 变更\n\n新版本正文",
    });
    const after = await ctx.packages.currentForSkill(skill.id);

    expect(after.packageId).toBe(`${skill.id}.2`);
    expect(after.digest).not.toBe(before.digest);
    expect(await ctx.packages.describe(before.packageId)).toBeNull();
    await expect(ctx.packages.open(before.packageId)).rejects.toBeInstanceOf(PackageNotFoundError);
    expect((await ctx.packages.open(after.packageId)).data.byteLength).toBe(after.sizeBytes);
  });

  test("包字节缺失或摘要不符时抛 package_unavailable", async () => {
    const skill = await ctx.skillService.create({
      name: "包损坏",
      categoryCode: "coding",
      description: "用于包损坏测试",
    });
    const ref = await ctx.packages.currentForSkill(skill.id);
    await ctx.db.query("update skill set package_digest = $1 where id = $2", [
      "0".repeat(64),
      skill.id,
    ]);
    await expect(ctx.packages.open(ref.packageId)).rejects.toBeInstanceOf(PackageUnavailableError);
  });
});
