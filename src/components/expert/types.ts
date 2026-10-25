import type { Page, PageQuery } from "../../core/kernel/index.ts";

export type ExpertRefInput = {
  label: string;
  refType: string;
  path?: string;
};

export type CreateExpert = {
  name: string;
  color: string;
  role: string;
  enabled?: boolean;
  persona?: string[];
  duty?: string;
  skillOrder?: string;
  verifyOrder?: string;
  notes?: string;
  refs?: ExpertRefInput[];
  skillIds?: string[];
  toolIds?: string[];
};

export type UpdateExpert = Omit<CreateExpert, "enabled" | "skillIds" | "toolIds">;

export type UpdateExpertAggregate = {
  name?: string;
  color?: string;
  role?: string;
  persona?: string[];
  duty?: string;
  skillOrder?: string;
  verifyOrder?: string;
  notes?: string;
  refs?: ExpertRefInput[];
  skillIds?: string[];
  toolIds?: string[];
};

export type ExpertSummary = {
  id: string;
  name: string;
  color: string;
  role: string;
  enabled: boolean;
  persona: string[];
  duty: string;
  skillOrder: string;
  verifyOrder: string;
  notes: string;
  skillCount: number;
  toolCount: number;
  refCount: number;
  skillIds: string[];
  revision: number;
  updatedAt: string;
};

export type ExpertDetail = ExpertSummary & {
  toolIds: string[];
  refs: ExpertRefInput[];
  createdAt: string;
};

export type ExpertQuery = {
  q?: string;
  enabled?: boolean;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt";
};

export type ExpertReference = { id: string; name: string };

export type ExpertService = {
  create(input: CreateExpert, actor?: string): Promise<{ id: string; revision: number }>;
  update(
    id: string,
    revision: number,
    input: UpdateExpert,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  updateAggregate(
    id: string,
    revision: number,
    input: UpdateExpertAggregate,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  setEnabled(
    id: string,
    revision: number,
    enabled: boolean,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
  setSkills(
    id: string,
    revision: number,
    skillIds: string[],
    actor?: string,
  ): Promise<{ revision: number }>;
  setTools(
    id: string,
    revision: number,
    toolIds: string[],
    actor?: string,
  ): Promise<{ revision: number }>;
};

export type ExpertRead = {
  list(query: ExpertQuery): Promise<Page<ExpertSummary>>;
  get(id: string): Promise<ExpertDetail>;
  listExpertsUsingSkill(skillId: string): Promise<ExpertReference[]>;
  listExpertsUsingTool(toolId: string): Promise<ExpertReference[]>;
};
