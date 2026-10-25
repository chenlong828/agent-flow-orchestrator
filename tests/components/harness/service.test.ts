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
  createHarnessRead,
  createHarnessService,
  type HarnessService,
} from "../../../src/components/harness/index.ts";
import { systemClock, uuidv7Ids } from "../../../src/core/platform/index.ts";
import { closeTestDb, getTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { fakeGuard } from "../../helpers/fakes.ts";

let service: HarnessService;
let read: ReturnType<typeof createHarnessRead>;
let guard = fakeGuard();

function createInput(name: string) {
  return {
    name,
    kind: "container" as const,
    address: "10.0.4.11:7801",
    accessMode: "container_registry" as const,
    description: "CI 构建容器池节点",
    concurrencyMax: 20,
    queuePolicy: "fifo" as const,
    tags: ["CICD", "构建", "测试"],
  };
}

beforeAll(async () => {
  const db = await getTestDb();
  guard = fakeGuard();
  service = createHarnessService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    guard,
    actor: "tester",
  });
  read = createHarnessRead({ db });
});

beforeEach(async () => {
  await resetBusinessData();
  guard = fakeGuard();
  const db = await getTestDb();
  service = createHarnessService({
    db,
    clock: systemClock,
    ids: uuidv7Ids,
    guard,
    actor: "tester",
  });
});

afterAll(async () => {
  await closeTestDb();
});

describe("Harness 写入规则", () => {
  test("创建后 revision=1，运行时字段为 unknown/null，标签按输入顺序回读", async () => {
    const created = await service.create(createInput("build-01"));
    expect(created.revision).toBe(1);
    const detail = await read.get(created.id);
    expect(detail.name).toBe("build-01");
    expect(detail.enabled).toBe(true);
    expect(detail.health).toBe("unknown");
    expect(detail.lastHeartbeatAt).toBeNull();
    expect(detail.tags).toEqual(["CICD", "构建", "测试"]);
    expect(detail.revision).toBe(1);
    expect(detail.createdAt).toBe(detail.updatedAt);
  });

  test("名称大小写不敏感唯一，重复创建返回 name_conflict", async () => {
    await service.create(createInput("build-01"));
    const error = await service.create(createInput("BUILD-01")).catch((e) => e);
    expect(error).toBeInstanceOf(NameConflictError);
    expect(error.code).toBe("name_conflict");
  });

  test("非法枚举、并发上限与重复标签被拒绝", async () => {
    const badKind = await service
      .create({ ...createInput("x1"), kind: "vm" as never })
      .catch((e) => e);
    expect(badKind).toBeInstanceOf(ValidationError);
    expect(badKind.details.field).toBe("kind");

    const badAccessMode = await service
      .create({ ...createInput("x-access"), accessMode: "telnet" as never })
      .catch((e) => e);
    expect(badAccessMode).toBeInstanceOf(ValidationError);
    expect(badAccessMode.details.field).toBe("accessMode");

    const badQueuePolicy = await service
      .create({ ...createInput("x-queue"), queuePolicy: "lifo" as never })
      .catch((e) => e);
    expect(badQueuePolicy).toBeInstanceOf(ValidationError);
    expect(badQueuePolicy.details.field).toBe("queuePolicy");

    const badConcurrency = await service
      .create({ ...createInput("x2"), concurrencyMax: 0 })
      .catch((e) => e);
    expect(badConcurrency).toBeInstanceOf(ValidationError);
    expect(badConcurrency.details.field).toBe("concurrencyMax");

    const duplicateTags = await service
      .create({ ...createInput("x3"), tags: ["a", "a"] })
      .catch((e) => e);
    expect(duplicateTags).toBeInstanceOf(ValidationError);
    expect(duplicateTags.details.field).toBe("tags");
  });

  test("更新整体替换标签并递增 revision，旧 revision 返回当前值", async () => {
    const created = await service.create(createInput("build-01"));
    const result = await service.update(created.id, 1, {
      ...createInput("build-01"),
      kind: "server",
      tags: ["调试"],
    });
    expect(result.revision).toBe(2);
    const detail = await read.get(created.id);
    expect(detail.kind).toBe("server");
    expect(detail.tags).toEqual(["调试"]);

    const stale = await service
      .update(created.id, 1, createInput("build-01"))
      .catch((e) => e);
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect(stale.details.currentRevision).toBe(2);
  });

  test("启停只改 enabled 与 revision，不级联其他字段", async () => {
    const created = await service.create(createInput("build-01"));
    const result = await service.setEnabled(created.id, 1, false);
    expect(result.revision).toBe(2);
    const detail = await read.get(created.id);
    expect(detail.enabled).toBe(false);
    expect(detail.name).toBe("build-01");
    expect(detail.tags).toEqual(["CICD", "构建", "测试"]);
  });

  test("更新改名冲突返回 name_conflict，原标签与 revision 不被改写", async () => {
    const first = await service.create(createInput("build-01"));
    await service.create(createInput("build-02"));

    const error = await service
      .update(first.id, 1, createInput("BUILD-02"))
      .catch((e) => e);
    expect(error).toBeInstanceOf(NameConflictError);
    expect(error.code).toBe("name_conflict");

    const after = await read.get(first.id);
    expect(after.name).toBe("build-01");
    expect(after.revision).toBe(1);
    expect(after.tags).toEqual(["CICD", "构建", "测试"]);
  });

  test("启停拒绝非布尔值，未知资源 404，旧 revision 409", async () => {
    const badValue = await service
      .setEnabled("0191f2f0-0000-7000-8000-000000000000", 1, "false" as never)
      .catch((e) => e);
    expect(badValue).toBeInstanceOf(ValidationError);
    expect(badValue.details.field).toBe("enabled");

    const missing = await service
      .setEnabled("0191f2f0-0000-7000-8000-000000000000", 1, false)
      .catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);

    const created = await service.create(createInput("build-01"));
    await service.setEnabled(created.id, 1, false);
    const stale = await service.setEnabled(created.id, 1, true).catch((e) => e);
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect(stale.details.currentRevision).toBe(2);
  });

  test("删除未知资源 404，旧 revision 409", async () => {
    const missing = await service
      .delete("0191f2f0-0000-7000-8000-000000000000", 1)
      .catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);

    const created = await service.create(createInput("build-01"));
    const stale = await service.delete(created.id, 2).catch((e) => e);
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect(stale.details.currentRevision).toBe(1);
    expect((await read.get(created.id)).revision).toBe(1);
  });

  test("被引用时拒绝删除，并返回引用列表", async () => {
    const created = await service.create(createInput("build-01"));
    guard = fakeGuard([{ type: "tool", id: "tool-1", name: "trace_call_chain" }]);
    const db = await getTestDb();
    service = createHarnessService({
      db,
      clock: systemClock,
      ids: uuidv7Ids,
      guard,
      actor: "tester",
    });
    const error = await service.delete(created.id, 1).catch((e) => e);
    expect(error).toBeInstanceOf(ReferencedError);
    expect(error.code).toBe("referenced");
    expect(error.details.references).toEqual([
      { type: "tool", id: "tool-1", name: "trace_call_chain" },
    ]);
    expect(error.details.asset).toEqual({
      type: "harness",
      id: created.id,
      name: "build-01",
    });
    expect((await read.get(created.id)).revision).toBe(1);
  });

  test("无引用时删除成功，标签随聚合级联删除", async () => {
    const created = await service.create(createInput("build-01"));
    await service.delete(created.id, 1);
    const error = await read.get(created.id).catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundError);

    const db = await getTestDb();
    const rows = await db.query("select 1 from harness_tag where harness_id = $1", [
      created.id,
    ]);
    expect(rows.length).toBe(0);
  });
});

