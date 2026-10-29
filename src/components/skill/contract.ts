import type { FileData, Page, PageQuery } from "../../core/kernel/index.ts";

export type SkillSummary = {
  id: string;
  name: string;
  categoryCode: string;
  description: string;
  version: string;
  enabled: boolean;
  tags: string[];
  revision: number;
  updatedAt: string;
};

export type SkillFile = {
  path: string;
  size: number;
  readOnly: boolean;
};

export type SkillDetail = SkillSummary & {
  body: string;
  files: SkillFile[];
  createdAt: string;
};

export type SkillQuery = {
  q?: string;
  categoryCode?: string;
  tag?: string;
  enabled?: boolean;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt" | "version" | "-version";
};

export type SkillDocument = {
  markdown: string;
  revision: number;
};

export type SkillPackage = {
  fileName: string;
  data: Uint8Array;
};

export type SkillDraft = {
  id: string;
  skillId: string | null;
  baseRevision: number | null;
  baseVersion: string | null;
  expiresAt: string;
  createdAt: string;
  files: SkillFile[];
};

export type DraftFile = SkillFile;

export type DraftFileResult = {
  file: DraftFile;
  files: DraftFile[];
};

export type SkillCategory = {
  code: string;
  label: string;
  position: number;
};

export type SkillRead = {
  list(query: SkillQuery): Promise<Page<SkillSummary>>;
  get(id: string): Promise<SkillDetail>;
  getSummary(id: string): Promise<SkillSummary>;
  getDocument(id: string): Promise<SkillDocument>;
  getPackage(id: string): Promise<SkillPackage>;
  listCategories(): Promise<SkillCategory[]>;
};

export type SaveSkill = {
  name: string;
  categoryCode: string;
  description: string;
  tags?: string[];
  body: string;
};

export type SaveSkillResult = {
  id: string;
  revision: number;
  version: string;
};

export type SkillDraftService = {
  createDraft(skillId: string | null, actor?: string | null): Promise<SkillDraft>;
  getDraft(id: string): Promise<SkillDraft>;
  uploadDraftFile(
    id: string,
    path: string,
    data: FileData,
  ): Promise<DraftFileResult>;
  renameDraftFile(
    id: string,
    path: string,
    newPath: string,
  ): Promise<DraftFileResult>;
  deleteDraftFile(id: string, path: string): Promise<void>;
  cancelDraft(id: string): Promise<void>;
  saveDraft(
    id: string,
    baseRevision: number | null,
    input: SaveSkill,
    actor?: string | null,
  ): Promise<SaveSkillResult>;
  setEnabled(
    id: string,
    revision: number,
    enabled: boolean,
    actor?: string | null,
  ): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
  gc(graceMs?: number): Promise<{ packages: number; drafts: number }>;
};
