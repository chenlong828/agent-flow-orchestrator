import type { Page, Reference } from "../../core/kernel/index.ts";
import type {
  WorkflowDetail,
  WorkflowQuery,
  WorkflowSummary,
} from "../workflow/index.ts";
import { toReferences } from "./context.ts";
import type { CatalogDeps } from "./types.ts";

export async function listWorkflows(
  ctx: CatalogDeps,
  query: WorkflowQuery,
): Promise<Page<WorkflowSummary>> {
  return ctx.workflowRead.list(query);
}

export async function getWorkflow(
  ctx: CatalogDeps,
  id: string,
): Promise<WorkflowDetail> {
  return ctx.workflowRead.get(id);
}

export async function listWorkflowsByExpertReferences(
  ctx: CatalogDeps,
  expertId: string,
): Promise<Reference[]> {
  const workflows = await ctx.workflowRead.listByExpert(expertId);
  return toReferences("workflow", workflows);
}
