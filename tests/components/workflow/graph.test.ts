import { describe, expect, test } from "bun:test";
import {
  analyzeBindings,
  analyzeTopology,
  collectGraph,
  parseGraph,
  type WorkflowGraph,
} from "../../../src/components/workflow/index.ts";

const EXPERT = "0192f0c4-7a1e-7d3b-9c2a-1f5e6d7c8b9a";

function validGraph(): WorkflowGraph {
  return {
    stages: [{ id: "s1", name: "设计" }],
    nodes: [
      { id: "n1", type: "start", name: "开始", stageId: "s1", expertId: EXPERT },
      { id: "n2", type: "confirm", name: "确认", stageId: "s1", expertId: null },
      { id: "n3", type: "end", name: "结束", stageId: "s1", expertId: EXPERT },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2", kind: "seq" },
      { id: "e2", from: "n2", to: "n3", kind: "seq" },
    ],
  };
}

describe("工作流图形状校验", () => {
  test("合法图无形状错误；未知字段、重复 ID、悬空端点被拒绝", () => {
    const valid = collectGraph(validGraph());
    expect(valid.errors).toEqual([]);

    const unknown = collectGraph({
      ...validGraph(),
      behavior: {},
    });
    expect(unknown.errors.some((item) => item.code === "graph_shape")).toBe(true);

    const duplicate = validGraph();
    duplicate.nodes[1] = { ...duplicate.nodes[1]!, id: "n1" };
    const duplicateResult = collectGraph(duplicate);
    expect(duplicateResult.errors.some((item) => item.code === "duplicate_id")).toBe(true);

    const dangling = validGraph();
    dangling.edges[0] = { ...dangling.edges[0]!, from: "missing" };
    const danglingResult = collectGraph(dangling);
    expect(danglingResult.errors.some((item) => item.code === "missing_endpoint")).toBe(true);
  });

  test("专家矩阵：必填节点为空、confirm 绑定专家都被拒绝，路径用数组下标", () => {
    const graph = validGraph();
    graph.nodes[0] = { ...graph.nodes[0]!, expertId: null };
    graph.nodes[1] = { ...graph.nodes[1]!, expertId: EXPERT };
    const issues = analyzeBindings(graph);
    expect(issues.some((item) => item.code === "expert_required")).toBe(true);
    expect(issues.some((item) => item.code === "expert_forbidden")).toBe(true);
    expect(issues.map((item) => item.path)).toContain("graph.nodes[0].expertId");
    expect(issues.map((item) => item.path)).toContain("graph.nodes[1].expertId");
  });

  test("layout/viewport 作为透明对象透传：任意字段与 zoom=0 都保留", () => {
    const viewport = { x: 120, y: 80, zoom: 0, future: { minimap: true } };
    const stageLayout = { x: 10, y: 20, collapsed: true, future: "ok" };
    const nodeLayout = { x: 1, y: 2, width: 300, height: 120, pinned: true };
    const input = {
      ...validGraph(),
      stages: [{ ...validGraph().stages[0]!, layout: stageLayout }],
      nodes: [
        { ...validGraph().nodes[0]!, layout: nodeLayout },
        ...validGraph().nodes.slice(1),
      ],
      viewport,
    };
    const valid = collectGraph(input);
    expect(valid.errors).toEqual([]);
    expect(valid.graph?.viewport).toEqual(viewport);
    expect(valid.graph?.stages[0]?.layout).toEqual(stageLayout);
    expect(valid.graph?.nodes[0]?.layout).toEqual(nodeLayout);

    for (const bad of [null, "viewport", 1, []]) {
      const result = collectGraph({ ...validGraph(), viewport: bad });
      expect(result.errors.some((item) => item.code === "invalid_layout")).toBe(true);
      expect(result.graph).toBeNull();
    }

    expect(parseGraph({ ...validGraph(), viewport }).viewport).toEqual(viewport);
  });

  test("多字段错误同时提供 issues 与兼容 fieldErrors", () => {
    try {
      parseGraph({ stages: [] });
    } catch (error) {
      const details = (error as { details: { issues: unknown[]; fieldErrors: unknown[] } }).details;
      expect(details.issues.length).toBeGreaterThan(0);
      expect(details.fieldErrors.length).toBe(details.issues.length);
    }
  });

  test("parseGraph 把形状错误聚合为 validation_error", () => {
    expect(() => parseGraph({ stages: [] })).toThrow();
    try {
      parseGraph({ stages: [] });
    } catch (error) {
      expect(error).toMatchObject({ code: "validation_error" });
    }
  });
});

