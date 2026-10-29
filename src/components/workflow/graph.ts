import { MultiFieldValidationError } from "../../core/kernel/index.ts";

export type NodeType = "start" | "end" | "agent" | "review" | "confirm" | "fanout" | "fanin";
export type EdgeKind = "seq" | "rollback";

export type Layout = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export type Stage = {
  id: string;
  name: string;
  description?: string;
  layout?: Layout;
};

export type WorkflowNode = {
  id: string;
  type: NodeType;
  name: string;
  stageId: string | null;
  expertId: string | null;
  layout?: Layout;
};

export type WorkflowEdge = {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
};

export type WorkflowGraph = {
  stages: Stage[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: Viewport;
};

export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type ValidationReport = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export const EMPTY_GRAPH: WorkflowGraph = { stages: [], nodes: [], edges: [] };

const NODE_TYPES: readonly NodeType[] = [
  "start",
  "end",
  "agent",
  "review",
  "confirm",
  "fanout",
  "fanin",
];
const EDGE_KINDS: readonly EdgeKind[] = ["seq", "rollback"];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_STAGES = 100;
const MAX_NODES = 500;
const MAX_EDGES = 1000;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push({ code: "graph_shape", path: `${path}.${key}`, message: "未知字段" });
    }
  }
}

function nonEmptyString(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
  maxLength = 80,
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ code: "graph_shape", path, message: "必须是非空字符串" });
    return null;
  }
  if (value.trim().length > maxLength) {
    errors.push({ code: "graph_shape", path, message: `长度不能超过 ${maxLength}` });
    return null;
  }
  return value.trim();
}

function optionalString(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    errors.push({ code: "graph_shape", path, message: "必须是字符串" });
    return undefined;
  }
  if (value.length > maxLength) {
    errors.push({ code: "graph_shape", path, message: `长度不能超过 ${maxLength}` });
    return undefined;
  }
  return value;
}

function parseLayout(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): Layout | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    errors.push({ code: "invalid_layout", path, message: "必须是对象" });
    return undefined;
  }
  unknownFields(value, ["x", "y", "width", "height"], path, errors);
  const numberFields: (keyof Layout)[] = ["x", "y", "width", "height"];
  const result: Partial<Layout> = {};
  for (const field of numberFields) {
    const raw = value[field];
    if (raw === undefined) {
      if (field === "x" || field === "y") {
        errors.push({ code: "invalid_layout", path: `${path}.${field}`, message: "必须是有限数字" });
      }
      continue;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push({ code: "invalid_layout", path: `${path}.${field}`, message: "必须是有限数字" });
      continue;
    }
    result[field] = raw;
  }
  if (result.x === undefined || result.y === undefined) return undefined;
  return result as Layout;
}

function parseViewport(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): Viewport | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    errors.push({ code: "invalid_layout", path, message: "必须是对象" });
    return undefined;
  }
  unknownFields(value, ["x", "y", "zoom"], path, errors);
  const x = value.x;
  const y = value.y;
  const zoom = value.zoom;
  let valid = true;
  for (const [field, raw] of [
    ["x", x],
    ["y", y],
  ] as const) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push({
        code: "invalid_layout",
        path: `${path}.${field}`,
        message: "必须是有限数字",
      });
      valid = false;
    }
  }
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) {
    errors.push({
      code: "invalid_layout",
      path: `${path}.zoom`,
      message: "必须是有限数字",
    });
    valid = false;
  } else if (zoom <= 0) {
    errors.push({
      code: "invalid_layout",
      path: `${path}.zoom`,
      message: "必须大于 0",
    });
    valid = false;
  }
  if (!valid) return undefined;
  return { x: x as number, y: y as number, zoom: zoom as number };
}

function parseId(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): string | null {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    errors.push({
      code: "invalid_id",
      path,
      message: "必须是 1–64 位字母、数字、下划线或连字符，且以字母/数字开头",
    });
    return null;
  }
  return value;
}

/**
 * 收集图形状错误。形状合法时返回可直接落库/校验的图。
 * 不抛异常，便于 validate 端点同时返回形状与语义结果。
 */
