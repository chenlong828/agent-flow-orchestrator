import type {
  Clock,
  IdGenerator,
  Page,
  PageQuery,
  ReferenceGuard,
  RevisionedLifecycle,
  SkillSlugReader,
} from "../../core/kernel/index.ts";
import type { Db } from "../../core/platform/index.ts";

export type ExpertDeps = {
  db: Db;
  clock: Clock;
  ids: IdGenerator;
  actor: string;
  guard: ReferenceGuard;
  skillSlugs: SkillSlugReader;
};

export type ExpertRefInput = {
  label: string;
  refType: string;
  path?: string;
};

type ExpertCreatePatch = {
  enabled?: boolean;
  persona?: string[];
  duty?: string;
  /** @deprecated 已并入 duty；过渡期只校验类型、不落库。 */
  skillOrder?: string;
  /** @deprecated 已并入 duty；过渡期只校验类型、不落库。 */
  verifyOrder?: string;
  /** @deprecated 已并入 duty；过渡期只校验类型、不落库。 */
  notes?: string;
  /** @deprecated 参考知识已停用；过渡期只校验类型、不落库。 */
  refs?: ExpertRefInput[];
  skillIds?: string[];
  /** @deprecated 工具装配已停用；过渡期只校验类型、不落库。 */
  toolIds?: string[];
};

export type CreateExpert = {
  name: string;
  color: string;
  role: string;
} & ExpertCreatePatch;

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
  /** 职责范围，Markdown；集成原职责、技能配合顺序、重点验证顺序与任务解读。 */
  duty: string;
  /** @deprecated 已并入 duty；过渡期恒为空，UI 改造后移除。 */
  skillOrder: string;
  /** @deprecated 已并入 duty；过渡期恒为空，UI 改造后移除。 */
  verifyOrder: string;
  /** @deprecated 已并入 duty；过渡期恒为空，UI 改造后移除。 */
  notes: string;
  skillCount: number;
  /** @deprecated 工具装配已停用；过渡期恒为 0，UI 改造后移除。 */
  toolCount: number;
  refCount: number;
  skillIds: string[];
  revision: number;
  updatedAt: string;
};

export type ExpertDetail = ExpertSummary & {
  /** @deprecated 工具装配已停用；过渡期恒为空数组，UI 改造后移除。 */
  toolIds: string[];
  /** @deprecated 参考知识已停用；过渡期恒为空数组，UI 改造后移除。 */
  refs: ExpertRefInput[];
  createdAt: string;
};

export type ExpertQuery = {
  q?: string;
  enabled?: boolean;
  /** 只在这些专家 ID 内查询；供 catalog 按工作流过滤时传入。空数组返回空页。 */
  ids?: string[];
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
} & RevisionedLifecycle;

export type ExpertRead = {
  list(query: ExpertQuery): Promise<Page<ExpertSummary>>;
  get(id: string): Promise<ExpertDetail>;
  listExpertsUsingSkill(skillId: string): Promise<ExpertReference[]>;
  listExpertsUsingTool(toolId: string): Promise<ExpertReference[]>;
  statuses(expertIds: string[]): Promise<Record<string, boolean>>;
};