describe("工作流图语义校验", () => {
  test("合法图无拓扑问题", () => {
    expect(analyzeTopology(validGraph())).toEqual([]);
  });

  test("缺开始/结束、seq 环与非法回退都产出 warning", () => {
    const graph: WorkflowGraph = {
      stages: [{ id: "s1", name: "设计" }],
      nodes: [
        { id: "n1", type: "agent", name: "实现", stageId: "s1", expertId: EXPERT },
        { id: "n2", type: "agent", name: "复核", stageId: "s1", expertId: EXPERT },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2", kind: "seq" },
        { id: "e2", from: "n2", to: "n1", kind: "seq" },
        { id: "e3", from: "n2", to: "n1", kind: "rollback" },
      ],
    };
    const codes = analyzeTopology(graph).map((item) => item.code);
    expect(codes).toContain("missing_start");
    expect(codes).toContain("missing_end");
    expect(codes).toContain("seq_cycle");
    expect(codes).toContain("invalid_rollback");
  });

  test("可从开始节点不可达的节点是 broken_chain", () => {
    const graph: WorkflowGraph = {
      stages: [{ id: "s1", name: "设计" }],
      nodes: [
        { id: "n1", type: "start", name: "开始", stageId: "s1", expertId: EXPERT },
        { id: "n2", type: "end", name: "结束", stageId: "s1", expertId: EXPERT },
        { id: "n3", type: "agent", name: "孤立", stageId: "s1", expertId: EXPERT },
      ],
      edges: [{ id: "e1", from: "n1", to: "n2", kind: "seq" }],
    };
    expect(analyzeTopology(graph).some((item) => item.code === "broken_chain")).toBe(true);
  });

  test("fanout/fanin 必须成对", () => {
    const graph: WorkflowGraph = {
      stages: [{ id: "s1", name: "设计" }],
      nodes: [
        { id: "n1", type: "start", name: "开始", stageId: "s1", expertId: EXPERT },
        { id: "n2", type: "fanout", name: "分叉", stageId: "s1", expertId: EXPERT },
        { id: "n3", type: "agent", name: "分支", stageId: "s1", expertId: EXPERT },
        { id: "n4", type: "end", name: "结束", stageId: "s1", expertId: EXPERT },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2", kind: "seq" },
        { id: "e2", from: "n2", to: "n3", kind: "seq" },
        { id: "e3", from: "n3", to: "n4", kind: "seq" },
      ],
    };
    expect(analyzeTopology(graph).some((item) => item.code === "fanout_fanin_unpaired")).toBe(true);
  });

  test("回退目标必须是 seq 路径上的祖先", () => {
    const graph: WorkflowGraph = {
      stages: [{ id: "s1", name: "设计" }],
      nodes: [
        { id: "n1", type: "start", name: "开始", stageId: "s1", expertId: EXPERT },
        { id: "n2", type: "review", name: "评审", stageId: "s1", expertId: EXPERT },
        { id: "n3", type: "agent", name: "实现", stageId: "s1", expertId: EXPERT },
        { id: "n4", type: "end", name: "结束", stageId: "s1", expertId: EXPERT },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2", kind: "seq" },
        { id: "e2", from: "n2", to: "n3", kind: "seq" },
        { id: "e3", from: "n3", to: "n4", kind: "seq" },
        { id: "e4", from: "n2", to: "n3", kind: "rollback" },
      ],
    };
    expect(
      analyzeTopology(graph).some((item) => item.code === "rollback_target_not_ancestor"),
    ).toBe(true);
  });
});
