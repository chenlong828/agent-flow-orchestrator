---
layer: design
module: expert
status: current
component: CMP-expert
updated: 2026-11-22
---

# `CMP-expert` 组件规格

## 1 主目标

维护专家聚合：角色定位、职责范围（Markdown）、人设，以及有序的 Skill 装配；它是 `expert` 及其子表、关联表的唯一写入口。

**不负责**：工作流节点、引用计数存储、Skill 本身的管理、跨资产读模型、HTTP 路由。

**过渡期（2026-11-22 起）**：工具清单、参考知识、技能配合顺序、验证顺序、任务解读已从专家语义中移除。`expert_tool` / `expert_ref` 与 `expert` 的 `skill_order` / `verify_order` / `notes` 列保留，但不再写入、读模型恒为空；`skillOrder` / `verifyOrder` / `notes` / `refs` / `toolIds` 写请求接受但忽略。UI 改造完成后删除这些列、表与字段。

## 2 拥有的数据

| 表 | 关键字段 | 说明 |
|---|---|---|
| `expert` | `id`、`name`、`color`、`role`、`enabled`、`duty`、`revision`、审计字段 | 聚合根；`duty` 为 Markdown 职责范围 |
| `expert`（过渡列） | `skill_order`、`verify_order`、`notes` | 已并入 `duty`，恒为空，不再写入；UI 改造后删列 |
| `expert_persona` | `expert_id`、`position`、`value` | 有序，级联删除 |
| `expert_skill` | `expert_id`、`skill_id`、`position` | 有序关联，`skill_id RESTRICT` |
| `expert_tool` | `expert_id`、`tool_id`、`position` | 过渡期保留、不再写入；UI 改造后删表 |
| `expert_ref` | `expert_id`、`position`、`label`、`ref_type`、`path` | 过渡期保留、不再写入；UI 改造后删表 |

不变量：

- `name` 大小写不敏感唯一；`color` 形如 `#RRGGBB`；`role` 非空。
- `duty` 是 Markdown；合并结构约定为 `## 主要职责` → `## 技能配合顺序` → `## 重点验证顺序` → `## 对承担任务的解读`，空段省略。
- 同一专家内 Skill 不重复，`position` 唯一、从 0 连续。
- 同一专家内绑定的多个 Skill，其 `slug`（DSH 技能名，客户端按此建技能目录）互不相同；重复由装配入口返回 400，不落库。
- `skill_id` 必须存在；外键失败由 store 翻译为可读错误。
- 工具与参考知识不再产生任何不变量：写请求只做形状校验（字符串/数组、去重），不校验目标存在、不落库。
- B3 起专家可被工作流节点引用：删除前经 `ReferenceGuard.check("expert")` 返回使用该专家的工作流与**未终态 run** 摘要，非空则 409 `referenced`；`workflow_expert_ref.expert_id` 与 `run_node.expert_id` 外键 `RESTRICT` 兜底并发窗口。终态 run 在 `finishRun` 已把 `run_node.expert_id` 置空。
- `refCount` 不落列，由 `catalog` 组合 `WorkflowRead.countByExperts` 计算。
- 装配替换与专家 `revision` 同一事务，不留下半套关系。

## 3 公共契约

```ts
type ExpertService = {
  create(input: CreateExpert): Promise<{ id: string; revision: number }>;
  update(id: string, revision: number, input: UpdateExpert): Promise<{ id: string; revision: number }>;
  updateAggregate(
    id: string,
    revision: number,
    input: UpdateExpertAggregate,
  ): Promise<{ revision: number }>;
  setEnabled(id: string, revision: number, enabled: boolean): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
  setSkills(id: string, revision: number, skillIds: string[]): Promise<{ revision: number }>;
  setTools(id: string, revision: number, toolIds: string[]): Promise<{ revision: number }>;
};

type ExpertRead = {
  list(query: ExpertQuery): Promise<Page<ExpertSummary>>; // 含 skillCount/toolCount/refCount/skillIds
  get(id: string): Promise<ExpertDetail>; // 详情含 skillIds/toolIds，由 catalog 解析名称
  listExpertsUsingSkill(skillId: string): Promise<ExpertReference[]>;
  listExpertsUsingTool(toolId: string): Promise<ExpertReference[]>;
  statuses(expertIds: string[]): Promise<Record<string, boolean>>;
};
```

