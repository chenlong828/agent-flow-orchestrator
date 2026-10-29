import type { Page } from "../../core/kernel/index.ts";
import {
  EXPERT_SORT,
  HARNESS_SORT,
  SKILL_SORT,
  TOOL_SORT,
  WORKFLOW_SORT,
} from "./fields.ts";
import {
  assertUuid,
  parseBooleanQuery,
  parseEnumQuery,
  parsePageQuery,
  parseSortQuery,
  queryValue,
} from "./validation.ts";

export function parseHarnessListQuery(url: URL) {
  return {
    q: queryValue(url, "q"),
    kind: parseEnumQuery(url, "kind", ["container", "server", "desktop", "laptop"] as const),
    enabled: parseBooleanQuery(url, "enabled"),
    health: parseEnumQuery(url, "health", [
      "unknown",
      "online",
      "offline",
      "overloaded",
    ] as const),
    page: parsePageQuery(url),
    sort: parseSortQuery(url, HARNESS_SORT),
  };
}

export function parseToolListQuery(url: URL) {
  const harnessId = queryValue(url, "harnessId");
  if (harnessId !== undefined) assertUuid(harnessId, "harnessId");
  return {
    q: queryValue(url, "q"),
    kind: parseEnumQuery(url, "kind", ["mcp", "cli", "script"] as const),
    status: parseEnumQuery(url, "status", ["unverified", "available", "unavailable"] as const),
    harnessId,
    page: parsePageQuery(url),
    sort: parseSortQuery(url, TOOL_SORT),
  };
}

export function parseSkillListQuery(url: URL) {
  return {
    q: queryValue(url, "q"),
    categoryCode: queryValue(url, "category"),
    enabled: parseBooleanQuery(url, "enabled"),
    tag: queryValue(url, "tag"),
    page: parsePageQuery(url),
    sort: parseSortQuery(url, SKILL_SORT),
  };
}

export function parseExpertListQuery(url: URL) {
  return {
    q: queryValue(url, "q"),
    enabled: parseBooleanQuery(url, "enabled"),
    page: parsePageQuery(url),
    sort: parseSortQuery(url, EXPERT_SORT),
  };
}

export function parseWorkflowListQuery(url: URL) {
  return {
    q: queryValue(url, "q"),
    type: queryValue(url, "type"),
    page: parsePageQuery(url),
    sort: parseSortQuery(url, WORKFLOW_SORT),
  };
}

export function pagePayload<T>(page: Page<T>): Record<string, unknown> {
  return {
    items: page.items,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  };
}
