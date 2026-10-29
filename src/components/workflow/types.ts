import type { Page, PageQuery } from "../../core/kernel/index.ts";
import type {
  Stage,
  ValidationIssue,
  ValidationReport,
  Viewport,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from "./graph.ts";

export type {
  EdgeKind,
  Layout,
  NodeType,
  Stage,
  ValidationIssue,
  ValidationReport,
  Viewport,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from "./graph.ts";

export type CreateWorkflow = {
  name: string;
  type: string;
  description?: string;
  graph: unknown;
};

export type UpdateWorkflow = {
  name: string;
  type: string;
  description: string;
};

export type CopyWorkflow = {
  name?: string;
};

export type SaveDefinitionInput = {
  graph: unknown;
};

export type WorkflowSummary = {
  id: string;
  name: string;
  type: string;
  description: string;
  nodeCount: number;
  stageCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type WorkflowDetail = WorkflowSummary & {
  graph: WorkflowGraph;
};

export type WorkflowReference = { id: string; name: string };

export type WorkflowQuery = {
  q?: string;
  type?: string;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt";
};

export type WorkflowDslMetadata = {
  name: string;
  type: string;
  description: string;
};

export type WorkflowDsl = {
  dslVersion: 1;
  metadata: WorkflowDslMetadata;
  stages: Stage[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  layout?: { viewport?: Record<string, unknown> };
};

export type WorkflowService = {
  create(
    input: CreateWorkflow,
    actor?: string,
  ): Promise<{ id: string; revision: number; warnings: ValidationIssue[] }>;
  update(
    id: string,
    revision: number,
    input: UpdateWorkflow,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
  copy(
    id: string,
    input: CopyWorkflow,
    actor?: string,
  ): Promise<{ id: string; revision: number; warnings: ValidationIssue[] }>;
  saveDefinition(
    id: string,
    revision: number,
    input: SaveDefinitionInput,
    actor?: string,
  ): Promise<{ id: string; revision: number; warnings: ValidationIssue[] }>;
  validate(graph: unknown): Promise<ValidationReport>;
  exportDsl(id: string): Promise<WorkflowDsl>;
  importDsl(
    dsl: WorkflowDsl,
    actor?: string,
  ): Promise<{
    id: string;
    revision: number;
    idMap: Record<string, string>;
    warnings: ValidationIssue[];
  }>;
};

export type WorkflowRead = {
  list(query: WorkflowQuery): Promise<Page<WorkflowSummary>>;
  get(id: string): Promise<WorkflowDetail>;
  listByExpert(expertId: string): Promise<WorkflowReference[]>;
  countByExperts(expertIds: string[]): Promise<Record<string, number>>;
};
