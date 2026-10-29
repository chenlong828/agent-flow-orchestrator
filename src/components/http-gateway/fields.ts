export const HARNESS_WRITE_FIELDS = [
  "name",
  "kind",
  "address",
  "accessMode",
  "description",
  "concurrencyMax",
  "queuePolicy",
  "tags",
] as const;
export const HARNESS_CREATE_FIELDS = [...HARNESS_WRITE_FIELDS, "enabled"] as const;
export const TOOL_WRITE_FIELDS = [
  "name",
  "kind",
  "invocation",
  "description",
  "harnessId",
  "timeoutMs",
  "params",
] as const;
export const SKILL_SAVE_FIELDS = [
  "name",
  "categoryCode",
  "description",
  "tags",
  "body",
] as const;
export const EXPERT_WRITE_FIELDS = [
  "name",
  "color",
  "role",
  "persona",
  "duty",
  "skillOrder",
  "verifyOrder",
  "notes",
  "refs",
] as const;
export const EXPERT_CREATE_FIELDS = [
  ...EXPERT_WRITE_FIELDS,
  "enabled",
  "skillIds",
  "toolIds",
] as const;
export const EXPERT_PATCH_FIELDS = [...EXPERT_WRITE_FIELDS, "skillIds", "toolIds"] as const;
export const HARNESS_SORT = {
  "name:asc": "name",
  "name:desc": "-name",
  "updatedAt:asc": "updatedAt",
  "updatedAt:desc": "-updatedAt",
} as const;
export const TOOL_SORT = HARNESS_SORT;
export const SKILL_SORT = {
  ...HARNESS_SORT,
  "version:asc": "version",
  "version:desc": "-version",
} as const;
export const EXPERT_SORT = HARNESS_SORT;
export const WORKFLOW_WRITE_FIELDS = ["name", "type", "description"] as const;
export const WORKFLOW_CREATE_FIELDS = [...WORKFLOW_WRITE_FIELDS, "graph"] as const;
export const WORKFLOW_COPY_FIELDS = ["name"] as const;
export const WORKFLOW_GRAPH_FIELDS = ["graph"] as const;
export const WORKFLOW_IMPORT_FIELDS = [
  "dslVersion",
  "metadata",
  "stages",
  "nodes",
  "edges",
  "layout",
] as const;
export const WORKFLOW_SORT = HARNESS_SORT;
