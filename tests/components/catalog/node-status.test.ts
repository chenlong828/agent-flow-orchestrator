import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { normalizePageQuery } from "../../../src/core/kernel/index.ts";
import { createCatalog } from "../../../src/components/catalog/index.ts";
import type { ClientPresenceView } from "../../../src/components/scheduler/index.ts";
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

async function harnessWithClient(name: string, clientId: string | null): Promise<string> {
  const created = await ctx.harnessService.create({
    name,
    kind: "container",
    address: "10.0.4.11:7801",
    accessMode: "agent",
    concurrencyMax: 4,
    queuePolicy: "fifo",
  });
  if (clientId !== null) {
    await ctx.harnessService.bindClient(created.id, 1, {
      clientId,
      token: `token-${clientId}`,
    });
  }
  return created.id;
}

function catalogWithPresence(views: ClientPresenceView[]) {
  return createCatalog({
    harnessRead: ctx.harnessRead,
    presence: { presence: async () => views },
    toolRead: ctx.toolRead,
    skillRead: ctx.skillRead,
    expertRead: ctx.expertRead,
    workflowRead: ctx.workflowRead,
  });
}

describe("Harness 派生节点状态", () => {
  test("TC-EXN-003 unknown/online/overloaded/offline 四类派生与未绑定节点", async () => {
    const now = Date.now();
    const unknown = await harnessWithClient("未知节点", "node-unknown");
    const online = await harnessWithClient("在线节点", "node-online");
    const overloaded = await harnessWithClient("满载节点", "node-overloaded");
    const offline = await harnessWithClient("离线节点", "node-offline");
    const unbound = await harnessWithClient("未绑定节点", null);

    const catalog = catalogWithPresence([
      { clientId: "node-unknown", lastPollAt: null, free: null, running: 0 },
      {
        clientId: "node-online",
        lastPollAt: new Date(now).toISOString(),
        free: 2,
        running: 1,
      },
      {
        clientId: "node-overloaded",
        lastPollAt: new Date(now).toISOString(),
        free: 0,
        running: 4,
      },
      {
        clientId: "node-offline",
        lastPollAt: new Date(now - 121000).toISOString(),
        free: 1,
        running: 0,
      },
    ]);

    const page = await catalog.listHarnesses({ page: normalizePageQuery() });
    const byId = new Map(page.items.map((item) => [item.id, item]));

    expect(byId.get(unknown)?.health).toBe("unknown");
    expect(byId.get(unknown)?.lastHeartbeatAt).toBeNull();
    expect(byId.get(online)?.health).toBe("online");
    expect(byId.get(online)?.lastHeartbeatAt).toBe(new Date(now).toISOString());
    expect(byId.get(overloaded)?.health).toBe("overloaded");
    expect(byId.get(offline)?.health).toBe("offline");
    expect(byId.get(unbound)?.health).toBe("unknown");
    expect(byId.get(unbound)?.clientId).toBeNull();

    const detail = await catalog.getHarness(online);
    expect(detail.health).toBe("online");
  });

  test("观测不可用时降级 unknown，不伪造 offline（TC-EXN-003 的一部分）", async () => {
    const bound = await harnessWithClient("观测失败节点", "node-presence-down");
    const catalog = createCatalog({
      harnessRead: ctx.harnessRead,
      presence: {
        presence: async () => {
          throw new Error("scheduler unavailable");
        },
      },
      toolRead: ctx.toolRead,
      skillRead: ctx.skillRead,
      expertRead: ctx.expertRead,
      workflowRead: ctx.workflowRead,
    });

    const page = await catalog.listHarnesses({ page: normalizePageQuery() });
    const item = page.items.find((entry) => entry.id === bound);
    expect(item?.health).toBe("unknown");
    expect(item?.lastHeartbeatAt).toBeNull();
  });
});
