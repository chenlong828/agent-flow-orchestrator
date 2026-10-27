---
layer: design
module: tool
status: current
component: CMP-tool
updated: 2026-10-25
---

# `CMP-tool` 组件规格

## 1 主目标

维护工具聚合：登记信息、参数、Harness 归属与删除保护；它是 `tool` / `tool_param` 的唯一写入口。

**不负责**：工具调试执行、状态推进、Harness 管理、跨资产读模型、HTTP 路由。

## 2 拥有的数据

| 表 | 关键字段 | 说明 |
|---|---|---|
| `tool` | `id`、`name`、`kind`、`invocation`、`description`、`harness_id`、`timeout_ms`、`status`、`last_debug_at`、`revision`、审计字段 | 聚合根；无启停字段 |
| `tool_param` | `tool_id`、`position`、`param_key`、`param_type`、`description` | 有序子实体，随工具级联删除 |

不变量：

- `name` 大小写不敏感唯一。
- `kind ∈ mcp / cli / script`。
- `harness_id` 必须指向存在的 Harness；外键 `RESTRICT`，删除 Harness 被工具引用时拒绝。
- `timeout_ms` 在 1 秒～10 分钟之间。
- 新对象 `status=unverified`、`last_debug_at=null`；B1 客户端不可写，不提供启停。
- 参数同工具内 `param_key` 唯一、按 `position` 连续、`param_type ∈ string / int`。
- 有专家引用时不可删除；删除前调用 `ReferenceGuard`，非空抛 `ReferencedError`。

## 3 公共契约

```ts
type ToolService = {
  create(input: CreateTool): Promise<{ id: string; revision: number }>;
  update(id: string, revision: number, input: UpdateTool): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
};

type ToolRead = {
  list(query: ToolQuery): Promise<Page<ToolSummary>>;
  get(id: string): Promise<ToolDetail>;
  getSummary(id: string): Promise<ToolSummary>;
  listByHarness(harnessId: string): Promise<ToolRef[]>;
};
```

- 输入/输出使用领域字段；不出现 HTTP DTO、SQL 列名。
- Harness 存在性由外键保证；store 把外键冲突翻译为 `HarnessNotFoundError`，service 映射为可读错误，不跨组件查 Harness 表。
- `delete` 先 `ReferenceGuard.check("tool", id)`；有引用不删除。
- `status` / `last_debug_at` 不在写契约中；B1 不提供调试或标记可用入口。

### 3.1 领域类型

```ts
type ToolKind = "mcp" | "cli" | "script";
type ToolStatus = "unverified" | "available" | "unavailable";
type ToolParamType = "string" | "int";

type ToolParamInput = {
  paramKey: string;
  type: ToolParamType;
  description?: string;
};

type CreateTool = {
  name: string;
  kind: ToolKind;
  invocation: string;
  description?: string;
  harnessId: string;
  timeoutMs: number;
  params?: ToolParamInput[];
};

type UpdateTool = CreateTool;

type ToolParam = ToolParamInput & { position: number };

type ToolSummary = {
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

type ToolDetail = ToolSummary & {
  createdAt: string;
};

type ToolQuery = {
  q?: string;
  kind?: ToolKind;
  status?: ToolStatus;
  harnessId?: string;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt";
};

type ToolRef = { id: string; name: string };
```

`ToolSummary` 不包含 `harnessName` / `paramCount`；两者由 `catalog` 组合。`status` / `lastDebugAt` 只读，B1 不提供调试或标记可用方法。

### 3.2 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 事务/并发 |
|---|---|---|---|---|---|
| `create` | 创建工具与参数 | `CreateTool` | `{ id, revision }` | `ValidationError`、`NameConflictError`、`HarnessNotFoundError` | 单事务插入根与参数 |
| `update` | 更新工具，整体替换参数 | `id`、`revision`、`UpdateTool` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError`、`NameConflictError`、`ValidationError`、`HarnessNotFoundError` | 单事务；`revision` 乐观锁 |
| `delete` | 删除工具 | `id`、`revision` | `void` | `NotFoundError`、`RevisionConflictError`、`ReferencedError` | 先 `ReferenceGuard`，再删除 |
| `list` | 列表查询 | `ToolQuery` | `Page<ToolSummary>` | `ValidationError` | 读 |
| `get` | 详情查询 | `id` | `ToolDetail` | `NotFoundError` | 读 |
| `getSummary` | 摘要查询，供 catalog 使用 | `id` | `ToolSummary` | `NotFoundError` | 读 |
| `listByHarness` | 查询 Harness 下工具，供引用页使用 | `harnessId` | `ToolRef[]` | 无 | 读 |

`HarnessNotFoundError` 是组件内对“`harnessId` 指向不存在的 Harness”的可读错误，继承 `ValidationError`；不跨组件查 Harness 表。

## 4 依赖与边界

- 允许：`platform` 的 `Db`；`kernel` 的 `Clock`、`IdGenerator`、`ReferenceGuard` 端口与错误类型。
- 禁止：导入 `harness` / `expert` 组件的 store/service；直接读 `harness` / `expert_skill` / `expert_tool` 表；在组件内拼 HTTP 响应。
- `ToolRead` 供 `catalog` 组合使用；不把领域实体直接暴露给 HTTP。

## 5 验证

- 规则：名称唯一、Kind、超时范围、参数键唯一/顺序。
- 存储：创建带参数、更新整体替换参数、删除级联；Harness 外键失败映射。
- 删除保护：假的 `ReferenceGuard` 返回专家列表，断言不删除并抛 `ReferencedError`。
- 读契约：列表按类型/状态/Harness 筛选、详情、`getSummary`、`listByHarness`。
- 契约：对应 REST 端点 3 正 1 反在 `http-gateway` 规格中列明。

## 6 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 5 KB。
- 单独验证命令：`bun test tests/components/tool`。
- 当前状态：`current`；已实现并通过契约测试，实施与验证的历史记录见 [`result.md`](../../../history/works/2026-10-24-db-backend-infra/result.md)（归档件，仅作追溯）。

## 7 B1 实现口径

- 种子允许写 `available` / `unavailable` 作为外部夹具演示值；通过 API 新建的工具保持 `unverified`。
- 参数不设业务数量上限，只做字段级长度与请求体校验。
