import type { Page } from "../../core/kernel/index.ts";
import type { HarnessQuery, HarnessSummary } from "../harness/index.ts";
import type { SchedulerPresenceRead, ClientPresenceView } from "../scheduler/index.ts";
import type { CatalogDeps, HarnessDetailView, HarnessListItem } from "./types.ts";

const CLIENT_SILENT_MS = 120000;

type DerivedStatus = {
  health: HarnessListItem["health"];
  lastHeartbeatAt: string | null;
};

function deriveStatus(
  clientId: string | null,
  view: ClientPresenceView | undefined,
  now: number,
): DerivedStatus {
  if (clientId === null || view === undefined || view.lastPollAt === null) {
    return { health: "unknown", lastHeartbeatAt: null };
  }
  const lastPollAt = new Date(view.lastPollAt).getTime();
  if (now - lastPollAt > CLIENT_SILENT_MS) {
    return { health: "offline", lastHeartbeatAt: view.lastPollAt };
  }
  return {
    health: (view.free ?? 0) > 0 ? "online" : "overloaded",
    lastHeartbeatAt: view.lastPollAt,
  };
}

async function presenceFor(
  deps: SchedulerPresenceRead,
  harnesses: HarnessSummary[],
): Promise<Map<string, ClientPresenceView>> {
  const clientIds = harnesses
    .map((harness) => harness.clientId)
    .filter((clientId): clientId is string => clientId !== null);
  if (clientIds.length === 0) return new Map();
  try {
    const views = await deps.presence([...new Set(clientIds)]);
    return new Map(views.map((view) => [view.clientId, view]));
  } catch {
    // 观测不可用时降级为 unknown，不伪造 offline，也不阻塞 Harness 读。
    return new Map();
  }
}

function withStatus<T extends HarnessSummary>(
  harness: T,
  statuses: Map<string, ClientPresenceView>,
  now: number,
): T {
  const status = deriveStatus(harness.clientId, statuses.get(harness.clientId ?? ""), now);
  return { ...harness, ...status };
}

export async function listHarnesses(
  ctx: CatalogDeps,
  query: HarnessQuery,
): Promise<Page<HarnessListItem>> {
  const page = await ctx.harnessRead.list(query);
  const statuses = await presenceFor(ctx.presence, page.items);
  const now = Date.now();
  const items: HarnessListItem[] = [];
  for (const harness of page.items) {
    const tools = await ctx.toolRead.listByHarness(harness.id);
    items.push({ ...withStatus(harness, statuses, now), toolCount: tools.length });
  }
  return { ...page, items };
}

export async function getHarness(
  ctx: CatalogDeps,
  id: string,
): Promise<HarnessDetailView> {
  const harness = await ctx.harnessRead.get(id);
  const tools = await ctx.toolRead.listByHarness(id);
  const statuses = await presenceFor(ctx.presence, [harness]);
  const now = Date.now();
  return { ...withStatus(harness, statuses, now), toolCount: tools.length };
}
