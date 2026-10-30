import { ValidationError } from "../../core/kernel/index.ts";
import { collectGraph, type WorkflowGraph } from "./graph.ts";
import type { WorkflowDsl } from "./types.ts";
import { ensureDescription, ensureText, shapeToMultiField } from "./validation.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new ValidationError(field, `未知字段 ${unknown.join(", ")}`);
}

function normalizeDslMetadata(value: unknown): {
  name: string;
  type: string;
  description: string;
} {
  if (!isRecord(value)) throw new ValidationError("metadata", "必须是对象");
  rejectUnknownFields(value, ["name", "type", "description"], "metadata");
  return {
    name: ensureText(value.name, "metadata.name", 80),
    type: ensureText(value.type, "metadata.type", 40),
    description: ensureDescription(value.description, "metadata.description"),
  };
}

function normalizeDslGraph(body: Record<string, unknown>): WorkflowGraph {
  const { graph, errors } = collectGraph({
    stages: body.stages,
    nodes: body.nodes,
    edges: body.edges,
  });
  if (errors.length > 0 || graph === null) throw shapeToMultiField(errors);
  return graph;
}

function normalizeDslLayout(value: unknown): WorkflowDsl["layout"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new ValidationError("layout", "必须是对象");
  rejectUnknownFields(value, ["viewport"], "layout");
  if (value.viewport === undefined) return undefined;
  if (!isRecord(value.viewport)) {
    throw new ValidationError("layout.viewport", "必须是对象");
  }
  return { viewport: value.viewport };
}

export function normalizeDsl(input: unknown): { dsl: WorkflowDsl; graph: WorkflowGraph } {
  if (!isRecord(input)) throw new ValidationError("body", "必须是对象");
  rejectUnknownFields(
    input,
    ["dslVersion", "metadata", "stages", "nodes", "edges", "layout"],
    "body",
  );
  if (input.dslVersion !== 1) throw new ValidationError("dslVersion", "必须是 1");
  const metadata = normalizeDslMetadata(input.metadata);
  const graph = normalizeDslGraph(input);
  const layout = normalizeDslLayout(input.layout);
  return {
    dsl: {
      dslVersion: 1,
      metadata,
      stages: graph.stages,
      nodes: graph.nodes,
      edges: graph.edges,
      ...(layout === undefined ? {} : { layout }),
    },
    graph: layout?.viewport === undefined ? graph : { ...graph, viewport: layout.viewport },
  };
}

