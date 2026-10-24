---
layer: design
module: expert
status: current
component: CMP-expert
updated: 2026-10-25
---

# `CMP-expert` 组件规格

## 1 主目标

维护专家聚合：五区字段、人设、引用资料，以及有序的 Skill/工具装配；它是 `expert` 及其子表、关联表的唯一写入口。

**不负责**：工作流节点、引用计数存储、Skill/工具本身的管理、跨资产读模型、HTTP 路由。

## 2 拥有的数据

| 表 | 关键字段 | 说明 |
|---|---|---|
| `expert` | `id`、`name`、`color`、`role`、`enabled`、`duty`、`skill_order`、`verify_order`、`notes`、`revision`、审计字段 | 聚合根 |
| `expert_persona` | `expert_id`、`position`、`value` | 有序，级联删除 |
| `expert_skill` | `expert_id`、`skill_id`、`position` | 有序关联，`skill_id RESTRICT` |
| `expert_tool` | `expert_id`、`tool_id`、`position` | 有序关联，`tool_id RESTRICT` |
| `expert_ref` | `expert_id`、`position`、`label`、`ref_type`、`path` | 有序，级联删除 |

不变量：

- `name` 大小写不敏感唯一；`color` 形如 `#RRGGBB`；`role` 非空。
- 同一专家内 Skill/工具不重复，`position` 唯一、从 0 连续。
- `skill_id` / `tool_id` 必须存在；外键失败由 store 翻译为可读错误。
- B1 没有工作流节点引用，专家允许删除；`refCount` 查询返回 0，不落列。
- 装配替换与专家 `revision` 同一事务，不留下半套关系。

## 3 公共契约

```ts
type ExpertService = {
  create(input: CreateExpert): Promise<{ id: string; revision: number }>;
  update(id: string, revision: number, input: UpdateExpert): Promise<{ id: string; revision: number }>;
  setEnabled(id: string, revision: number, enabled: boolean): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
  setSkills(id: string, revision: number, skillIds: string[]): Promise<{ revision: number }>;
  setTools(id: string, revision: number, toolIds: string[]): Promise<{ revision: number }>;
};

type ExpertRead = {
  list(query: ExpertQuery): Promise<Page<ExpertSummary>>; // 含 skillCount/toolCount/refCount
  get(id: string): Promise<ExpertDetail>; // 详情含 skillIds/toolIds，由 catalog 解析名称
  listExpertsUsingSkill(skillId: string): Promise<ExpertReference[]>;
  listExpertsUsingTool(toolId: string): Promise<ExpertReference[]>;
};
```

- 输入/输出使用领域字段；不出现 HTTP DTO、SQL 列名。
- `create` / `update` 不接收 Skill/工具列表；装配走 `setSkills` / `setTools`，两者各自原子替换并递增 `revision`。
- `setSkills` / `setTools` 校验目标存在、无重复、顺序数组即位置；任一失败整批回滚。
- `listExpertsUsingSkill` / `listExpertsUsingTool` 供 `catalog` 与引用检查使用，返回专家摘要，不返回装配内部行。
- B1 专家删除不做引用检查；后续出现节点引用时再补。

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
  duty?: string;
  skillOrder?: string;
  verifyOrder?: string;
  notes?: string;
  refs?: ExpertRefInput[];
};

type UpdateExpert = Omit<CreateExpert, "enabled">;

type ExpertSummary = {
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
  revision: number;
  updatedAt: string;
};

type ExpertDetail = ExpertSummary & {
  skillIds: string[];
  toolIds: string[];
  refs: ExpertRefInput[];
  createdAt: string;
};

type ExpertQuery = {
  q?: string;
  enabled?: boolean;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt";
};

type ExpertReference = { id: string; name: string };
```

`ExpertSummary` 的 `persona` 是领域数组；REST DTO 也按数组返回。`refCount` B1 恒为 0。

### 3.2 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 事务/并发 |
|---|---|---|---|---|---|
| `create` | 创建专家与五区子表 | `CreateExpert` | `{ id, revision }` | `ValidationError`、`NameConflictError` | 单事务插入根与子表 |
| `update` | 更新专家，整体替换人设/引用 | `id`、`revision`、`UpdateExpert` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError`、`NameConflictError`、`ValidationError` | 单事务；`revision` 乐观锁 |
| `setEnabled` | 启停 | `id`、`revision`、`enabled` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError` | 单行更新并递增 `revision` |
| `delete` | 删除专家 | `id`、`revision` | `void` | `NotFoundError`、`RevisionConflictError` | B1 无引用保护 |
| `setSkills` | 整体替换 Skill 装配 | `id`、`revision`、`skillIds[]` | `{ revision }` | `NotFoundError`、`RevisionConflictError`、`ValidationError`、`SkillNotFoundError` | 单事务；顺序即位置；重复/不存在整批失败 |
| `setTools` | 整体替换工具装配 | `id`、`revision`、`toolIds[]` | `{ revision }` | `NotFoundError`、`RevisionConflictError`、`ValidationError`、`ToolNotFoundError` | 单事务；顺序即位置；重复/不存在整批失败 |
| `list` | 列表查询 | `ExpertQuery` | `Page<ExpertSummary>` | `ValidationError` | 读 |
| `get` | 详情查询 | `id` | `ExpertDetail` | `NotFoundError` | 读 |
| `listExpertsUsingSkill` | 查询引用 Skill 的专家 | `skillId` | `ExpertReference[]` | 无 | 读，供 catalog/引用检查 |
| `listExpertsUsingTool` | 查询引用工具的专家 | `toolId` | `ExpertReference[]` | 无 | 读，供 catalog/引用检查 |

`SkillNotFoundError` / `ToolNotFoundError` 是组件内对装配目标不存在的可读错误，继承 `ValidationError`。

## 4 依赖与边界

- 允许：`platform` 的 `Db`；`kernel` 的 `Clock`、`IdGenerator` 与错误类型。
- 禁止：导入 `skill` / `tool` 组件的 store/service；直接读 `skill` / `tool` 表；在组件内拼 HTTP 响应。
- Skill/工具存在性由外键保证；store 翻译外键冲突，不跨组件查表。
- `ExpertRead` 供 `catalog` 组合；不把领域实体直接暴露给 HTTP。

## 5 验证

- 规则：名称唯一、颜色、角色、人设顺序、装配唯一/顺序。
- 存储：创建五区、更新整体替换人设/引用、启停、删除级联。
- 装配：整体替换 Skill/工具；重复/不存在目标；事务回滚；`revision` 递增。
- 读契约：列表筛选、详情、`listExpertsUsingSkill/Tool`、`refCount=0`。
- 契约：对应 REST 端点 3 正 1 反在 `http-gateway` 规格中列明。

## 6 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 6 KB，实现后核算。
- 单独验证命令（实现后）：`bun test tests/components/expert`。
- 当前状态：`current`；已实现并通过契约测试，验证入口见 [`result.md`](../../../works/2026-10-24-db-backend-infra/result.md)。

## 7 未决

- 专家「关注视角」是否独立字段；当前由 `role` / `notes` 承接。
- 人设/引用数量上限无 UI 依据，暂不设业务上限。
- B1 专家删除直接允许；后续节点引用保护另立设计。
