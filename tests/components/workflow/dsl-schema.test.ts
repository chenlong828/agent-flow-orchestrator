import { describe, expect, test } from "bun:test";

describe("工作流 DSL JSON Schema 资产", () => {
  test("dslVersion、metadata、图数组与节点/边枚举与 v1 契约一致", async () => {
    const schema = (await Bun.file("src/components/workflow/dsl.schema.json").json()) as {
      $schema: string;
      required: string[];
      properties: Record<string, { const?: unknown; maxItems?: number }>;
      $defs: Record<
        string,
        {
          required?: string[];
          properties?: Record<
            string,
            { enum?: string[]; properties?: Record<string, { exclusiveMinimum?: number }> }
          >;
        }
      >;
    };
    expect(schema.$schema).toContain("2020-12");
    expect(schema.required).toEqual(["dslVersion", "metadata", "stages", "nodes", "edges"]);
    expect(schema.properties.dslVersion?.const).toBe(1);
    expect(schema.properties.stages?.maxItems).toBe(100);
    expect(schema.properties.nodes?.maxItems).toBe(500);
    expect(schema.properties.edges?.maxItems).toBe(1000);

    expect(schema.$defs.node?.required).toEqual(["id", "type", "name"]);
    expect(schema.$defs.node?.properties?.type?.enum).toEqual([
      "start",
      "end",
      "agent",
      "review",
      "confirm",
      "fanout",
      "fanin",
    ]);
    expect(schema.$defs.edge?.required).toEqual(["id", "from", "to", "kind"]);
    expect(schema.$defs.edge?.properties?.kind?.enum).toEqual(["seq", "rollback"]);
    expect(schema.$defs.layout?.required).toEqual(["x", "y"]);
    expect(
      schema.$defs.viewportLayout?.properties?.viewport?.properties?.zoom?.exclusiveMinimum,
    ).toBe(0);
  });
});
