import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const SPEC_FILE = join(
  ROOT,
  "src",
  "components",
  "http-gateway",
  "openapi.yaml",
);

const text = await Bun.file(SPEC_FILE).text();
const spec = Bun.YAML.parse(text) as any;
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

type Operation = {
  path: string;
  method: string;
  operation: any;
};

const operations: Operation[] = [];
for (const [path, item] of Object.entries<any>(spec.paths)) {
  for (const method of METHODS) {
    if (item[method] !== undefined) {
      operations.push({ path, method, operation: item[method] });
    }
  }
}

describe("OpenAPI 契约结构", () => {
  test("版本、路径与 operation 数量稳定", () => {
    expect(spec.openapi).toBe("3.0.3");
    expect(Object.keys(spec.paths)).toHaveLength(31);
    expect(operations).toHaveLength(48);
    expect(spec.info["x-api-count"]).toBe(47);
  });

  test("operation 介绍、schema 说明与 tag 齐全", () => {
    const ids = operations.map(({ operation }) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);

    const topTags = new Set(spec.tags.map((tag: any) => tag.name));
    for (const { path, method, operation } of operations) {
      expect(typeof operation.operationId).toBe("string");
      expect(typeof operation.summary).toBe("string");
      expect(typeof operation.description).toBe("string");
      expect(operation.description.trim().length).toBeGreaterThan(0);
      expect(operation.tags.length).toBeGreaterThan(0);
      for (const tag of operation.tags) {
        expect(topTags.has(tag)).toBe(true);
      }
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
      expect(["get", "post", "put", "patch", "delete"]).toContain(method);
      expect(path.startsWith("/api/v1") || path === "/healthz").toBe(true);
    }

    const apiIds = operations
      .map(({ operation }) => operation["x-api-id"])
      .filter((id: unknown) => typeof id === "string" && /^API-\d+$/.test(id));
    expect(apiIds.length).toBeGreaterThan(0);

    for (const [name, schema] of Object.entries<any>(spec.components.schemas)) {
      expect(typeof schema.description, name).toBe("string");
      expect(schema.description.trim().length, name).toBeGreaterThan(0);
    }
  });

  test("核心 DTO 字段都带说明", () => {
    const core = [
      "HarnessListItem",
      "HarnessCreate",
      "HarnessDetail",
      "ToolListItem",
      "ToolCreate",
      "ToolDetail",
      "SkillListItem",
      "SkillDetail",
      "SkillDraft",
      "SkillDraftSave",
      "SkillDraftFileResult",
      "SkillSaveResult",
      "ExpertListItem",
      "ExpertBase",
      "ExpertSkillPreview",
      "ExpertCreate",
      "ExpertAggregatePatch",
      "ExpertDetail",
      "ReferencePage",
      "ErrorDetail",
    ];
    for (const name of core) {
      const schema = spec.components.schemas[name];
      const parts = schema.allOf ?? [schema];
      for (const part of parts) {
        for (const [property, value] of Object.entries<any>(part.properties ?? {})) {
          expect(typeof value.description, `${name}.${property}`).toBe("string");
          expect(value.description.trim().length, `${name}.${property}`).toBeGreaterThan(0);
        }
      }
    }
  });

  test("请求 DTO 的必填字段与实现一致", () => {
    const toolParam = spec.components.schemas.ToolParam;
    expect(toolParam.required).toContain("key");
    expect(toolParam.required).toContain("type");
    expect(toolParam.required).not.toContain("description");

    for (const name of ["ExpertRef"]) {
      const schema = spec.components.schemas[name];
      expect(schema.required).toContain("label");
      expect(schema.required).toContain("refType");
      expect(schema.required).not.toContain("path");
    }
  });

  test("工作流契约：排序、透明布局、创建必填图与 updatedBy", () => {
    const sort = spec.components.schemas.WorkflowSort;
    expect(sort.enum).toEqual(["name:asc", "name:desc", "updatedAt:asc", "updatedAt:desc"]);
    expect(sort.default).toBe("updatedAt:desc");

    const stage = spec.components.schemas.WorkflowStage;
    expect(stage.properties.description.maxLength).toBe(500);
    expect(stage.properties.layout.type).toBe("object");
    expect(stage.properties.layout.additionalProperties).toBe(true);
    const node = spec.components.schemas.WorkflowNode;
    expect(node.properties.layout.type).toBe("object");
    expect(node.properties.layout.additionalProperties).toBe(true);
    const graph = spec.components.schemas.WorkflowGraph;
    expect(graph.properties.viewport.type).toBe("object");
    expect(graph.properties.viewport.additionalProperties).toBe(true);
    expect(spec.components.schemas.WorkflowLayout).toBeUndefined();
    expect(spec.components.schemas.WorkflowLayoutViewport).toBeUndefined();

    expect(spec.components.schemas.WorkflowCreate.required).toContain("graph");
    expect(spec.components.schemas.WorkflowMutationResult.required).toEqual([
      "id",
      "revision",
      "warnings",
    ]);
    expect(spec.components.schemas.WorkflowSummary.required).toContain("updatedBy");
    expect(spec.paths["/api/v1/workflows"].post.responses["201"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/WorkflowMutationResult");
    expect(spec.paths["/api/v1/workflows/{id}/copy"].post.responses["201"].content["application/json"].schema.$ref)
      .toBe("#/components/schemas/WorkflowMutationResult");
  });

  test("components 完整，所有 $ref 都可解析", () => {
    expect(Object.keys(spec.components.parameters)).toHaveLength(8);
    expect(Object.keys(spec.components.schemas)).toHaveLength(75);
    expect(Object.keys(spec.components.responses)).toHaveLength(10);

    const refs = [...text.matchAll(/\$ref['"]?\s*:\s*['"]?#\/components\/([^'"]+)['"]?/g)].map(
      (match) => match[1]!,
    );
    expect(refs.length).toBe(467);
    const missing: string[] = [];
    for (const ref of new Set(refs)) {
      let current: any = spec.components;
      for (const segment of ref.split("/")) {
        current = current?.[segment];
      }
      if (current === undefined) missing.push(ref);
    }
    expect(missing).toEqual([]);
  });

  test("servers 为相对地址，文档端点不进入业务 paths", () => {
    expect(spec.servers).toEqual([
      {
        url: "/",
        description: "当前文档所在服务；业务路径已包含 /api/v1，/healthz 不在版本内。",
      },
    ]);
    expect(spec.paths["/docs"]).toBeUndefined();
    expect(spec.paths["/openapi.yaml"]).toBeUndefined();
  });
});
