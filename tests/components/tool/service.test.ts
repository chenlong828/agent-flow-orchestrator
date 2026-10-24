import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  NotFoundError,
  ReferencedError,
  RevisionConflictError,
  ValidationError,
  normalizePageQuery,
} from "../../../src/core/kernel/index.ts";
import { HarnessNotFoundError } from "../../../src/components/tool/index.ts";
import { closeTestDb, resetBusinessData } from "../../helpers/test-db.ts";
import { createTestContext, type TestContext } from "../../helpers/app.ts";
import { fakeGuard } from "../../helpers/fakes.ts";
import { createToolRead, createToolService } from "../../../src/components/tool/index.ts";
import { systemClock, uuidv7Ids } from "../../../src/core/platform/index.ts";

let ctx: TestContext;
let harnessId: string;

function toolBody(name = "trace_call_chain") {
  return {
    name,
    kind: "cli" as const,
    invocation: "trace --path {path}",
    description: "调用链追踪",
    harnessId,
    timeoutMs: 30000,
    params: [
      { paramKey: "path", type: "string" as const, description: "目标路径" },
      { paramKey: "depth", type: "int" as const },
    ],
  };
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
});

afterAll(async () => {
  await closeTestDb();
});

describe("工具写入规则", () => {
  test("创建后 status=unverified、lastDebugAt=null，参数按位置回读", async () => {
    const created = await ctx.toolService.create(toolBody());
    expect(created.revision).toBe(1);
    const detail = await ctx.catalog.getTool(created.id);
    expect(detail.status).toBe("unverified");
    expect(detail.lastDebugAt).toBeNull();
    expect(detail.params).toEqual([
      { key: "path", type: "string", description: "目标路径" },
      { key: "depth", type: "int", description: "" },
    ]);
    expect(detail.harnessId).toBe(harnessId);
  });

  test("名称大小写不敏感唯一", async () => {
    await ctx.toolService.create(toolBody());
    const error = await ctx.toolService.create(toolBody("TRACE_CALL_CHAIN")).catch((e) => e);
    expect(error.code).toBe("name_conflict");
  });

  test("Harness 不存在、超时越界、参数键重复都被拒绝", async () => {
    const missingHarness = await ctx.toolService
      .create({ ...toolBody("t1"), harnessId: "0191f2f0-0000-7000-8000-000000000000" })
      .catch((e) => e);
    expect(missingHarness).toBeInstanceOf(HarnessNotFoundError);
    expect(missingHarness.details.field).toBe("harnessId");

    const badTimeout = await ctx.toolService
      .create({ ...toolBody("t2"), timeoutMs: 999 })
      .catch((e) => e);
    expect(badTimeout).toBeInstanceOf(ValidationError);
    expect(badTimeout.details.field).toBe("timeoutMs");

    const duplicateParam = await ctx.toolService
      .create({
        ...toolBody("t3"),
        params: [
          { paramKey: "p", type: "string" as const },
          { paramKey: "p", type: "int" as const },
        ],
      })
      .catch((e) => e);
    expect(duplicateParam).toBeInstanceOf(ValidationError);
    expect(duplicateParam.details.field).toBe("params");
  });

  test("更新整体替换参数、递增 revision，旧 revision 冲突", async () => {
    const created = await ctx.toolService.create(toolBody());
    const updated = await ctx.toolService.update(created.id, 1, {
      ...toolBody(),
      invocation: "trace --fast {path}",
      params: [{ paramKey: "target", type: "string" as const }],
    });
    expect(updated.revision).toBe(2);
    const detail = await ctx.catalog.getTool(created.id);
    expect(detail.invocation).toBe("trace --fast {path}");
    expect(detail.params).toEqual([{ key: "target", type: "string", description: "" }]);

    const stale = await ctx.toolService.update(created.id, 1, toolBody()).catch((e) => e);
    expect(stale).toBeInstanceOf(RevisionConflictError);
    expect(stale.details.currentRevision).toBe(2);
  });

  test("被专家引用时拒绝删除；无引用时删除并级联参数", async () => {
    const created = await ctx.toolService.create(toolBody());
    const db = await ctx.db;
    const guard = fakeGuard([{ type: "expert", id: "expert-1", name: "方案设计专家" }]);
    const guardedService = createToolService({
      db,
      clock: systemClock,
      ids: uuidv7Ids,
      guard,
      actor: "tester",
    });
    const error = await guardedService.delete(created.id, 1).catch((e) => e);
    expect(error).toBeInstanceOf(ReferencedError);
    expect(error.details.references).toEqual([
      { type: "expert", id: "expert-1", name: "方案设计专家" },
    ]);

    await ctx.toolService.delete(created.id, 1);
    const params = await db.query("select 1 from tool_param where tool_id = $1", [created.id]);
    expect(params.length).toBe(0);
    const read = createToolRead({ db });
    const missing = await read.get(created.id).catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundError);
  });
});

describe("工具读契约", () => {
  test("列表按类型、状态、Harness 筛选；getSummary 与 listByHarness 可用", async () => {
    await ctx.toolService.create(toolBody("trace-call-chain"));
    await ctx.toolService.create({ ...toolBody("smoke"), kind: "mcp" as const });
    await ctx.toolService.create({ ...toolBody("seed"), kind: "script" as const });

    const cli = await ctx.catalog.listTools({
      kind: "cli",
      page: normalizePageQuery(),
    });
    expect(cli.total).toBe(1);
    expect(cli.items[0]?.name).toBe("trace-call-chain");
    expect(cli.items[0]?.paramCount).toBe(2);
    expect(cli.items[0]?.harnessName).toBe("build-01");

    const byHarness = await ctx.catalog.listTools({
      harnessId,
      page: normalizePageQuery(),
    });
    expect(byHarness.total).toBe(3);

    const tools = await ctx.toolRead.getSummary(cli.items[0]!.id);
    expect(tools.params.length).toBe(2);
    const refs = await ctx.toolRead.listByHarness(harnessId);
    expect(refs.map((ref) => ref.name).sort()).toEqual(["seed", "smoke", "trace-call-chain"]);
  });
});