- 输入/输出使用领域字段；不出现 HTTP DTO、SQL 列名。
- `create` 可带可选的有序 `skillIds`，与专家根同事务写入；省略则 Skill 装配为空。`toolIds` 为过渡字段：校验形状后忽略。
- `update` 是职责范围/人设/角色定位的全量替换，不接收 Skill 列表；`updateAggregate` 是聚合部分更新：省略字段不变，数组字段传入即整体替换，空数组清空，一次事务、一次递增 `revision`。`skillOrder` / `verifyOrder` / `notes` / `refs` / `toolIds` 同样只校验形状、不落库。
- `setSkills` 保留为独立装配端点；校验目标存在、无重复、顺序数组即位置；任一失败整批回滚。`setTools` 过渡期保留：校验形状后接受请求并递增 `revision`，不写 `expert_tool`。
- `listExpertsUsingSkill` / `listExpertsUsingTool` 供 `catalog` 与引用检查使用，返回专家摘要，不返回装配内部行；工具关联不再新增，`listExpertsUsingTool` 实际恒为空。
- 专家删除先经 `ReferenceGuard.check("expert")` 查工作流与未终态 run 引用；guard 非空抛 `ReferencedError`，外键冲突翻译为同码错误。`statuses` 供 `CMP-workflow` 的 `ExpertStatusReader` 端口只读查询启停状态。

### 3.1 领域类型

```ts
type ExpertRefInput = {
  label: string;
  refType: string;
  path?: string;
};

type CreateExpert = {
  name: string;
  color: string;
  role: string;
  enabled?: boolean;
  persona?: string[];
  /** Markdown 职责范围。 */
  duty?: string;
  /** @deprecated 已并入 duty；只校验形状、不落库。 */
  skillOrder?: string;
  /** @deprecated 已并入 duty；只校验形状、不落库。 */
  verifyOrder?: string;
  /** @deprecated 已并入 duty；只校验形状、不落库。 */
  notes?: string;
  /** @deprecated 参考知识已停用；只校验形状、不落库。 */
  refs?: ExpertRefInput[];
  skillIds?: string[];
  /** @deprecated 工具装配已停用；只校验形状、不落库。 */
  toolIds?: string[];
};

type UpdateExpert = Omit<CreateExpert, "enabled" | "skillIds" | "toolIds">;
type UpdateExpertAggregate = Partial<UpdateExpert> & {
  skillIds?: string[];
  toolIds?: string[];
};

type ExpertSummary = {
  id: string;
  name: string;
  color: string;
  role: string;
  enabled: boolean;
  persona: string[];
  /** Markdown 职责范围。 */
  duty: string;
  /** @deprecated 恒为空；UI 改造后移除。 */
  skillOrder: string;
  /** @deprecated 恒为空；UI 改造后移除。 */
  verifyOrder: string;
  /** @deprecated 恒为空；UI 改造后移除。 */
  notes: string;
  skillCount: number;
  /** @deprecated 恒为 0；UI 改造后移除。 */
  toolCount: number;
  refCount: number;
  skillIds: string[];
  revision: number;
  updatedAt: string;
};

type ExpertDetail = ExpertSummary & {
  /** @deprecated 恒为空数组；UI 改造后移除。 */
  toolIds: string[];
  /** @deprecated 恒为空数组；UI 改造后移除。 */
  refs: ExpertRefInput[];
  createdAt: string;
};

type ExpertQuery = {
  q?: string;
  enabled?: boolean;
  /** 只在这些专家 ID 内查询；供 catalog 按工作流过滤时传入。空数组返回空页。 */
  ids?: string[];
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt";
};

type ExpertReference = { id: string; name: string };
```

`ExpertSummary` 的 `persona` 是领域数组；`skillIds` 供 `catalog` 列表组合前 3 个 Skill 预览，REST 列表不直接暴露该字段。`refCount` 为引用该专家的去重工作流数。弃用字段由读模型固定填充空值，不从数据库回读。

### 3.2 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 事务/并发 |
|---|---|---|---|---|---|
| `create` | 创建专家、人设子表与可选 Skill 装配；弃用字段校验后忽略 | `CreateExpert` | `{ id, revision }` | `ValidationError`、`NameConflictError`、`SkillNotFoundError` | 单事务插入根、子表与装配 |
| `update` | 全量更新专家，整体替换人设；弃用字段校验后忽略 | `id`、`revision`、`UpdateExpert` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError`、`NameConflictError`、`ValidationError` | 单事务；`revision` 乐观锁 |
| `updateAggregate` | 聚合部分更新职责范围、人设与 Skill 装配；弃用字段校验后忽略 | `id`、`revision`、`UpdateExpertAggregate` | `{ revision }` | `NotFoundError`、`RevisionConflictError`、`NameConflictError`、`ValidationError`、`SkillNotFoundError` | 单事务；省略不变，数组替换，`revision` 只递增一次 |
| `setEnabled` | 启停 | `id`、`revision`、`enabled` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError` | 单行更新并递增 `revision` |
| `delete` | 删除专家 | `id`、`revision` | `void` | `NotFoundError`、`RevisionConflictError`、`ReferencedError` | 删除前查工作流与未终态 run 引用；外键 `RESTRICT` 兜底 |
| `setSkills` | 整体替换 Skill 装配 | `id`、`revision`、`skillIds[]` | `{ revision }` | `NotFoundError`、`RevisionConflictError`、`ValidationError`、`SkillNotFoundError` | 单事务；顺序即位置；重复（ID/slug）/不存在整批失败 |
| `setTools` | 过渡期兼容入口：校验形状后接受，不写装配 | `id`、`revision`、`toolIds[]` | `{ revision }` | `NotFoundError`、`RevisionConflictError`、`ValidationError` | 单事务；不校验目标存在、不写 `expert_tool`；重复仍拒绝 |
| `list` | 列表查询 | `ExpertQuery` | `Page<ExpertSummary>` | `ValidationError` | 读；含有序 `skillIds`；`ids` 在 SQL 层过滤 |
| `get` | 详情查询 | `id` | `ExpertDetail` | `NotFoundError` | 读 |
| `listExpertsUsingSkill` | 查询引用 Skill 的专家 | `skillId` | `ExpertReference[]` | 无 | 读，供 catalog/引用检查 |
| `listExpertsUsingTool` | 查询引用工具的专家 | `toolId` | `ExpertReference[]` | 无 | 读，供 catalog/引用检查 |
| `statuses` | 批量查询专家启停状态 | `expertIds[]` | `Record<string,boolean>` | 无 | 读，供工作流校验端口 |

