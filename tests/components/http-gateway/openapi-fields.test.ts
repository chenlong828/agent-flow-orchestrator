import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXPERT_CREATE_FIELDS,
  EXPERT_PATCH_FIELDS,
  EXPERT_WRITE_FIELDS,
  HARNESS_CREATE_FIELDS,
  HARNESS_WRITE_FIELDS,
  SKILL_SAVE_FIELDS,
  TOOL_WRITE_FIELDS,
  WORKFLOW_COPY_FIELDS,
  WORKFLOW_CREATE_FIELDS,
  WORKFLOW_GRAPH_FIELDS,
  WORKFLOW_IMPORT_FIELDS,
  WORKFLOW_WRITE_FIELDS,
} from "../../../src/components/http-gateway/fields.ts";

const specification = Bun.YAML.parse(
  readFileSync(join(import.meta.dir, "../../../src/components/http-gateway/openapi.yaml"), "utf8"),
) as {
  components: { schemas: Record<string, { properties?: Record<string, unknown>; allOf?: { $ref: string }[] }> };
};
const schemas = specification.components.schemas;

function schemaFields(name: string): string[] {
  const schema = schemas[name];
  if (schema === undefined) throw new Error(`OpenAPI 缺少 schema ${name}`);
  if (schema.allOf !== undefined) {
    return schema.allOf.flatMap((part) => schemaFields(part.$ref.split("/").pop()!));
  }
  return Object.keys(schema.properties ?? {});
}

const CASES: [string, readonly string[]][] = [
  ["HarnessCreate", HARNESS_CREATE_FIELDS],
  ["HarnessUpdate", HARNESS_WRITE_FIELDS],
  ["ToolCreate", TOOL_WRITE_FIELDS],
  ["ToolUpdate", TOOL_WRITE_FIELDS],
  ["SkillDraftSave", SKILL_SAVE_FIELDS],
  ["ExpertCreate", EXPERT_CREATE_FIELDS],
  ["ExpertUpdate", EXPERT_WRITE_FIELDS],
  ["ExpertAggregatePatch", EXPERT_PATCH_FIELDS],
  ["WorkflowCreate", WORKFLOW_CREATE_FIELDS],
  ["WorkflowUpdate", WORKFLOW_WRITE_FIELDS],
  ["WorkflowCopy", WORKFLOW_COPY_FIELDS],
  ["WorkflowSaveDefinition", WORKFLOW_GRAPH_FIELDS],
  ["WorkflowDsl", WORKFLOW_IMPORT_FIELDS],
];

describe("HTTP 字段白名单与 OpenAPI 请求体一致", () => {
  for (const [schema, fields] of CASES) {
    test(schema, () => {
      expect(new Set(schemaFields(schema))).toEqual(new Set(fields));
    });
  }
});