export function collectGraph(input: unknown): {
  graph: WorkflowGraph | null;
  errors: ValidationIssue[];
} {
  const errors: ValidationIssue[] = [];
  if (!isObject(input)) {
    return {
      graph: null,
      errors: [{ code: "graph_shape", path: "graph", message: "必须是对象" }],
    };
  }
  unknownFields(input, ["stages", "nodes", "edges", "viewport"], "graph", errors);
  const viewport = parseViewport(input.viewport, "graph.viewport", errors);

  const rawStages = input.stages;
  const rawNodes = input.nodes;
  const rawEdges = input.edges;
  if (!Array.isArray(rawStages)) {
    errors.push({ code: "graph_shape", path: "graph.stages", message: "必须是数组" });
  }
  if (!Array.isArray(rawNodes)) {
    errors.push({ code: "graph_shape", path: "graph.nodes", message: "必须是数组" });
  }
  if (!Array.isArray(rawEdges)) {
    errors.push({ code: "graph_shape", path: "graph.edges", message: "必须是数组" });
  }
  if (!Array.isArray(rawStages) || !Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
    return { graph: null, errors };
  }
  if (rawStages.length > MAX_STAGES) {
    errors.push({ code: "graph_too_large", path: "graph.stages", message: `不能超过 ${MAX_STAGES} 个` });
  }
  if (rawNodes.length > MAX_NODES) {
    errors.push({ code: "graph_too_large", path: "graph.nodes", message: `不能超过 ${MAX_NODES} 个` });
  }
  if (rawEdges.length > MAX_EDGES) {
    errors.push({ code: "graph_too_large", path: "graph.edges", message: `不能超过 ${MAX_EDGES} 条` });
  }

  const stageIds = new Set<string>();
  const stages: Stage[] = [];
  rawStages.forEach((raw, index) => {
    const path = `graph.stages[${index}]`;
    if (!isObject(raw)) {
      errors.push({ code: "graph_shape", path, message: "必须是对象" });
      return;
    }
    unknownFields(raw, ["id", "name", "description", "layout"], path, errors);
    const id = parseId(raw.id, `${path}.id`, errors);
    if (id !== null) {
      if (stageIds.has(id)) {
        errors.push({ code: "duplicate_id", path: `${path}.id`, message: `阶段 ID ${id} 重复` });
      }
      stageIds.add(id);
    }
    const name = nonEmptyString(raw.name, `${path}.name`, errors);
    const description = optionalString(raw.description, `${path}.description`, errors, 500);
    const layout = parseLayout(raw.layout, `${path}.layout`, errors);
    if (id !== null && name !== null) {
      stages.push({ id, name, ...(description === undefined ? {} : { description }), ...(layout === undefined ? {} : { layout }) });
    }
  });

  const nodeIds = new Set<string>();
  const nodes: WorkflowNode[] = [];
  rawNodes.forEach((raw, index) => {
    const path = `graph.nodes[${index}]`;
    if (!isObject(raw)) {
      errors.push({ code: "graph_shape", path, message: "必须是对象" });
      return;
    }
    unknownFields(raw, ["id", "type", "name", "stageId", "expertId", "layout"], path, errors);
    const id = parseId(raw.id, `${path}.id`, errors);
    if (id !== null) {
      if (nodeIds.has(id)) {
        errors.push({ code: "duplicate_id", path: `${path}.id`, message: `节点 ID ${id} 重复` });
      }
      nodeIds.add(id);
    }
    const name = nonEmptyString(raw.name, `${path}.name`, errors);
    const type = raw.type;
    if (typeof type !== "string" || !NODE_TYPES.includes(type as NodeType)) {
      errors.push({
        code: "invalid_node_type",
        path: `${path}.type`,
        message: `必须是 ${NODE_TYPES.join(" / ")} 之一`,
      });
    }
    let stageId: string | null = null;
    if (raw.stageId !== undefined && raw.stageId !== null) {
      if (typeof raw.stageId !== "string") {
        errors.push({ code: "graph_shape", path: `${path}.stageId`, message: "必须是字符串或 null" });
      } else if (!stageIds.has(raw.stageId)) {
        errors.push({ code: "missing_stage", path: `${path}.stageId`, message: `阶段 ${raw.stageId} 不存在` });
      } else {
        stageId = raw.stageId;
      }
    }
    let expertId: string | null = null;
    if (raw.expertId !== undefined && raw.expertId !== null) {
      if (typeof raw.expertId !== "string" || !UUID_PATTERN.test(raw.expertId)) {
        errors.push({ code: "invalid_expert_id", path: `${path}.expertId`, message: "必须是 UUID 或 null" });
      } else {
        expertId = raw.expertId;
      }
    }
    const layout = parseLayout(raw.layout, `${path}.layout`, errors);
    if (
      id !== null &&
      name !== null &&
      typeof type === "string" &&
      NODE_TYPES.includes(type as NodeType)
    ) {
      nodes.push({
        id,
        type: type as NodeType,
        name,
        stageId,
        expertId,
        ...(layout === undefined ? {} : { layout }),
      });
    }
  });

  const edgeIds = new Set<string>();
  const edges: WorkflowEdge[] = [];
  rawEdges.forEach((raw, index) => {
    const path = `graph.edges[${index}]`;
    if (!isObject(raw)) {
      errors.push({ code: "graph_shape", path, message: "必须是对象" });
      return;
    }
    unknownFields(raw, ["id", "from", "to", "kind"], path, errors);
    const id = parseId(raw.id, `${path}.id`, errors);
    if (id !== null) {
      if (edgeIds.has(id)) {
        errors.push({ code: "duplicate_id", path: `${path}.id`, message: `边 ID ${id} 重复` });
      }
      edgeIds.add(id);
    }
    const from = typeof raw.from === "string" && nodeIds.has(raw.from) ? raw.from : null;
    if (from === null) {
      errors.push({ code: "missing_endpoint", path: `${path}.from`, message: "起点节点不存在" });
    }
    const to = typeof raw.to === "string" && nodeIds.has(raw.to) ? raw.to : null;
    if (to === null) {
      errors.push({ code: "missing_endpoint", path: `${path}.to`, message: "终点节点不存在" });
    }
    if (from !== null && to !== null && from === to) {
      errors.push({ code: "self_edge", path: `${path}.to`, message: "起点与终点不能相同" });
    }
    const kind = raw.kind;
    if (typeof kind !== "string" || !EDGE_KINDS.includes(kind as EdgeKind)) {
      errors.push({ code: "invalid_edge_kind", path: `${path}.kind`, message: "必须是 seq 或 rollback" });
    }
    if (id !== null && from !== null && to !== null && typeof kind === "string" && EDGE_KINDS.includes(kind as EdgeKind)) {
      edges.push({ id, from, to, kind: kind as EdgeKind });
    }
  });

  if (errors.length > 0) return { graph: null, errors };
  return {
    graph: { stages, nodes, edges, ...(viewport === undefined ? {} : { viewport }) },
    errors,
  };
}