`SkillNotFoundError` 是组件内对 Skill 装配目标不存在的可读错误，继承 `ValidationError`；工具装配已停用，不再有对应的目标错误。

`create` / `updateAggregate` / `setSkills` 在写入前通过 `SkillSlugReader` 批量读取绑定 Skill 的 `slug`；同一专家内重复时抛 `ValidationError`，`details.field` 分别为入口数组字段 `skillIds`（创建/聚合更新）与 `items`（独立装配），整批不写、`revision` 不变。

## 4 依赖与边界

- 允许：`platform` 的 `Db`；`kernel` 的 `Clock`、`IdGenerator`、错误类型、`ReferenceGuard` 与 `SkillSlugReader` 端口。
- 禁止：导入 `skill` / `tool` 组件的 store/service；直接读 `skill` / `tool` 表；在组件内拼 HTTP 响应。
- Skill 存在性由外键保证；store 翻译外键冲突。Skill 的 `slug` 通过 kernel 的 `SkillSlugReader` 只读端口获取，不读 `skill` 表。`expert_tool` 仍被 `listUsingTool` 读取（引用页兼容），但不再有写入口。
- `ExpertRead` 供 `catalog` 组合；不把领域实体直接暴露给 HTTP。

## 5 验证

- 规则：名称唯一、颜色、角色、人设顺序、Skill 装配唯一/顺序；弃用字段读空、写忽略。
- 存储：创建含职责范围 Markdown、创建即 Skill 装配、更新整体替换人设、聚合部分更新、启停、删除级联。
- 装配：整体替换 Skill；重复目标（ID 或 slug）/不存在目标；`create` / `updateAggregate` 任一步失败整批回滚；`revision` 只递增一次。工具装配请求接受但恒为空，不存在目标也不再报错。
- 装配入口断言：同一专家内 Skill `slug` 重复时 `create` / `updateAggregate` / `setSkills` 均返回 `ValidationError`，装配与 `revision` 不变。
- 读契约：列表筛选、列表含有序 `skillIds`、详情、`listExpertsUsingSkill/Tool`、`statuses`；`refCount` 与工作流引用计数一致。
- 列表候选集：`ids` 指定时只返回这些 ID 的专家，分页与 `total` 按过滤后集合计算；`ids=[]` 返回空页。`CMP-expert` 不感知工作流，候选集由 `CMP-catalog` 传入。
- 删除：被工作流或未终态 run 引用返回 `ReferencedError`，引用项 `type="workflow"`/`type="run"`；无引用 204。
- 契约：对应 REST 端点 3 正 1 反在 `http-gateway` 规格中列明；`PATCH /experts/{id}` 覆盖省略不变、数组替换、空数组清空与旧版本冲突。

## 6 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 6 KB。
- 单独验证命令：`bun test tests/components/expert`。
- 当前状态：`current`；已实现并通过契约测试，实施与验证的历史记录见 [`result.md`](../../../history/works/2026-10-24-db-backend-infra/result.md)（归档件，仅作追溯）。

## 7 B1 实现口径

- 职责范围是单一 Markdown 字段；关注视角、验证顺序等已并入其中，不再单独建列。
- 人设数量不设业务上限，只做字段级长度与请求体校验。
- 工具与参考知识的字段、表与端点处于过渡期：读恒空、写忽略，等 UI 改造完成后整体删除。
- B3 起专家可能被工作流节点引用；删除先查 `ReferenceGuard`，被工作流或未终态 run 引用返回 409 `referenced`，外键 `RESTRICT` 兜底。
