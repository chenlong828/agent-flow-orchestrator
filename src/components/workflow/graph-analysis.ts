import { addIssue, type ValidationIssue } from "./graph-issues.ts";
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from "./graph.ts";

type TopologyIndex = {
  graph: WorkflowGraph;
  nodes: Map<string, WorkflowNode>;
  starts: WorkflowNode[];
  ends: WorkflowNode[];
  start: WorkflowNode | undefined;
  end: WorkflowNode | undefined;
  seqIn: Map<string, WorkflowEdge[]>;
  seqOut: Map<string, WorkflowEdge[]>;
  rollbackOut: Map<string, WorkflowEdge[]>;
  nodePath: (id: string) => string;
  edgePath: (id: string) => string;
};

function buildTopologyIndex(graph: WorkflowGraph): TopologyIndex {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeIndex = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const edgeIndex = new Map(graph.edges.map((edge, index) => [edge.id, index]));
  const starts = graph.nodes.filter((node) => node.type === "start");
  const ends = graph.nodes.filter((node) => node.type === "end");
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
  return {
    graph,
    nodes,
    starts,
    ends,
    start: starts.length === 1 ? starts[0] : undefined,
    end: ends.length === 1 ? ends[0] : undefined,
    seqIn,
    seqOut,
    rollbackOut,
    nodePath: (id) => {
      const index = nodeIndex.get(id);
      return index === undefined ? "graph.nodes" : `graph.nodes[${index}]`;
    },
    edgePath: (id) => {
      const index = edgeIndex.get(id);
      return index === undefined ? "graph.edges" : `graph.edges[${index}]`;
    },
  };
}

/** 拓扑检查：start/end、seq 链、可达、环、fanout/fanin 与回退。 */
export function analyzeTopology(graph: WorkflowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const index = buildTopologyIndex(graph);
  checkEndpoints(index, issues);
  checkEndpointEdges(index, issues);
  checkChain(index, issues);
  checkReachability(index, issues);
  checkCycle(index, issues);
  checkRollbacks(index, issues);
  checkFanout(index, issues);
  return issues;
}

function checkEndpoints(index: TopologyIndex, issues: ValidationIssue[]): void {
  if (index.starts.length === 0) addIssue(issues, "missing_start", "graph.nodes", "缺少开始节点");
  if (index.starts.length > 1) addIssue(issues, "multiple_start", "graph.nodes", "开始节点必须恰好一个");
  if (index.ends.length === 0) addIssue(issues, "missing_end", "graph.nodes", "缺少结束节点");
  if (index.ends.length > 1) addIssue(issues, "multiple_end", "graph.nodes", "结束节点必须恰好一个");
}

function checkEndpointEdges(index: TopologyIndex, issues: ValidationIssue[]): void {
  if (index.start !== undefined && (index.seqIn.get(index.start.id)?.length ?? 0) > 0) {
    addIssue(issues, "start_has_incoming", index.nodePath(index.start.id), "开始节点不能有入边");
  }
  if (index.end !== undefined && (index.seqOut.get(index.end.id)?.length ?? 0) > 0) {
    addIssue(issues, "end_has_outgoing", index.nodePath(index.end.id), "结束节点不能有出边");
  }
}

function checkChain(index: TopologyIndex, issues: ValidationIssue[]): void {
  for (const node of index.graph.nodes) {
    const inCount = index.seqIn.get(node.id)?.length ?? 0;
    const outCount = index.seqOut.get(node.id)?.length ?? 0;
    if (inCount > 1) {
      addIssue(issues, "broken_chain", index.nodePath(node.id), "节点最多一条 seq 入边");
    }
    if (outCount > 1) {
      addIssue(issues, "broken_chain", index.nodePath(node.id), "节点最多一条 seq 出边");
    }
    if (index.start !== undefined && node.id !== index.start.id && inCount === 0) {
      addIssue(issues, "broken_chain", index.nodePath(node.id), "非开始节点必须有一条 seq 入边");
    }
    if (index.end !== undefined && node.id !== index.end.id && outCount === 0) {
      addIssue(issues, "broken_chain", index.nodePath(node.id), "非结束节点必须有一条 seq 出边");
    }
  }
}

