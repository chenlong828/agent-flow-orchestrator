import type { Page } from "../../core/kernel/index.ts";
import type { HarnessQuery } from "../harness/index.ts";
import type { CatalogContext } from "./context.ts";
import type { HarnessDetailView, HarnessListItem } from "./types.ts";

export async function listHarnesses(
  ctx: CatalogContext,
  query: HarnessQuery,
): Promise<Page<HarnessListItem>> {
  const page = await ctx.harnessRead.list(query);
  const items: HarnessListItem[] = [];
  for (const harness of page.items) {
    const tools = await ctx.toolRead.listByHarness(harness.id);
    items.push({ ...harness, toolCount: tools.length });
  }
  return { ...page, items };
}

export async function getHarness(
  ctx: CatalogContext,
  id: string,
): Promise<HarnessDetailView> {
  const harness = await ctx.harnessRead.get(id);
  const tools = await ctx.toolRead.listByHarness(id);
  return { ...harness, toolCount: tools.length };
}
