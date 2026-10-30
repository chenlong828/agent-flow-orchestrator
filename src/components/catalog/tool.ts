import type { Page } from "../../core/kernel/index.ts";
import type { ToolQuery, ToolSummary } from "../tool/index.ts";
import type { CatalogContext } from "./context.ts";
import type { ToolDetailView, ToolListItem } from "./types.ts";

async function harnessNameFor(ctx: CatalogContext, harnessId: string): Promise<string> {
  const harness = await ctx.harnessRead.get(harnessId);
  return harness.name;
}

function projectToolListItem(
  tool: ToolSummary,
  harnessName: string,
  usedByCount: number,
): ToolListItem {
  return {
    id: tool.id,
    name: tool.name,
    kind: tool.kind,
    invocation: tool.invocation,
    description: tool.description,
    harnessId: tool.harnessId,
    harnessName,
    timeoutMs: tool.timeoutMs,
    status: tool.status,
    lastDebugAt: tool.lastDebugAt,
    paramCount: tool.params.length,
    usedByCount,
    revision: tool.revision,
    updatedAt: tool.updatedAt,
  };
}

export async function listTools(
  ctx: CatalogContext,
  query: ToolQuery,
): Promise<Page<ToolListItem>> {
  const page = await ctx.toolRead.list(query);
  const items: ToolListItem[] = [];
  for (const tool of page.items) {
    const harnessName = await harnessNameFor(ctx, tool.harnessId);
    const usedBy = await ctx.expertRead.listExpertsUsingTool(tool.id);
    items.push(projectToolListItem(tool, harnessName, usedBy.length));
  }
  return { ...page, items };
}

export async function getTool(ctx: CatalogContext, id: string): Promise<ToolDetailView> {
  const tool = await ctx.toolRead.get(id);
  const harnessName = await harnessNameFor(ctx, tool.harnessId);
  const usedBy = await ctx.expertRead.listExpertsUsingTool(id);
  return {
    id: tool.id,
    name: tool.name,
    kind: tool.kind,
    invocation: tool.invocation,
    harnessId: tool.harnessId,
    harnessName,
    timeoutMs: tool.timeoutMs,
    status: tool.status,
    lastDebugAt: tool.lastDebugAt,
    paramCount: tool.params.length,
    usedByCount: usedBy.length,
    revision: tool.revision,
    updatedAt: tool.updatedAt,
    description: tool.description,
    params: tool.params.map((param) => ({
      key: param.paramKey,
      type: param.type,
      description: param.description ?? "",
    })),
    createdAt: tool.createdAt,
  };
}
