import type { Page, Reference } from "../../core/kernel/index.ts";
import type {
  WorkflowDetail,
  WorkflowQuery,
  WorkflowSummary,
} from "../workflow/index.ts";
import { toReferences } from "./context.ts";
import type { CatalogContext } from "./context.ts";

export async function listWorkflows(
  ctx: CatalogContext,
  query: WorkflowQuery,
): Promise<Page<WorkflowSummary>> {
  return ctx.workflowRead.list(query);
}

export async function getWorkflow(
  ctx: CatalogContext,
  id: string,
): Promise<WorkflowDetail> {
  return ctx.workflowRead.get(id);
}

export async function listWorkflowsByExpertReferences(
  ctx: CatalogContext,
  expertId: string,
): Promise<Reference[]> {
  const workflows = await ctx.workflowRead.listByExpert(expertId);
  return toReferences("workflow", workflows);
}
