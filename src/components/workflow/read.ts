import {
  NotFoundError,
  type Page,
} from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";
import { toIso } from "./format.ts";
import { createWorkflowStore } from "./store.ts";
import type {
  WorkflowDetail,
  WorkflowQuery,
  WorkflowRead,
  WorkflowReference,
  WorkflowSummary,
} from "./types.ts";
import type { WorkflowGraph } from "./graph.ts";

function toSummary(row: {
  id: string;
  name: string;
  type: string;
  description: string;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  updated_by: string | null;
  node_count: number;
  stage_count: number;
}): WorkflowSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    nodeCount: row.node_count,
    stageCount: row.stage_count,
    revision: row.revision,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function toDetail(row: Parameters<typeof toSummary>[0], graph: WorkflowGraph): WorkflowDetail {
  return { ...toSummary(row), graph };
}

export function createWorkflowRead(deps: { db: Db }): WorkflowRead {
  const { db } = deps;
  const store = createWorkflowStore(db);

  return {
    async list(query: WorkflowQuery): Promise<Page<WorkflowSummary>> {
      const { rows, total } = await store.listRoots(db, query);
      return {
        items: rows.map((row) => toSummary(row)),
        total,
        limit: query.page.limit,
        offset: query.page.offset,
      };
    },

    async get(id: string): Promise<WorkflowDetail> {
      const root = await store.findRoot(db, id);
      if (root === null) throw new NotFoundError("工作流", id);
      const definition = await store.findDefinition(db, id);
      if (definition === null) throw new NotFoundError("工作流定义", id);
      return toDetail(root, definition.graph);
    },

    async listByExpert(expertId: string): Promise<WorkflowReference[]> {
      return store.listByExpert(db, expertId);
    },

    async countByExperts(expertIds: string[]): Promise<Record<string, number>> {
      return store.countByExperts(db, expertIds);
    },
  };
}
