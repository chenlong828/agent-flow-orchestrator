import { MultiFieldValidationError } from "../../core/kernel/index.ts";

export type NodeType = "start" | "end" | "agent" | "review" | "confirm" | "fanout" | "fanin";
export type EdgeKind = "seq" | "rollback";

export type JsonObject = Record<string, unknown>;

/** 画布布局由前端 DSL 定义；后端只按 JSON 对象透传。 */
export type Layout = JsonObject;

/** 画布视口由前端 DSL 定义；后端只按 JSON 对象透传。 */
export type Viewport = JsonObject;

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

export type ValidationReport = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

import { addIssue, unknownFields, type ValidationIssue } from "./graph-issues.ts";
export type { ValidationIssue };

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

function parseObjectField(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    errors.push({ code: "invalid_layout", path, message: "必须是对象" });
    return undefined;
  }
  return value;
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
  const viewport = parseObjectField(input.viewport, "graph.viewport", errors);

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
  checkArraySize(rawStages, "stages", "个", MAX_STAGES, errors);
  checkArraySize(rawNodes, "nodes", "个", MAX_NODES, errors);
  checkArraySize(rawEdges, "edges", "条", MAX_EDGES, errors);

  const { stages, stageIds } = collectStages(rawStages, errors);
  const { nodes, nodeIds } = collectNodes(rawNodes, stageIds, errors);
  const { edges } = collectEdges(rawEdges, nodeIds, errors);

  if (errors.length > 0) return { graph: null, errors };
  return {
    graph: { stages, nodes, edges, ...(viewport === undefined ? {} : { viewport }) },
    errors,
  };
}

function checkArraySize(
  values: unknown[],
  field: string,
  unit: string,
  max: number,
  errors: ValidationIssue[],
): void {
  if (values.length > max) {
    errors.push({
      code: "graph_too_large",
      path: `graph.${field}`,
      message: `不能超过 ${max} ${unit}`,
    });
  }
}

function collectStages(
  rawStages: unknown[],
  errors: ValidationIssue[],
): { stages: Stage[]; stageIds: Set<string> } {
  const stageIds = new Set<string>();
  const stages: Stage[] = [];
  rawStages.forEach((raw, index) => {
    const stage = parseStage(raw, index, stageIds, errors);
    if (stage !== null) stages.push(stage);
  });
  return { stages, stageIds };
}

function parseStage(
  raw: unknown,
  index: number,
  stageIds: Set<string>,
  errors: ValidationIssue[],
): Stage | null {
  const path = `graph.stages[${index}]`;
  if (!isObject(raw)) {
    errors.push({ code: "graph_shape", path, message: "必须是对象" });
    return null;
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
  const layout = parseObjectField(raw.layout, `${path}.layout`, errors);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    ...(description === undefined ? {} : { description }),
    ...(layout === undefined ? {} : { layout }),
  };
}

function collectNodes(
  rawNodes: unknown[],
  stageIds: Set<string>,
  errors: ValidationIssue[],
): { nodes: WorkflowNode[]; nodeIds: Set<string> } {
  const nodeIds = new Set<string>();
  const nodes: WorkflowNode[] = [];
  rawNodes.forEach((raw, index) => {
    const node = parseNode(raw, index, stageIds, nodeIds, errors);
    if (node !== null) nodes.push(node);
  });
  return { nodes, nodeIds };
}

function parseNode(
  raw: unknown,
  index: number,
  stageIds: Set<string>,
  nodeIds: Set<string>,
  errors: ValidationIssue[],
): WorkflowNode | null {
  const path = `graph.nodes[${index}]`;
  if (!isObject(raw)) {
    errors.push({ code: "graph_shape", path, message: "必须是对象" });
    return null;
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
  const nodeType = parseNodeType(raw.type, `${path}.type`, errors);
  const stageId = parseStageId(raw.stageId, stageIds, `${path}.stageId`, errors);
  const expertId = parseExpertId(raw.expertId, `${path}.expertId`, errors);
  const layout = parseObjectField(raw.layout, `${path}.layout`, errors);
  if (id === null || name === null || nodeType === null) return null;
  return {
    id,
    type: nodeType,
    name,
    stageId,
    expertId,
    ...(layout === undefined ? {} : { layout }),
  };
}

function parseNodeType(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): NodeType | null {
  if (typeof value === "string" && NODE_TYPES.includes(value as NodeType)) {
    return value as NodeType;
  }
  errors.push({
    code: "invalid_node_type",
    path,
    message: `必须是 ${NODE_TYPES.join(" / ")} 之一`,
  });
  return null;
}

function parseStageId(
  value: unknown,
  stageIds: Set<string>,
  path: string,
  errors: ValidationIssue[],
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    errors.push({ code: "graph_shape", path, message: "必须是字符串或 null" });
    return null;
  }
  if (!stageIds.has(value)) {
    errors.push({ code: "missing_stage", path, message: `阶段 ${value} 不存在` });
    return null;
  }
  return value;
}

function parseExpertId(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    errors.push({ code: "invalid_expert_id", path, message: "必须是 UUID 或 null" });
    return null;
  }
  return value;
}

function collectEdges(
  rawEdges: unknown[],
  nodeIds: Set<string>,
  errors: ValidationIssue[],
): { edges: WorkflowEdge[]; edgeIds: Set<string> } {
  const edgeIds = new Set<string>();
  const edges: WorkflowEdge[] = [];
  rawEdges.forEach((raw, index) => {
    const edge = parseEdge(raw, index, nodeIds, edgeIds, errors);
    if (edge !== null) edges.push(edge);
  });
  return { edges, edgeIds };
}

function parseEdge(
  raw: unknown,
  index: number,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
  errors: ValidationIssue[],
): WorkflowEdge | null {
  const path = `graph.edges[${index}]`;
  if (!isObject(raw)) {
    errors.push({ code: "graph_shape", path, message: "必须是对象" });
    return null;
  }
  unknownFields(raw, ["id", "from", "to", "kind"], path, errors);
  const id = parseId(raw.id, `${path}.id`, errors);
  if (id !== null) {
    if (edgeIds.has(id)) {
      errors.push({ code: "duplicate_id", path: `${path}.id`, message: `边 ID ${id} 重复` });
    }
    edgeIds.add(id);
  }
  const from = parseEndpoint(raw.from, nodeIds, `${path}.from`, "起点节点不存在", errors);
  const to = parseEndpoint(raw.to, nodeIds, `${path}.to`, "终点节点不存在", errors);
  if (from !== null && to !== null && from === to) {
    errors.push({ code: "self_edge", path: `${path}.to`, message: "起点与终点不能相同" });
  }
  const kind = parseEdgeKind(raw.kind, `${path}.kind`, errors);
  if (id === null || from === null || to === null || kind === null) return null;
  return { id, from, to, kind };
}

function parseEndpoint(
  value: unknown,
  nodeIds: Set<string>,
  path: string,
  message: string,
  errors: ValidationIssue[],
): string | null {
  if (typeof value === "string" && nodeIds.has(value)) return value;
  errors.push({ code: "missing_endpoint", path, message });
  return null;
}

function parseEdgeKind(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
): EdgeKind | null {
  if (typeof value === "string" && EDGE_KINDS.includes(value as EdgeKind)) {
    return value as EdgeKind;
  }
  errors.push({ code: "invalid_edge_kind", path, message: "必须是 seq 或 rollback" });
  return null;
}

export function parseGraph(input: unknown): WorkflowGraph {
  const { graph, errors } = collectGraph(input);
  if (errors.length > 0 || graph === null) {
    throw new MultiFieldValidationError(errors);
  }
  return graph;
}
