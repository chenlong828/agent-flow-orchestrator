---
layer: design
module: skill
status: current
component: CMP-skill
updated: 2026-10-25
---

# `CMP-skill` 组件规格

## 1 主目标

维护 Skill 聚合：分类引用、五章、标签、触发词、踩坑、引用资料与版本递增；它是 `skill` 及其子表的唯一写入口。

**不负责**：专家装配、版本历史、跨资产读模型、HTTP 路由。

## 2 拥有的数据

| 表 | 关键字段 | 说明 |
|---|---|---|
| `skill_category` | `code`、`label`、`position` | 参考数据，种子只读，无写接口 |
| `skill` | `id`、`name`、`category_code`、`summary`、`version`、`enabled`、`revision`、审计字段 | 聚合根 |
| `skill_tag` | `skill_id`、`position`、`tag` | 有序，级联删除 |
| `skill_trigger` | `skill_id`、`position`、`keyword` | 有序，唯一 |
| `skill_section` | `skill_id`、`kind`、`content_md` | 固定五章，恰好五条 |
| `skill_pitfall` | `skill_id`、`position`、`content` | 有序，级联删除 |
| `skill_ref` | `skill_id`、`position`、`label`、`ref_type`、`path` | 有序，`path` 可空 |

不变量：

- `name` 大小写不敏感唯一；`category_code` 必须存在。
- `summary` ≤200 字。
- `version` 形如 `vX.Y`；API 新建 `v1.0`；每次保存 minor+1；若 minor 超过 9，则 major+1、minor=0（如 `v1.9` → `v2.0`）；客户端不可写；种子保留 UI 版本。
- 五章齐全：`overview / steps / examples / scripts / verification`。
- 标签/触发词/踩坑/引用有序；标签与触发词各自唯一；章节主键 `(skill_id, kind)`。
- 有专家引用时不可删除；删除前调用 `ReferenceGuard`，非空抛 `ReferencedError`。
- B1 不建版本历史表。

## 3 公共契约

```ts
type SkillService = {
  create(input: CreateSkill): Promise<{ id: string; revision: number; version: string }>;
  update(id: string, revision: number, input: UpdateSkill): Promise<{ id: string; revision: number; version: string }>;
  setEnabled(id: string, revision: number, enabled: boolean): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
};

type SkillRead = {
  list(query: SkillQuery): Promise<Page<SkillSummary>>;
  get(id: string): Promise<SkillDetail>;
  getSummary(id: string): Promise<SkillSummary>;
  listCategories(): Promise<SkillCategory[]>;
};
```

- 输入/输出使用领域字段；不出现 HTTP DTO、SQL 列名。
- `update` 时服务端计算新版本；客户端不能传 `version` 覆盖。
- 五章输入必须是完整对象；缺章抛 `ValidationError`，不做部分更新。
- `delete` 先 `ReferenceGuard.check("skill", id)`；有引用不删除。

### 3.1 领域类型

```ts
type SkillSectionKind = "overview" | "steps" | "examples" | "scripts" | "verification";

type SkillSections = {
  overview: string;
  steps: string;
  examples: string;
  scripts: string;
  verification: string;
};

type SkillRefInput = {
  label: string;
  refType: string;
  path?: string;
};

type CreateSkill = {
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

type UpdateSkill = Omit<CreateSkill, "enabled">;

type SkillSummary = {
  id: string;
  name: string;
  categoryCode: string;
  summary: string;
  version: string;
  enabled: boolean;
  tags: string[];
  revision: number;
  updatedAt: string;
};

type SkillDetail = SkillSummary & {
  triggers: string[];
  sections: SkillSections;
  pitfalls: string[];
  refs: SkillRefInput[];
  createdAt: string;
};

type SkillCategory = {
  code: string;
  label: string;
  position: number;
};

type SkillQuery = {
  q?: string;
  categoryCode?: string;
  tag?: string;
  enabled?: boolean;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt";
};
```

`SkillSummary` 不包含 `usedByCount`；由 `catalog` 组合。`version` 由服务端计算，客户端不可写。

### 3.2 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 事务/并发 |
|---|---|---|---|---|---|
| `create` | 创建 Skill 与全部子表 | `CreateSkill` | `{ id, revision, version }` | `ValidationError`、`NameConflictError`、`CategoryNotFoundError` | 单事务；新建 `v1.0` |
| `update` | 更新 Skill，整体替换子表 | `id`、`revision`、`UpdateSkill` | `{ id, revision, version }` | `NotFoundError`、`RevisionConflictError`、`NameConflictError`、`ValidationError`、`CategoryNotFoundError` | 单事务；`revision` 乐观锁；版本按规则递增 |
| `setEnabled` | 启停 | `id`、`revision`、`enabled` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError` | 单行更新并递增 `revision` |
| `delete` | 删除 Skill | `id`、`revision` | `void` | `NotFoundError`、`RevisionConflictError`、`ReferencedError` | 先 `ReferenceGuard`，再删除 |
| `list` | 列表查询 | `SkillQuery` | `Page<SkillSummary>` | `ValidationError` | 读 |
| `get` | 详情查询 | `id` | `SkillDetail` | `NotFoundError` | 读 |
| `getSummary` | 摘要查询，供 catalog 使用 | `id` | `SkillSummary` | `NotFoundError` | 读 |
| `listCategories` | 分类参考数据 | 无 | `SkillCategory[]` | 无 | 读 |

`CategoryNotFoundError` 是组件内对“`categoryCode` 不存在”的可读错误，继承 `ValidationError`。

## 4 依赖与边界

- 允许：`platform` 的 `Db`；`kernel` 的 `Clock`、`IdGenerator`、`ReferenceGuard` 端口与错误类型。
- 禁止：导入 `expert` 组件的 store/service；直接读 `expert_skill` 表；在组件内拼 HTTP 响应。
- `skill_category` 只读；种子由迁移/种子脚本写入，Skill 服务不提供 CRUD。
- `SkillRead` 供 `catalog` 组合；不把领域实体直接暴露给 HTTP。

## 5 验证

- 规则：名称唯一、分类存在、摘要长度、五章完整、版本进位、子表唯一/顺序。
- 存储：创建完整五章、更新整体替换子表、启停、删除级联。
- 删除保护：假的 `ReferenceGuard` 返回专家列表，断言不删除并抛 `ReferencedError`。
- 读契约：列表按分类/标签/启停筛选、详情、`getSummary`、分类列表。
- 契约：对应 REST 端点 3 正 1 反在 `http-gateway` 规格中列明。

## 6 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 6 KB，实现后核算。
- 单独验证命令（实现后）：`bun test tests/components/skill`。
- 当前状态：`current`；已实现并通过契约测试，验证入口见 [`result.md`](../../../works/2026-10-24-db-backend-infra/result.md)。

## 7 未决

- `skill_category` 的 4 个代码与中文标签在表级设计确认。
- `ref_type` 是否固定枚举，还是先按 UI 夹具存文本；API 契约先按字符串。
- 标签/触发词/踩坑/引用数量上限无 UI 依据，暂不设业务上限。
