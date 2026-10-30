import {
  MultiFieldValidationError,
  NameConflictError,
  NotFoundError,
  RevisionConflictError,
  ValidationError,
  type Clock,
  type ExpertStatusReader,
  type IdGenerator,
} from "../../core/kernel/index.ts";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  type Db,
} from "../../core/platform/index.ts";
import { collectGraph, parseGraph, type ValidationIssue, type WorkflowGraph } from "./graph.ts";
import { analyzeBindings, analyzeTopology } from "./graph-analysis.ts";
import { createWorkflowStore } from "./store.ts";
import { normalizeDsl } from "./dsl.ts";
import { toIso } from "./format.ts";
import { ensureDescription, ensureText, shapeToMultiField } from "./validation.ts";
import type {
  CopyWorkflow,
  CreateWorkflow,
  SaveDefinitionInput,
  UpdateWorkflow,
  WorkflowDetail,
  WorkflowDsl,
  WorkflowQuery,
  WorkflowRead,
  WorkflowReference,
  WorkflowService,
  WorkflowSummary,
} from "./types.ts";

export type WorkflowDeps = {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  actor: string;
  expertStatus: ExpertStatusReader;
};

function normalizeCreate(input: CreateWorkflow): { name: string; type: string; description: string } {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  return {
    name: ensureText(input.name, "name", 80),
    type: ensureText(input.type, "type", 40),
    description: ensureDescription(input.description),
  };
}

function normalizeUpdate(input: UpdateWorkflow): { name: string; type: string; description: string } {
  if (input === null || typeof input !== "object") {
    throw new ValidationError("body", "必须是对象");
  }
  if (input.description === undefined) {
    throw new ValidationError("description", "不能为空");
  }
  return {
    name: ensureText(input.name, "name", 80),
    type: ensureText(input.type, "type", 40),
    description: ensureDescription(input.description),
  };
}

function defaultCopyName(sourceName: string): string {
  const suffix = " 副本";
  return `${sourceName.slice(0, 80 - suffix.length)}${suffix}`;
}

function copyName(base: string, index: number): string {
  if (index === 1) return base;
  const suffix = ` (${index})`;
  return `${base.slice(0, 80 - suffix.length)}${suffix}`;
}

function expertIds(graph: WorkflowGraph): string[] {
  return [...new Set(graph.nodes.map((node) => node.expertId).filter((id): id is string => id !== null))];
}

function expertPath(index: number): string {
  return `graph.nodes[${index}].expertId`;
}


type WorkflowContext = {
  deps: WorkflowDeps;
  store: ReturnType<typeof createWorkflowStore>;
};

export function createWorkflowService(deps: WorkflowDeps): WorkflowService {
  const ctx: WorkflowContext = { deps, store: createWorkflowStore(deps.db) };
  return {
    create: (input) => createWorkflow(ctx, input),
    update: (id, revision, input) => updateWorkflow(ctx, id, revision, input),
    delete: (id, revision) => deleteWorkflow(ctx, id, revision),
    copy: (id, input) => copyWorkflow(ctx, id, input),
    saveDefinition: (id, revision, input) => saveWorkflowDefinition(ctx, id, revision, input),
    validate: (input) => validateWorkflow(ctx, input),
    exportDsl: (id) => exportWorkflowDsl(ctx, id),
    importDsl: (input) => importWorkflowDsl(ctx, input),
  };
}

async function getRootAndGraph(
  ctx: WorkflowContext,
  id: string,
): Promise<{
  root: NonNullable<Awaited<ReturnType<WorkflowContext["store"]["findRoot"]>>>;
  graph: WorkflowGraph;
}> {
  const root = await ctx.store.findRoot(ctx.deps.db, id);
  if (root === null) throw new NotFoundError("工作流", id);
  const definition = await ctx.store.findDefinition(ctx.deps.db, id);
  if (definition === null) throw new NotFoundError("工作流定义", id);
  return { root, graph: definition.graph };
}

async function resolveExpertIssues(
  ctx: WorkflowContext,
  graph: WorkflowGraph,
): Promise<{
  missing: ValidationIssue[];
  disabled: ValidationIssue[];
  missingIds: Set<string>;
}> {
  const idsInGraph = expertIds(graph);
  const byId = new Map(
    Object.entries(await ctx.deps.expertStatus.statuses(idsInGraph)),
  );
  const missing: ValidationIssue[] = [];
  const disabled: ValidationIssue[] = [];
  const missingIds = new Set<string>();
  for (const [index, node] of graph.nodes.entries()) {
    if (node.expertId === null) continue;
    const enabled = byId.get(node.expertId);
    if (enabled === undefined) {
      missingIds.add(node.expertId);
      missing.push({ code: "expert_missing", path: expertPath(index), message: "专家不存在" });
    } else if (!enabled) {
      disabled.push({ code: "expert_disabled", path: expertPath(index), message: "专家已停用" });
    }
  }
  return { missing, disabled, missingIds };
}