export function parseGraph(input: unknown): WorkflowGraph {
  const { graph, errors } = collectGraph(input);
  if (errors.length > 0 || graph === null) {
    throw new MultiFieldValidationError(
      errors.map((issue) => ({ field: issue.path, reason: `${issue.code}: ${issue.message}` })),
    );
  }
  return graph;
}

function addWarning(
  warnings: ValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  warnings.push({ code, path, message });
}

/**
 * 语义检查：保存时返回 warnings；导入时由调用方把非专家 warning 当成错误。
 */
export function analyzeGraph(graph: WorkflowGraph): ValidationReport {
  const warnings: ValidationIssue[] = [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const starts = graph.nodes.filter((node) => node.type === "start");
  const ends = graph.nodes.filter((node) => node.type === "end");
  if (starts.length === 0) addWarning(warnings, "missing_start", "graph.nodes", "缺少开始节点");
  if (starts.length > 1) addWarning(warnings, "multiple_start", "graph.nodes", "开始节点必须恰好一个");
  if (ends.length === 0) addWarning(warnings, "missing_end", "graph.nodes", "缺少结束节点");
  if (ends.length > 1) addWarning(warnings, "multiple_end", "graph.nodes", "结束节点必须恰好一个");

  const seqIn = new Map<string, WorkflowEdge[]>();
  const seqOut = new Map<string, WorkflowEdge[]>();
  const rollbackOut = new Map<string, WorkflowEdge[]>();
  for (const node of graph.nodes) {
    seqIn.set(node.id, []);
    seqOut.set(node.id, []);
    rollbackOut.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (edge.kind === "seq") {
      seqIn.get(edge.to)?.push(edge);
      seqOut.get(edge.from)?.push(edge);
    } else {
      rollbackOut.get(edge.from)?.push(edge);
    }
  }

  const start = starts.length === 1 ? starts[0] : undefined;
  const end = ends.length === 1 ? ends[0] : undefined;
  if (start !== undefined && (seqIn.get(start.id)?.length ?? 0) > 0) {
    addWarning(warnings, "start_has_incoming", `graph.nodes.${start.id}`, "开始节点不能有入边");
  }
  if (end !== undefined && (seqOut.get(end.id)?.length ?? 0) > 0) {
    addWarning(warnings, "end_has_outgoing", `graph.nodes.${end.id}`, "结束节点不能有出边");
  }

  for (const node of graph.nodes) {
    if ((seqIn.get(node.id)?.length ?? 0) > 1) {
      addWarning(warnings, "broken_chain", `graph.nodes.${node.id}`, "节点最多一条 seq 入边");
    }
    if ((seqOut.get(node.id)?.length ?? 0) > 1) {
      addWarning(warnings, "broken_chain", `graph.nodes.${node.id}`, "节点最多一条 seq 出边");
    }
    if (start !== undefined && node.id !== start.id && (seqIn.get(node.id)?.length ?? 0) === 0) {
      addWarning(warnings, "broken_chain", `graph.nodes.${node.id}`, "非开始节点必须有一条 seq 入边");
    }
    if (end !== undefined && node.id !== end.id && (seqOut.get(node.id)?.length ?? 0) === 0) {
      addWarning(warnings, "broken_chain", `graph.nodes.${node.id}`, "非结束节点必须有一条 seq 出边");
    }
  }

  if (start !== undefined) {
    const reachable = new Set<string>();
    const queue = [start.id];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || reachable.has(current)) continue;
      reachable.add(current);
      for (const edge of seqOut.get(current) ?? []) {
        if (!reachable.has(edge.to)) queue.push(edge.to);
      }
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        addWarning(warnings, "broken_chain", `graph.nodes.${node.id}`, "节点从开始节点不可达");
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function hasCycle(nodeId: string): boolean {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const edge of seqOut.get(nodeId) ?? []) {
      if (hasCycle(edge.to)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  }
  if (graph.nodes.some((node) => hasCycle(node.id))) {
    addWarning(warnings, "seq_cycle", "graph.edges", "seq 子图存在环");
  }

  for (const node of graph.nodes) {
    const rollbacks = rollbackOut.get(node.id) ?? [];
    if (rollbacks.length === 0) continue;
    if (node.type !== "review" && node.type !== "confirm") {
      addWarning(warnings, "invalid_rollback", `graph.nodes.${node.id}`, "只有 review/confirm 可以发起回退");
    }
    if (rollbacks.length > 1) {
      addWarning(warnings, "invalid_rollback", `graph.nodes.${node.id}`, "每个节点最多一条回退边");
    }
    const ancestors = new Set<string>();
    const queue = [node.id];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) continue;
      for (const edge of seqIn.get(current) ?? []) {
        if (!ancestors.has(edge.from)) {
          ancestors.add(edge.from);
          queue.push(edge.from);
        }
      }
    }
    for (const edge of rollbacks) {
      const target = nodes.get(edge.to);
      if (target === undefined) {
        addWarning(warnings, "invalid_rollback", `graph.edges.${edge.id}.to`, "回退目标不存在");
      } else if (target.type === "end") {
        addWarning(warnings, "invalid_rollback", `graph.edges.${edge.id}.to`, "不能回退到结束节点");
      } else if (!ancestors.has(target.id)) {
        addWarning(warnings, "rollback_target_not_ancestor", `graph.edges.${edge.id}.to`, "回退目标不是 seq 路径上的祖先");
      }
    }
  }

  for (const node of graph.nodes) {
    if (node.type === "fanout") {
      const out = seqOut.get(node.id) ?? [];
      if (out.length !== 1 || nodes.get(out[0]?.to ?? "")?.type !== "fanin") {
        addWarning(warnings, "fanout_fanin_unpaired", `graph.nodes.${node.id}`, "fanout 必须唯一指向一个 fanin");
      }
    }
    if (node.type === "fanin") {
      const incoming = seqIn.get(node.id) ?? [];
      if (incoming.length !== 1 || nodes.get(incoming[0]?.from ?? "")?.type !== "fanout") {
        addWarning(warnings, "fanout_fanin_unpaired", `graph.nodes.${node.id}`, "fanin 必须唯一来自一个 fanout");
      }
    }
  }

  for (const node of graph.nodes) {
    const requiresExpert =
      node.type === "start" ||
      node.type === "end" ||
      node.type === "agent" ||
      node.type === "review" ||
      node.type === "fanout" ||
      node.type === "fanin";
    if (requiresExpert && node.expertId === null) {
      addWarning(warnings, "expert_required", `graph.nodes.${node.id}.expertId`, `${node.type} 节点必须绑定专家`);
    }
    if (node.type === "confirm" && node.expertId !== null) {
      addWarning(warnings, "expert_forbidden", `graph.nodes.${node.id}.expertId`, "confirm 节点不能绑定专家");
    }
  }

  return { errors: [], warnings };
}

export function emptyGraph(): WorkflowGraph {
  return { stages: [], nodes: [], edges: [] };
}