function checkReachability(index: TopologyIndex, issues: ValidationIssue[]): void {
  if (index.start === undefined) return;
  const reachable = new Set<string>();
  const queue = [index.start.id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of index.seqOut.get(current) ?? []) {
      if (!reachable.has(edge.to)) queue.push(edge.to);
    }
  }
  for (const node of index.graph.nodes) {
    if (!reachable.has(node.id)) {
      addIssue(issues, "broken_chain", index.nodePath(node.id), "节点从开始节点不可达");
    }
  }
}

function checkCycle(index: TopologyIndex, issues: ValidationIssue[]): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function hasCycle(nodeId: string): boolean {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const edge of index.seqOut.get(nodeId) ?? []) {
      if (hasCycle(edge.to)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  }
  if (index.graph.nodes.some((node) => hasCycle(node.id))) {
    addIssue(issues, "seq_cycle", "graph.edges", "seq 子图存在环");
  }
}

function checkRollbacks(index: TopologyIndex, issues: ValidationIssue[]): void {
  for (const node of index.graph.nodes) {
    const rollbacks = index.rollbackOut.get(node.id) ?? [];
    if (rollbacks.length === 0) continue;
    if (node.type !== "review" && node.type !== "confirm") {
      addIssue(issues, "invalid_rollback", index.nodePath(node.id), "只有 review/confirm 可以发起回退");
    }
    if (rollbacks.length > 1) {
      addIssue(issues, "invalid_rollback", index.nodePath(node.id), "每个节点最多一条回退边");
    }
    const ancestors = collectAncestors(index, node.id);
    for (const edge of rollbacks) {
      checkRollbackTarget(index, issues, edge, ancestors);
    }
  }
}

function collectAncestors(index: TopologyIndex, nodeId: string): Set<string> {
  const ancestors = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const edge of index.seqIn.get(current) ?? []) {
      if (!ancestors.has(edge.from)) {
        ancestors.add(edge.from);
        queue.push(edge.from);
      }
    }
  }
  return ancestors;
}

function checkRollbackTarget(
  index: TopologyIndex,
  issues: ValidationIssue[],
  edge: WorkflowEdge,
  ancestors: Set<string>,
): void {
  const path = `${index.edgePath(edge.id)}.to`;
  const target = index.nodes.get(edge.to);
  if (target === undefined) {
    addIssue(issues, "invalid_rollback", path, "回退目标不存在");
  } else if (target.type === "end") {
    addIssue(issues, "invalid_rollback", path, "不能回退到结束节点");
  } else if (!ancestors.has(target.id)) {
    addIssue(issues, "rollback_target_not_ancestor", path, "回退目标不是 seq 路径上的祖先");
  }
}

function checkFanout(index: TopologyIndex, issues: ValidationIssue[]): void {
  for (const node of index.graph.nodes) {
    if (node.type === "fanout") checkFanoutNode(index, issues, node);
    if (node.type === "fanin") checkFaninNode(index, issues, node);
  }
}

function checkFanoutNode(
  index: TopologyIndex,
  issues: ValidationIssue[],
  node: WorkflowNode,
): void {
  const out = index.seqOut.get(node.id) ?? [];
  const target = out.length === 1 ? index.nodes.get(out[0]?.to ?? "") : undefined;
  if (target?.type !== "fanin") {
    addIssue(issues, "fanout_fanin_unpaired", index.nodePath(node.id), "fanout 必须唯一指向一个 fanin");
  }
}

function checkFaninNode(
  index: TopologyIndex,
  issues: ValidationIssue[],
  node: WorkflowNode,
): void {
  const incoming = index.seqIn.get(node.id) ?? [];
  const source = incoming.length === 1 ? index.nodes.get(incoming[0]?.from ?? "") : undefined;
  if (source?.type !== "fanout") {
    addIssue(issues, "fanout_fanin_unpaired", index.nodePath(node.id), "fanin 必须唯一来自一个 fanout");
  }
}

export function analyzeBindings(graph: WorkflowGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  graph.nodes.forEach((node, index) => {
    const path = `graph.nodes[${index}].expertId`;
    const requiresExpert =
      node.type === "start" ||
      node.type === "end" ||
      node.type === "agent" ||
      node.type === "review" ||
      node.type === "fanout" ||
      node.type === "fanin";
    if (requiresExpert && node.expertId === null) {
      addIssue(issues, "expert_required", path, `${node.type} 节点必须绑定专家`);
    }
    if (node.type === "confirm" && node.expertId !== null) {
      addIssue(issues, "expert_forbidden", path, "confirm 节点不能绑定专家");
    }
  });
  return issues;
}