async function validateGraphForWrite(
  ctx: WorkflowContext,
  graph: WorkflowGraph,
): Promise<{ errors: ValidationIssue[]; warnings: ValidationIssue[] }> {
  const errors = [...analyzeTopology(graph), ...analyzeBindings(graph)];
  const expert = await resolveExpertIssues(ctx, graph);
  return { errors: [...errors, ...expert.missing], warnings: expert.disabled };
}

async function validateGraphForImport(
  ctx: WorkflowContext,
  graph: WorkflowGraph,
): Promise<{
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  missingIds: Set<string>;
}> {
  const errors = [
    ...analyzeTopology(graph),
    ...analyzeBindings(graph).filter((issue) => issue.code === "expert_forbidden"),
  ];
  const expert = await resolveExpertIssues(ctx, graph);
  return {
    errors,
    warnings: [...expert.missing, ...expert.disabled],
    missingIds: expert.missingIds,
  };
}

async function createWorkflow(
  ctx: WorkflowContext,
  input: CreateWorkflow,
): Promise<{ id: string; revision: number; warnings: ValidationIssue[] }> {
  const normalized = normalizeCreate(input);
  if (input.graph === undefined) {
    throw new MultiFieldValidationError([
      { code: "graph_shape", path: "graph", message: "必须提供 graph" },
    ]);
  }
  const graph = parseGraph(input.graph);
  const checked = await validateGraphForWrite(ctx, graph);
  if (checked.errors.length > 0) throw shapeToMultiField(checked.errors);
  const id = ctx.deps.ids.next();
  const now = ctx.deps.clock.now();
  try {
    await ctx.deps.db.transaction(async (tx) => {
      await ctx.store.insertRoot(tx, { id, ...normalized, now, actor: ctx.deps.actor });
      await ctx.store.insertDefinition(tx, id, graph, now, ctx.deps.actor);
      await ctx.store.replaceExpertRefs(tx, id, graph);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
    throw error;
  }
  return { id, revision: 1, warnings: checked.warnings };
}

async function updateWorkflow(
  ctx: WorkflowContext,
  id: string,
  revision: number,
  input: UpdateWorkflow,
): Promise<{ id: string; revision: number }> {
  const normalized = normalizeUpdate(input);
  const now = ctx.deps.clock.now();
  try {
    return await ctx.deps.db.transaction(async (tx) => {
      const current = await ctx.store.findRoot(tx, id, true);
      if (current === null) throw new NotFoundError("工作流", id);
      if (current.revision !== revision) throw new RevisionConflictError(current.revision);
      const next = await ctx.store.updateRoot(tx, id, revision, {
        ...normalized,
        now,
        actor: ctx.deps.actor,
      });
      if (next === null) throw new RevisionConflictError(revision);
      return { id, revision: next };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
    throw error;
  }
}

async function deleteWorkflow(
  ctx: WorkflowContext,
  id: string,
  revision: number,
): Promise<void> {
  await ctx.deps.db.transaction(async (tx) => {
    const current = await ctx.store.findRoot(tx, id, true);
    if (current === null) throw new NotFoundError("工作流", id);
    if (current.revision !== revision) throw new RevisionConflictError(current.revision);
    await ctx.store.deleteRoot(tx, id, revision);
  });
}

async function chooseCopyName(store: WorkflowContext["store"], tx: Db, base: string): Promise<string> {
  for (let index = 1; index <= 99; index += 1) {
    const candidate = copyName(base, index);
    if (!(await store.nameExists(tx, candidate))) return candidate;
  }
  throw new NameConflictError(base);
}

async function copyWorkflow(
  ctx: WorkflowContext,
  id: string,
  input: CopyWorkflow,
): Promise<{ id: string; revision: number; warnings: ValidationIssue[] }> {
  const now = ctx.deps.clock.now();
  return ctx.deps.db.transaction(async (tx) => {
    const source = await ctx.store.findRoot(tx, id, true);
    if (source === null) throw new NotFoundError("工作流", id);
    const sourceDefinition = await ctx.store.findDefinition(tx, id);
    if (sourceDefinition === null) throw new NotFoundError("工作流定义", id);
    const graph = parseGraph(sourceDefinition.graph);
    const checked = await validateGraphForWrite(ctx, graph);
    if (checked.errors.length > 0) throw shapeToMultiField(checked.errors);
    const explicitName = input.name;
    if (
      explicitName !== undefined &&
      (typeof explicitName !== "string" || explicitName.trim() === "")
    ) {
      throw new ValidationError("name", "必须是非空字符串");
    }
    const base =
      explicitName === undefined
        ? defaultCopyName(source.name)
        : ensureText(explicitName, "name", 80);
    const name = await chooseCopyName(ctx.store, tx, base);
    const newId = ctx.deps.ids.next();
    await ctx.store.insertRoot(tx, {
      id: newId,
      name,
      type: source.type,
      description: source.description,
      now,
      actor: ctx.deps.actor,
    });
    await ctx.store.insertDefinition(tx, newId, graph, now, ctx.deps.actor);
    await ctx.store.replaceExpertRefs(tx, newId, graph);
    return { id: newId, revision: 1, warnings: checked.warnings };
  });
}

async function saveWorkflowDefinition(
  ctx: WorkflowContext,
  id: string,
  revision: number,
  input: SaveDefinitionInput,
): Promise<{ id: string; revision: number; warnings: ValidationIssue[] }> {
  const graph = parseGraph(input.graph);
  const checked = await validateGraphForWrite(ctx, graph);
  if (checked.errors.length > 0) throw shapeToMultiField(checked.errors);
  const now = ctx.deps.clock.now();
  try {
    return await ctx.deps.db.transaction(async (tx) => {
      const current = await ctx.store.findRoot(tx, id, true);
      if (current === null) throw new NotFoundError("工作流", id);
      if (current.revision !== revision) throw new RevisionConflictError(current.revision);
      await ctx.store.replaceGraph(tx, id, graph, now, ctx.deps.actor);
      await ctx.store.replaceExpertRefs(tx, id, graph);
      const next = await ctx.store.bumpRevision(tx, id, revision, now, ctx.deps.actor);
      if (next === null) throw new RevisionConflictError(revision);
      return { id, revision: next, warnings: checked.warnings };
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new MultiFieldValidationError([
        { code: "expert_missing", path: "graph.nodes", message: "专家不存在" },
      ]);
    }
    throw error;
  }
}

async function validateWorkflow(
  ctx: WorkflowContext,
  input: unknown,
): Promise<{ errors: ValidationIssue[]; warnings: ValidationIssue[] }> {
  const { graph, errors } = collectGraph(input);
  if (errors.length > 0 || graph === null) {
    return { errors, warnings: [] };
  }
  const checked = await validateGraphForWrite(ctx, graph);
  return { errors: checked.errors, warnings: checked.warnings };
}

async function exportWorkflowDsl(ctx: WorkflowContext, id: string): Promise<WorkflowDsl> {
  const { root, graph } = await getRootAndGraph(ctx, id);
  const parsed = parseGraph(graph);
  const expert = await resolveExpertIssues(ctx, parsed);
  const errors = [
    ...analyzeTopology(parsed),
    ...analyzeBindings(parsed).filter((issue) => issue.code === "expert_forbidden"),
    ...expert.missing,
  ];
  if (errors.length > 0) throw shapeToMultiField(errors);
  return {
    dslVersion: 1,
    metadata: { name: root.name, type: root.type, description: root.description },
    stages: parsed.stages,
    nodes: parsed.nodes,
    edges: parsed.edges,
    ...(parsed.viewport === undefined ? {} : { layout: { viewport: parsed.viewport } }),
  };
}

async function importWorkflowDsl(
  ctx: WorkflowContext,
  input: unknown,
): Promise<{
  id: string;
  revision: number;
  idMap: Record<string, string>;
  warnings: ValidationIssue[];
}> {
  const { dsl, graph } = normalizeDsl(input);
  const checked = await validateGraphForImport(ctx, graph);
  if (checked.errors.length > 0) throw shapeToMultiField(checked.errors);
  const resolvedGraph: WorkflowGraph = {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.expertId !== null && checked.missingIds.has(node.expertId)
        ? { ...node, expertId: null }
        : node,
    ),
  };
  const id = ctx.deps.ids.next();
  const now = ctx.deps.clock.now();
  try {
    await ctx.deps.db.transaction(async (tx) => {
      await ctx.store.insertRoot(tx, {
        id,
        name: dsl.metadata.name,
        type: dsl.metadata.type,
        description: dsl.metadata.description,
        now,
        actor: ctx.deps.actor,
      });
      await ctx.store.insertDefinition(tx, id, resolvedGraph, now, ctx.deps.actor);
      await ctx.store.replaceExpertRefs(tx, id, resolvedGraph);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new NameConflictError(dsl.metadata.name);
    if (isForeignKeyViolation(error)) {
      throw new MultiFieldValidationError([
        { code: "expert_missing", path: "graph.nodes", message: "专家不存在" },
      ]);
    }
    throw error;
  }
  return {
    id,
    revision: 1,
    idMap: Object.fromEntries(
      [...graph.stages, ...graph.nodes, ...graph.edges].map((item) => [item.id, item.id]),
    ),
    warnings: checked.warnings,
  };
}
