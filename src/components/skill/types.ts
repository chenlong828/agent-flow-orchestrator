import type { Page, PageQuery } from "../../core/kernel/index.ts";

export type SkillSectionKind =
  | "overview"
  | "steps"
  | "examples"
  | "scripts"
  | "verification";

export type SkillSections = {
  overview: string;
  steps: string;
  examples: string;
  scripts: string;
  verification: string;
};

export type SkillRefInput = {
  label: string;
  refType: string;
  path?: string;
};

export type CreateSkill = {
  name: string;
  categoryCode: string;
  summary: string;
  tags?: string[];
  triggers?: string[];
  sections: SkillSections;
  pitfalls?: string[];
  refs?: SkillRefInput[];
  enabled?: boolean;
};

export type UpdateSkill = Omit<CreateSkill, "enabled">;

export type SkillSummary = {
  id: string;
  name: string;
  categoryCode: string;
  summary: string;
  version: string;
  enabled: boolean;
  tags: string[];
  triggers: string[];
  revision: number;
  updatedAt: string;
};

export type SkillDetail = SkillSummary & {
  sections: SkillSections;
  pitfalls: string[];
  refs: SkillRefInput[];
  createdAt: string;
};

export type SkillCategory = {
  code: string;
  label: string;
  position: number;
};

export type SkillQuery = {
  q?: string;
  categoryCode?: string;
  tag?: string;
  enabled?: boolean;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt" | "version" | "-version";
};

export type SkillService = {
  create(
    input: CreateSkill,
    actor?: string,
  ): Promise<{ id: string; revision: number; version: string }>;
  update(
    id: string,
    revision: number,
    input: UpdateSkill,
    actor?: string,
  ): Promise<{ id: string; revision: number; version: string }>;
  setEnabled(
    id: string,
    revision: number,
    enabled: boolean,
    actor?: string,
  ): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
};

export type SkillRead = {
  list(query: SkillQuery): Promise<Page<SkillSummary>>;
  get(id: string): Promise<SkillDetail>;
  getSummary(id: string): Promise<SkillSummary>;
  listCategories(): Promise<SkillCategory[]>;
};
