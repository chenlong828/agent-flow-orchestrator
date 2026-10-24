import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const SPEC_FILE = join(
  ROOT,
  "docs",
  "design",
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
    expect(Object.keys(spec.paths)).toHaveLength(18);
    expect(operations).toHaveLength(30);
    expect(spec.info["x-api-count"]).toBe(29);
  });

  test("operationId、summary、tag 与响应齐全", () => {
    const ids = operations.map(({ operation }) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);

    const topTags = new Set(spec.tags.map((tag: any) => tag.name));
    for (const { path, method, operation } of operations) {
      expect(typeof operation.operationId).toBe("string");
      expect(typeof operation.summary).toBe("string");
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
    expect(apiIds).toHaveLength(29);
  });

  test("components 完整，所有 $ref 都可解析", () => {
    expect(Object.keys(spec.components.parameters)).toHaveLength(7);
    expect(Object.keys(spec.components.schemas)).toHaveLength(48);
    expect(Object.keys(spec.components.responses)).toHaveLength(6);

    const refs = [...text.matchAll(/\$ref:\s*['"]?#\/components\/([^'"]+)['"]?/g)].map(
      (match) => match[1]!,
    );
    expect(refs.length).toBe(290);
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
