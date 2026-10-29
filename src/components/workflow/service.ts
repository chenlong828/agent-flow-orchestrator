import {
  MultiFieldValidationError,
  NameConflictError,
  NotFoundError,
  RevisionConflictError,
  ValidationError,
  type Clock,
  type ExpertStatusReader,
  type IdGenerator,
  type Page,
} from "../../core/kernel/index.ts";
import {
  isForeignKeyViolation,
  isUniqueViolation,
  type Db,
} from "../../core/platform/index.ts";
import {
  analyzeGraph,
  collectGraph,
  emptyGraph,
  parseGraph,
  type ValidationIssue,
  type WorkflowGraph,
  type WorkflowNode,
} from "./graph.ts";
import { createWorkflowStore } from "./store.ts";
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

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function ensureText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ValidationError(field, "不能为空");
  if (trimmed.length > maxLength) throw new ValidationError(field, `长度不能超过 ${maxLength}`);
  return trimmed;
}

function ensureDescription(value: unknown, field = "description"): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ValidationError(field, "必须是字符串");
  if (value.length > 500) throw new ValidationError(field, "长度不能超过 500");
  return value;
}

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

function nodePath(node: WorkflowNode): string {
  return `graph.nodes.${node.id}.expertId`;
}

function expertWarning(code: string, node: WorkflowNode, message: string): ValidationIssue {
  return { code, path: nodePath(node), message };
}

function shapeToMultiField(errors: ValidationIssue[]): MultiFieldValidationError {
  return new MultiFieldValidationError(
    errors.map((issue) => ({ field: issue.path, reason: `${issue.code}: ${issue.message}` })),
  );
}

function normalizeDsl(input: unknown): { dsl: WorkflowDsl; graph: WorkflowGraph } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("body", "必须是对象");
  }
  const body = input as Record<string, unknown>;
  const allowed = ["dslVersion", "metadata", "stages", "nodes", "edges", "layout"];
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new ValidationError("body", `未知字段 ${unknown.join(", ")}`);
  if (body.dslVersion !== 1) throw new ValidationError("dslVersion", "必须是 1");
  const metadata = body.metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ValidationError("metadata", "必须是对象");
  }
  const meta = metadata as Record<string, unknown>;
  const metaUnknown = Object.keys(meta).filter(
    (key) => !["name", "type", "description"].includes(key),
  );
  if (metaUnknown.length > 0) {
    throw new ValidationError("metadata", `未知字段 ${metaUnknown.join(", ")}`);
  }
  const name = ensureText(meta.name, "metadata.name", 80);
  const type = ensureText(meta.type, "metadata.type", 40);
  const description = ensureDescription(meta.description, "metadata.description");

  const { graph, errors } = collectGraph({
    stages: body.stages,
    nodes: body.nodes,
    edges: body.edges,
  });
  if (errors.length > 0 || graph === null) throw shapeToMultiField(errors);

  let layout: WorkflowDsl["layout"];
  if (body.layout !== undefined) {
    if (body.layout === null || typeof body.layout !== "object" || Array.isArray(body.layout)) {
      throw new ValidationError("layout", "必须是对象");
    }
    const raw = body.layout as Record<string, unknown>;
    const layoutUnknown = Object.keys(raw).filter((key) => key !== "viewport");
    if (layoutUnknown.length > 0) {
      throw new ValidationError("layout", `未知字段 ${layoutUnknown.join(", ")}`);
    }
    if (raw.viewport !== undefined) {
      const viewport = raw.viewport;
      if (viewport === null || typeof viewport !== "object" || Array.isArray(viewport)) {
        throw new ValidationError("layout.viewport", "必须是对象");
      }
      const vp = viewport as Record<string, unknown>;
      const vpUnknown = Object.keys(vp).filter((key) => !["x", "y", "zoom"].includes(key));
      if (vpUnknown.length > 0) {
        throw new ValidationError("layout.viewport", `未知字段 ${vpUnknown.join(", ")}`);
      }
      if (
        typeof vp.x !== "number" ||
        !Number.isFinite(vp.x) ||
        typeof vp.y !== "number" ||
        !Number.isFinite(vp.y) ||
        typeof vp.zoom !== "number" ||
        !Number.isFinite(vp.zoom)
      ) {
        throw new ValidationError("layout.viewport", "x/y/zoom 必须是有限数字");
      }
      layout = { viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } };
    }
  }

  return {
    dsl: {
      dslVersion: 1,
      metadata: { name, type, description },
      stages: graph.stages,
      nodes: graph.nodes,
      edges: graph.edges,
      ...(layout === undefined ? {} : { layout }),
    },
    graph,
  };
}

