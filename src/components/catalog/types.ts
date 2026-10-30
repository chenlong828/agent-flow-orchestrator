import type { Page, Reference } from "../../core/kernel/index.ts";
import type { HarnessQuery, HarnessRead } from "../harness/index.ts";
import type { ToolQuery, ToolRead } from "../tool/index.ts";
import type {
  SkillCategory,
  SkillDetail,
  SkillDocument,
  SkillPackage,
  SkillQuery,
  SkillRead,
} from "../skill/contract.ts";
import type { ExpertQuery, ExpertRead } from "../expert/index.ts";
import type {
  WorkflowDetail,
  WorkflowQuery,
  WorkflowRead,
  WorkflowSummary,
} from "../workflow/index.ts";

export type ReferenceAsset = {
  type: "harness" | "tool" | "skill";
  id: string;
  name: string;
};

export type ReferencePage = {
  asset: ReferenceAsset;
  total: number;
  items: Reference[];
};

export type HarnessListItem = {
  id: string;
  name: string;
  kind: "container" | "server" | "desktop" | "laptop";
  address: string;
  accessMode: "agent" | "ssh" | "container_registry";
  enabled: boolean;
  health: "unknown" | "online" | "offline" | "overloaded";
  lastHeartbeatAt: string | null;
  concurrencyMax: number;
  queuePolicy: "fifo" | "priority";
  tags: string[];
  toolCount: number;
  revision: number;
  updatedAt: string;
};

export type HarnessDetailView = HarnessListItem & {
  description: string;
  createdAt: string;
};

export type ToolParamView = {
  key: string;
  type: "string" | "int";
  description: string;
};

export type ToolListItem = {
  id: string;
  name: string;
  kind: "mcp" | "cli" | "script";
  invocation: string;
  description: string;
  harnessId: string;
  harnessName: string;
  timeoutMs: number;
  status: "unverified" | "available" | "unavailable";
  lastDebugAt: string | null;
  paramCount: number;
  usedByCount: number;
  revision: number;
  updatedAt: string;
};

export type ToolDetailView = ToolListItem & {
  params: ToolParamView[];
  createdAt: string;
};

export type SkillListItem = {
  id: string;
  name: string;
  categoryCode: string;
  categoryLabel: string;
  description: string;
  version: string;
  enabled: boolean;
  tags: string[];
  usedByCount: number;
  revision: number;
  updatedAt: string;
};

export type SkillDetailView = SkillDetail & {
  categoryLabel: string;
  usedByCount: number;
};

export type SkillCategoryView = SkillCategory;

export type ExpertSkillSummaryView = {
  id: string;
  name: string;
  categoryCode: string;
  categoryLabel: string;
  description: string;
};

export type ExpertSkillPreviewView = {
  id: string;
  name: string;
};

export type ExpertToolSummaryView = {
  id: string;
  name: string;
  kind: "mcp" | "cli" | "script";
  status: "unverified" | "available" | "unavailable";
};

export type ExpertListItem = {
  id: string;
  name: string;
  color: string;
  role: string;
  enabled: boolean;
  persona: string[];
  skillCount: number;
  toolCount: number;
  refCount: number;
  skills: ExpertSkillPreviewView[];
  revision: number;
  updatedAt: string;
};

export type ExpertDetailView = Omit<ExpertListItem, "skills"> & {
  duty: string;
  skillOrder: string;
  verifyOrder: string;
  notes: string;
  skills: ExpertSkillSummaryView[];
  tools: ExpertToolSummaryView[];
  refs: { label: string; refType: string; path: string | null }[];
  createdAt: string;
};

export type CatalogRead = {
  listHarnesses(query: HarnessQuery): Promise<Page<HarnessListItem>>;
  getHarness(id: string): Promise<HarnessDetailView>;

  listTools(query: ToolQuery): Promise<Page<ToolListItem>>;
  getTool(id: string): Promise<ToolDetailView>;
  listToolsByHarness(harnessId: string): Promise<Reference[]>;

  listSkills(query: SkillQuery): Promise<Page<SkillListItem>>;
  getSkill(id: string): Promise<SkillDetailView>;
  getSkillDocument(id: string): Promise<SkillDocument>;
  getSkillPackage(id: string): Promise<SkillPackage>;
  listSkillCategories(): Promise<SkillCategoryView[]>;
  listExpertsUsingSkill(skillId: string): Promise<Reference[]>;

  listExperts(query: ExpertQuery): Promise<Page<ExpertListItem>>;
  getExpert(id: string): Promise<ExpertDetailView>;
  listExpertsUsingTool(toolId: string): Promise<Reference[]>;

  listWorkflows(query: WorkflowQuery): Promise<Page<WorkflowSummary>>;
  getWorkflow(id: string): Promise<WorkflowDetail>;

  referencesForHarness(id: string): Promise<ReferencePage>;
  referencesForTool(id: string): Promise<ReferencePage>;
  referencesForSkill(id: string): Promise<ReferencePage>;
};

export type CatalogDeps = {
  harnessRead: HarnessRead;
  toolRead: ToolRead;
  skillRead: SkillRead;
  expertRead: ExpertRead;
  workflowRead: WorkflowRead;
};
