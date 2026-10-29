import type {
  Page,
  Reference,
  ReferenceGuard,
  ReferenceOwner,
} from "../../core/kernel/index.ts";
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

function categoryMap(categories: SkillCategory[]): Map<string, string> {
  return new Map(categories.map((category) => [category.code, category.label]));
}

function requireCategoryLabel(labels: Map<string, string>, code: string): string {
  const label = labels.get(code);
  if (label === undefined) throw new Error(`Skill 分类 ${code} 不存在`);
  return label;
}

export function createCatalog(deps: CatalogDeps): CatalogRead & ReferenceGuard {
  const { harnessRead, toolRead, skillRead, expertRead, workflowRead } = deps;

  async function listToolsByHarnessReferences(harnessId: string): Promise<Reference[]> {
    const tools = await toolRead.listByHarness(harnessId);
    return tools.map((tool) => ({ type: "tool" as const, id: tool.id, name: tool.name }));
  }

  async function listExpertsUsingSkillReferences(skillId: string): Promise<Reference[]> {
    const experts = await expertRead.listExpertsUsingSkill(skillId);
    return experts.map((expert) => ({
      type: "expert" as const,
      id: expert.id,
      name: expert.name,
    }));
  }

  async function listExpertsUsingToolReferences(toolId: string): Promise<Reference[]> {
    const experts = await expertRead.listExpertsUsingTool(toolId);
    return experts.map((expert) => ({
      type: "expert" as const,
      id: expert.id,
      name: expert.name,
    }));
  }

  async function harnessNameFor(harnessId: string): Promise<string> {
    const harness = await harnessRead.get(harnessId);
    return harness.name;
  }

  const catalog: CatalogRead & ReferenceGuard = {
    async check(owner: ReferenceOwner, id: string): Promise<Reference[]> {
      switch (owner) {
        case "harness":
          return listToolsByHarnessReferences(id);
        case "tool":
          return listExpertsUsingToolReferences(id);
        case "skill":
          return listExpertsUsingSkillReferences(id);
        case "expert": {
          const workflows = await workflowRead.listByExpert(id);
          return workflows.map((workflow) => ({
            type: "workflow" as const,
            id: workflow.id,
            name: workflow.name,
          }));
        }
      }
    },

    async listHarnesses(query) {
      const page = await harnessRead.list(query);
      const items: HarnessListItem[] = [];
      for (const harness of page.items) {
        const tools = await toolRead.listByHarness(harness.id);
        items.push({ ...harness, toolCount: tools.length });
      }
      return { ...page, items };
    },

    async getHarness(id) {
      const harness = await harnessRead.get(id);
      const tools = await toolRead.listByHarness(id);
      return { ...harness, toolCount: tools.length };
    },

    async listTools(query) {
      const page = await toolRead.list(query);
      const items: ToolListItem[] = [];
      for (const tool of page.items) {
        const harnessName = await harnessNameFor(tool.harnessId);
        const usedBy = await expertRead.listExpertsUsingTool(tool.id);
        items.push({
          id: tool.id,
          name: tool.name,
          kind: tool.kind,
          invocation: tool.invocation,
          description: tool.description,
          harnessId: tool.harnessId,
          harnessName,
          timeoutMs: tool.timeoutMs,
          status: tool.status,
          lastDebugAt: tool.lastDebugAt,
          paramCount: tool.params.length,
          usedByCount: usedBy.length,
          revision: tool.revision,
          updatedAt: tool.updatedAt,
        });
      }
      return { ...page, items };
    },

    async getTool(id) {
      const tool = await toolRead.get(id);
      const harnessName = await harnessNameFor(tool.harnessId);
      const usedBy = await expertRead.listExpertsUsingTool(id);
      return {
        id: tool.id,
        name: tool.name,
        kind: tool.kind,
        invocation: tool.invocation,
        harnessId: tool.harnessId,
        harnessName,
        timeoutMs: tool.timeoutMs,
        status: tool.status,
        lastDebugAt: tool.lastDebugAt,
        paramCount: tool.params.length,
        usedByCount: usedBy.length,
        revision: tool.revision,
        updatedAt: tool.updatedAt,
        description: tool.description,
        params: tool.params.map((param) => ({
          key: param.paramKey,
          type: param.type,
          description: param.description ?? "",
        })),
        createdAt: tool.createdAt,
      };
    },

    async listToolsByHarness(harnessId) {
      return listToolsByHarnessReferences(harnessId);
    },

    async listSkills(query) {
      const [page, categories] = await Promise.all([
        skillRead.list(query),
        skillRead.listCategories(),
      ]);
      const labels = categoryMap(categories);
      const items: SkillListItem[] = [];
      for (const skill of page.items) {
        const usedBy = await expertRead.listExpertsUsingSkill(skill.id);
        items.push({
          id: skill.id,
          name: skill.name,
          categoryCode: skill.categoryCode,
          categoryLabel: requireCategoryLabel(labels, skill.categoryCode),
          description: skill.description,
          version: skill.version,
          enabled: skill.enabled,
          tags: skill.tags,
          usedByCount: usedBy.length,
          revision: skill.revision,
          updatedAt: skill.updatedAt,
        });
      }
      return { ...page, items };
    },

    async getSkill(id) {
      const [skill, categories, usedBy] = await Promise.all([
        skillRead.get(id),
        skillRead.listCategories(),
        expertRead.listExpertsUsingSkill(id),
      ]);
      const labels = categoryMap(categories);
      return {
        id: skill.id,
        name: skill.name,
        categoryCode: skill.categoryCode,
        categoryLabel: requireCategoryLabel(labels, skill.categoryCode),
        description: skill.description,
        version: skill.version,
        enabled: skill.enabled,
        tags: skill.tags,
        usedByCount: usedBy.length,
        revision: skill.revision,
        updatedAt: skill.updatedAt,
        body: skill.body,
        files: skill.files,
        createdAt: skill.createdAt,
      };
    },

    async getSkillDocument(id) {
      return skillRead.getDocument(id);
    },

    async getSkillPackage(id) {
      return skillRead.getPackage(id);
    },

    async listSkillCategories() {
      return skillRead.listCategories();
    },

    async listExpertsUsingSkill(skillId) {
      return listExpertsUsingSkillReferences(skillId);
    },

    async listExperts(query) {
      const page = await expertRead.list(query);
      const counts = await workflowRead.countByExperts(page.items.map((expert) => expert.id));
      const items: ExpertListItem[] = [];
      for (const expert of page.items) {
        const skills: ExpertSkillPreviewView[] = [];
        for (const skillId of expert.skillIds.slice(0, 3)) {
          const skill = await skillRead.getSummary(skillId);
          skills.push({ id: skill.id, name: skill.name });
        }
        items.push({
          id: expert.id,
          name: expert.name,
          color: expert.color,
          role: expert.role,
          enabled: expert.enabled,
          persona: expert.persona,
          skillCount: expert.skillCount,
          toolCount: expert.toolCount,
          refCount: counts[expert.id] ?? 0,
          skills,
          revision: expert.revision,
          updatedAt: expert.updatedAt,
        });
      }
      return { ...page, items };
    },

    async getExpert(id) {
      const [expert, categories, counts] = await Promise.all([
        expertRead.get(id),
        skillRead.listCategories(),
        workflowRead.countByExperts([id]),
      ]);
      const labels = categoryMap(categories);
      const skills: ExpertSkillSummaryView[] = [];
      for (const skillId of expert.skillIds) {
        const skill = await skillRead.getSummary(skillId);
        skills.push({
          id: skill.id,
          name: skill.name,
          categoryCode: skill.categoryCode,
          categoryLabel: requireCategoryLabel(labels, skill.categoryCode),
          description: skill.description,
        });
      }
      const tools: ExpertToolSummaryView[] = [];
      for (const toolId of expert.toolIds) {
        const tool = await toolRead.getSummary(toolId);
        tools.push({ id: tool.id, name: tool.name, kind: tool.kind, status: tool.status });
      }
      return {
        id: expert.id,
        name: expert.name,
        color: expert.color,
        role: expert.role,
        enabled: expert.enabled,
        persona: expert.persona,
        skillCount: expert.skillCount,
        toolCount: expert.toolCount,
        refCount: counts[id] ?? 0,
        revision: expert.revision,
        updatedAt: expert.updatedAt,
        duty: expert.duty,
        skillOrder: expert.skillOrder,
        verifyOrder: expert.verifyOrder,
        notes: expert.notes,
        skills,
        tools,
        refs: expert.refs.map((ref) => ({
          label: ref.label,
          refType: ref.refType,
          path: ref.path ?? null,
        })),
        createdAt: expert.createdAt,
      };
    },

    async listExpertsUsingTool(toolId) {
      return listExpertsUsingToolReferences(toolId);
    },

    async listWorkflows(query) {
      return workflowRead.list(query);
    },

    async getWorkflow(id) {
      return workflowRead.get(id);
    },

    async referencesForHarness(id) {
      const harness = await harnessRead.get(id);
      const items = await catalog.check("harness", id);
      return {
        asset: { type: "harness", id, name: harness.name },
        total: items.length,
        items,
      };
    },

    async referencesForTool(id) {
      const tool = await toolRead.get(id);
      const items = await catalog.check("tool", id);
      return {
        asset: { type: "tool", id, name: tool.name },
        total: items.length,
        items,
      };
    },

    async referencesForSkill(id) {
      const skill = await skillRead.getSummary(id);
      const items = await catalog.check("skill", id);
      return {
        asset: { type: "skill", id, name: skill.name },
        total: items.length,
        items,
      };
    },
  };

  return catalog;
}
