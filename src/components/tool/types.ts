import type { Page, PageQuery } from "../../core/kernel/index.ts";

export type ToolKind = "mcp" | "cli" | "script";
export type ToolStatus = "unverified" | "available" | "unavailable";
export type ToolParamType = "string" | "int";

export type ToolParamInput = {
  paramKey: string;
  type: ToolParamType;
  description?: string;
};

export type CreateTool = {
  name: string;
  kind: ToolKind;
  invocation: string;
  description?: string;
  harnessId: string;
  timeoutMs: number;
  params?: ToolParamInput[];
};

export type UpdateTool = CreateTool;

export type ToolParam = ToolParamInput & { position: number };

export type ToolSummary = {
  id: string;
  name: string;
  kind: ToolKind;
  invocation: string;
  description: string;
  harnessId: string;
  timeoutMs: number;
  status: ToolStatus;
  lastDebugAt: string | null;
  params: ToolParam[];
  revision: number;
  updatedAt: string;
};

export type ToolDetail = ToolSummary & {
  createdAt: string;
};

export type ToolQuery = {
  q?: string;
  kind?: ToolKind;
  status?: ToolStatus;
  harnessId?: string;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt";
};

export type ToolRef = { id: string; name: string };

export type ToolService = {
  create(input: CreateTool, actor?: string): Promise<{ id: string; revision: number }>;
  update(
    id: string,
    revision: number,
    input: UpdateTool,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
};

export type ToolRead = {
  list(query: ToolQuery): Promise<Page<ToolSummary>>;
  get(id: string): Promise<ToolDetail>;
  getSummary(id: string): Promise<ToolSummary>;
  listByHarness(harnessId: string): Promise<ToolRef[]>;
};
