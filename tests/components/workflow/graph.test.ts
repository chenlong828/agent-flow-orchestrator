import { describe, expect, test } from "bun:test";
import {
  analyzeGraph,
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

  test("专家矩阵：必填节点为空、confirm 绑定专家都被拒绝", () => {
    const graph = validGraph();
    graph.nodes[0] = { ...graph.nodes[0]!, expertId: null };
    graph.nodes[1] = { ...graph.nodes[1]!, expertId: EXPERT };
    const result = analyzeGraph(graph);
    expect(result.warnings.some((item) => item.code === "expert_required")).toBe(true);
    expect(result.warnings.some((item) => item.code === "expert_forbidden")).toBe(true);
  });

  test("可选视口随图保留；非法视口被拒绝", () => {
    const viewport = { x: 120, y: 80, zoom: 0.75 };
    const valid = collectGraph({ ...validGraph(), viewport });
    expect(valid.errors).toEqual([]);
    expect(valid.graph?.viewport).toEqual(viewport);

    const unknown = collectGraph({ ...validGraph(), viewport: { ...viewport, extra: true } });
    expect(unknown.errors.some((item) => item.code === "graph_shape")).toBe(true);
    expect(unknown.graph).toBeNull();

    for (const bad of [
      { x: 120, y: 80 },
      { x: Number.NaN, y: 80, zoom: 0.75 },
      { x: 120, y: 80, zoom: 0 },
      { x: 120, y: 80, zoom: -0.5 },
    ]) {
      const result = collectGraph({ ...validGraph(), viewport: bad });
      expect(result.errors.some((item) => item.code === "invalid_layout")).toBe(true);
      expect(result.graph).toBeNull();
    }

    expect(parseGraph({ ...validGraph(), viewport }).viewport).toEqual(viewport);
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
  test("合法图无 warning", () => {
    const report = analyzeGraph(validGraph());
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
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
    const codes = analyzeGraph(graph).warnings.map((item) => item.code);
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
    expect(analyzeGraph(graph).warnings.some((item) => item.code === "broken_chain")).toBe(true);
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
    expect(analyzeGraph(graph).warnings.some((item) => item.code === "fanout_fanin_unpaired")).toBe(true);
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
      analyzeGraph(graph).warnings.some((item) => item.code === "rollback_target_not_ancestor"),
    ).toBe(true);
  });
});