function toSummary(row: {
  id: string;
  name: string;
  type: string;
  description: string;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
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
  };
}

function toDetail(row: Parameters<typeof toSummary>[0], graph: WorkflowGraph): WorkflowDetail {
  return { ...toSummary(row), graph };
}

export function createWorkflowService(deps: WorkflowDeps): WorkflowService {
  const { db, clock, ids, actor, expertStatus } = deps;
  const store = createWorkflowStore(db);

  async function getRootAndGraph(id: string): Promise<{
    root: NonNullable<Awaited<ReturnType<typeof store.findRoot>>>;
    graph: WorkflowGraph;
  }> {
    const root = await store.findRoot(db, id);
    if (root === null) throw new NotFoundError("工作流", id);
    const definition = await store.findDefinition(db, id);
    if (definition === null) throw new NotFoundError("工作流定义", id);
    return { root, graph: definition.graph };
  }

  async function resolveExpertWarnings(
    graph: WorkflowGraph,
  ): Promise<{ warnings: ValidationIssue[]; missing: string[] }> {
    const idsInGraph = expertIds(graph);
    const byId = new Map(Object.entries(await expertStatus.statuses(idsInGraph)));
    const warnings: ValidationIssue[] = [];
    const missing: string[] = [];
    for (const node of graph.nodes) {
      if (node.expertId === null) continue;
      const enabled = byId.get(node.expertId);
      if (enabled === undefined) {
        missing.push(node.expertId);
        warnings.push(expertWarning("expert_missing", node, "专家不存在"));
      } else if (!enabled) {
        warnings.push(expertWarning("expert_disabled", node, "专家已停用"));
      }
    }
    return { warnings, missing };
  }

  async function validateGraphWithDb(graph: WorkflowGraph): Promise<ValidationIssue[]> {
    const semantic = analyzeGraph(graph);
    const expert = await resolveExpertWarnings(graph);
    return [...semantic.warnings, ...expert.warnings];
  }

  return {
    async create(input) {
      const normalized = normalizeCreate(input);
      const id = ids.next();
      const now = clock.now();
      try {
        await db.transaction(async (tx) => {
          await store.insertRoot(tx, { id, ...normalized, now, actor });
          await store.insertDefinition(tx, id, emptyGraph(), now, actor);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
        throw error;
      }
      return { id, revision: 1 };
    },

    async update(id, revision, input) {
      const normalized = normalizeUpdate(input);
      const now = clock.now();
      try {
        return await db.transaction(async (tx) => {
          const current = await store.findRoot(tx, id, true);
          if (current === null) throw new NotFoundError("工作流", id);
          if (current.revision !== revision) throw new RevisionConflictError(current.revision);
          const next = await store.updateRoot(tx, id, revision, { ...normalized, now, actor });
          if (next === null) throw new RevisionConflictError(revision);
          return { id, revision: next };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(normalized.name);
        throw error;
      }
    },

    async delete(id, revision) {
      await db.transaction(async (tx) => {
        const current = await store.findRoot(tx, id, true);
        if (current === null) throw new NotFoundError("工作流", id);
        if (current.revision !== revision) throw new RevisionConflictError(current.revision);
        await store.deleteRoot(tx, id, revision);
      });
    },

    async copy(id, input: CopyWorkflow) {
      const now = clock.now();
      return db.transaction(async (tx) => {
        const source = await store.findRoot(tx, id, true);
        if (source === null) throw new NotFoundError("工作流", id);
        const sourceDefinition = await store.findDefinition(tx, id);
        if (sourceDefinition === null) throw new NotFoundError("工作流定义", id);
        const explicitName = input.name;
        if (explicitName !== undefined && (typeof explicitName !== "string" || explicitName.trim() === "")) {
          throw new ValidationError("name", "必须是非空字符串");
        }
        const base = explicitName === undefined
          ? defaultCopyName(source.name)
          : ensureText(explicitName, "name", 80);
        let name: string | null = null;
        for (let index = 1; index <= 99; index += 1) {
          const candidate = copyName(base, index);
          if (!(await store.nameExists(tx, candidate))) {
            name = candidate;
            break;
          }
        }
        if (name === null) throw new NameConflictError(base);
        const newId = ids.next();
        await store.insertRoot(tx, {
          id: newId,
          name,
          type: source.type,
          description: source.description,
          now,
          actor,
        });
        await store.insertDefinition(tx, newId, sourceDefinition.graph, now, actor);
        await store.replaceExpertRefs(tx, newId, sourceDefinition.graph);
        return { id: newId, revision: 1 };
      });
    },

    async saveDefinition(id, revision, input: SaveDefinitionInput) {
      const graph = parseGraph(input.graph);
      const semantic = analyzeGraph(graph);
      const now = clock.now();
      let warnings: ValidationIssue[] = [];
      try {
        return await db.transaction(async (tx) => {
          const current = await store.findRoot(tx, id, true);
          if (current === null) throw new NotFoundError("工作流", id);
          if (current.revision !== revision) throw new RevisionConflictError(current.revision);
          const expert = await resolveExpertWarnings(graph);
          if (expert.missing.length > 0) {
            const paths = graph.nodes
              .filter((node) => node.expertId !== null && expert.missing.includes(node.expertId))
              .map((node) => ({
                field: nodePath(node),
                reason: "validation_error: 专家不存在",
              }));
            throw new MultiFieldValidationError(paths);
          }
          warnings = [...semantic.warnings, ...expert.warnings];
          await store.replaceGraph(tx, id, graph, now, actor);
          await store.replaceExpertRefs(tx, id, graph);
          const next = await store.bumpRevision(tx, id, revision, now, actor);
          if (next === null) throw new RevisionConflictError(revision);
          return { id, revision: next, warnings };
        });
      } catch (error) {
        if (isForeignKeyViolation(error)) {
          throw new MultiFieldValidationError([
            { field: "graph.nodes.expertId", reason: "validation_error: 专家不存在" },
          ]);
        }
        throw error;
      }
    },

    async validate(input) {
      const { graph, errors } = collectGraph(input);
      if (errors.length > 0 || graph === null) {
        return { errors, warnings: [] };
      }
      return { errors: [], warnings: await validateGraphWithDb(graph) };
    },

    async exportDsl(id) {
      const { root, graph } = await getRootAndGraph(id);
      return {
        dslVersion: 1,
        metadata: { name: root.name, type: root.type, description: root.description },
        stages: graph.stages,
        nodes: graph.nodes,
        edges: graph.edges,
      };
    },

    async importDsl(input) {
      const { dsl, graph } = normalizeDsl(input);
      const semantic = analyzeGraph(graph);
      if (semantic.warnings.length > 0) throw shapeToMultiField(semantic.warnings);
      const expert = await resolveExpertWarnings(graph);
      const missing = new Set(expert.missing);
      const resolvedGraph: WorkflowGraph = {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.expertId !== null && missing.has(node.expertId)
            ? { ...node, expertId: null }
            : node,
        ),
      };
      const warnings = expert.warnings;
      const id = ids.next();
      const now = clock.now();
      try {
        await db.transaction(async (tx) => {
          await store.insertRoot(tx, {
            id,
            name: dsl.metadata.name,
            type: dsl.metadata.type,
            description: dsl.metadata.description,
            now,
            actor,
          });
          await store.insertDefinition(tx, id, resolvedGraph, now, actor);
          await store.replaceExpertRefs(tx, id, resolvedGraph);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new NameConflictError(dsl.metadata.name);
        if (isForeignKeyViolation(error)) {
          throw new MultiFieldValidationError([
            { field: "graph.nodes.expertId", reason: "validation_error: 专家不存在" },
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
        warnings,
      };
    },
  };
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