describe("Harness 读契约", () => {
  test("列表按名称、类型、启停、健康筛选，并返回正确总数", async () => {
    const build = await service.create({ ...createInput("build-01"), kind: "container" });
    await service.create({ ...createInput("build-02"), kind: "container" });
    const agent = await service.create({ ...createInput("agent-07"), kind: "server" });
    await service.setEnabled(agent.id, 1, false);
    const db = await getTestDb();
    await db.query("update harness set health = $1 where id = $2", ["online", build.id]);

    const byKind = await read.list({
      kind: "container",
      page: normalizePageQuery(),
    });
    expect(byKind.total).toBe(2);
    expect(byKind.items.map((item) => item.name).sort()).toEqual(["build-01", "build-02"]);

    const byQuery = await read.list({ q: "AGENT", page: normalizePageQuery() });
    expect(byQuery.total).toBe(1);
    expect(byQuery.items[0]?.name).toBe("agent-07");

    const disabled = await read.list({ enabled: false, page: normalizePageQuery() });
    expect(disabled.total).toBe(1);
    expect(disabled.items[0]?.name).toBe("agent-07");

    const online = await read.list({ health: "online", page: normalizePageQuery() });
    expect(online.total).toBe(1);
    expect(online.items[0]?.name).toBe("build-01");
  });

  test("列表分页与名称排序稳定，详情不含 toolCount", async () => {
    await service.create(createInput("c"));
    await service.create(createInput("a"));
    await service.create(createInput("b"));
    const page = await read.list({ page: normalizePageQuery(2, 1), sort: "name" });
    expect(page.total).toBe(3);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(1);
    expect(page.items.map((item) => item.name)).toEqual(["b", "c"]);
    expect("toolCount" in (page.items[0] as object)).toBe(false);
  });

  test("详情返回 description 与 createdAt，不存在返回 not_found", async () => {
    const created = await service.create(createInput("build-01"));
    const detail = await read.get(created.id);
    expect(detail.description).toBe("CI 构建容器池节点");
    expect(detail.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const missing = await read.get("0191f2f0-0000-7000-8000-000000000000").catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect(missing.code).toBe("not_found");
  });
});
