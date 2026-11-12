import { UnsupportedNodeTypeError, ValidationError } from "../../core/kernel/index.ts";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "../workflow/index.ts";

export function graphOf(snapshot: WorkflowGraph | string): WorkflowGraph {
  return typeof snapshot === "string" ? (JSON.parse(snapshot) as WorkflowGraph) : snapshot;
}

export function startNode(graph: WorkflowGraph): WorkflowNode | null {
  const starts = graph.nodes.filter((node) => node.type === "start");
  return starts.length === 1 ? starts[0]! : null;
}

export function nodeById(graph: WorkflowGraph, id: string): WorkflowNode | null {
  return graph.nodes.find((node) => node.id === id) ?? null;
}

export function seqOut(graph: WorkflowGraph, id: string): WorkflowEdge[] {
  return graph.edges.filter((edge) => edge.kind === "seq" && edge.from === id);
}

export function seqIn(graph: WorkflowGraph, id: string): WorkflowEdge[] {
  return graph.edges.filter((edge) => edge.kind === "seq" && edge.to === id);
}

export function rollbackTarget(graph: WorkflowGraph, id: string): string | null {
  const edges = graph.edges.filter((edge) => edge.kind === "rollback" && edge.from === id);
  if (edges.length !== 1) return null;
  return edges[0]!.to;
}

export function isAncestor(graph: WorkflowGraph, ancestorId: string, nodeId: string): boolean {
  const seen = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of seqIn(graph, current)) {
      if (edge.from === ancestorId) return true;
      if (!seen.has(edge.from)) {
        seen.add(edge.from);
        queue.push(edge.from);
      }
    }
  }
  return false;
}

/** 启动 run 前的可运行性校验：结构、回退边、本期节点类型。专家存在性由调用方校验。 */
export function assertRunnableGraph(graph: WorkflowGraph): void {
  if (graph.nodes.length === 0) throw new ValidationError("graph", "图不能为空");
  const starts = graph.nodes.filter((node) => node.type === "start");
  const ends = graph.nodes.filter((node) => node.type === "end");
  if (starts.length !== 1) throw new ValidationError("graph.nodes", "必须恰好一个 start 节点");
  if (ends.length !== 1) throw new ValidationError("graph.nodes", "必须恰好一个 end 节点");
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const node of graph.nodes) {
    if (node.type === "split" || node.type === "fanout") {
      throw new UnsupportedNodeTypeError(node.id, node.type);
    }
    if (node.expertId === null && node.type !== "confirm") {
      throw new ValidationError(`graph.nodes.${node.id}.expertId`, "执行节点必须绑定专家");
    }
    if (node.expertId !== null && node.type === "confirm") {
      throw new ValidationError(`graph.nodes.${node.id}.expertId`, "confirm 节点不能绑定专家");
    }
  }
  for (const node of graph.nodes) {
    if (seqIn(graph, node.id).length > 1) {
      throw new ValidationError(`graph.nodes.${node.id}`, "节点最多一条 seq 入边");
    }
    if (seqOut(graph, node.id).length > 1) {
      throw new ValidationError(`graph.nodes.${node.id}`, "节点最多一条 seq 出边");
    }
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new ValidationError("graph.edges", "边端点必须存在");
    }
    if (edge.kind === "rollback") {
      const from = nodeById(graph, edge.from);
      if (from === null || (from.type !== "review" && from.type !== "confirm")) {
        throw new ValidationError(`graph.edges.${edge.id}`, "只有 review/confirm 可以发起回退");
      }
      if (!isAncestor(graph, edge.to, edge.from)) {
        throw new ValidationError(`graph.edges.${edge.id}`, "回退目标必须是祖先");
      }
    }
  }
}
