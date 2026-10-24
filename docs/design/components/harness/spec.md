---
layer: design
module: harness
status: current
component: CMP-harness
updated: 2026-10-25
---

# `CMP-harness` 组件规格

## 1 主目标

维护 Harness 聚合的生命周期、标签与不变量；它是 `harness` / `harness_tag` 的唯一写入口。

**不负责**：工具管理、健康心跳推进、跨资产读模型、HTTP 路由。

## 2 拥有的数据

| 表 | 关键字段 | 说明 |
|---|---|---|
| `harness` | `id`、`name`、`kind`、`address`、`access_mode`、`description`、`concurrency_max`、`queue_policy`、`enabled`、`health`、`last_heartbeat_at`、`revision`、审计字段 | 聚合根 |
| `harness_tag` | `harness_id`、`position`、`tag` | 有序子实体，随 Harness 级联删除 |

不变量：

- `name` 大小写不敏感唯一。
- `kind ∈ container / server / desktop / laptop`。
- `access_mode ∈ agent / ssh / container_registry`。
- `queue_policy ∈ fifo / priority`；`concurrency_max ≥ 1`。
- 新对象 `health=unknown`、`last_heartbeat_at=null`；客户端不可写。
- 有工具引用时不可删除；删除前调用 `ReferenceGuard`，非空抛 `ReferencedError`。
- 标签同 Harness 内唯一、按 `position` 连续；数量上限在表级设计确认。

## 3 公共契约

```ts
type HarnessService = {
  create(input: CreateHarness): Promise<{ id: string; revision: number }>;
  update(id: string, revision: number, input: UpdateHarness): Promise<{ id: string; revision: number }>;
  setEnabled(id: string, revision: number, enabled: boolean): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
};

type HarnessRead = {
  list(query: HarnessQuery): Promise<Page<HarnessSummary>>;
  get(id: string): Promise<HarnessDetail>;
};
```

- 输入/输出使用领域字段（`camelCase`），不出现 HTTP 状态码、DTO 包装、SQL 列名。
- `delete` 先 `ReferenceGuard.check("harness", id)`；有引用直接抛 `ReferencedError`，不先删。
- 版本冲突抛 `RevisionConflictError`；不存在抛 `NotFoundError`；名称冲突抛 `NameConflictError`。
- `health` / `lastHeartbeatAt` 不在写契约中；只由未来执行器更新，B1 保持默认值。

### 3.1 领域类型

```ts
type HarnessKind = "container" | "server" | "desktop" | "laptop";
type HarnessAccessMode = "agent" | "ssh" | "container_registry";
type HarnessHealth = "unknown" | "online" | "offline" | "overloaded";
type QueuePolicy = "fifo" | "priority";

type CreateHarness = {
  name: string;
  kind: HarnessKind;
  address: string;
  accessMode: HarnessAccessMode;
  description?: string;
  concurrencyMax: number;
  queuePolicy: QueuePolicy;
  tags?: string[];
  enabled?: boolean;
};

type UpdateHarness = Omit<CreateHarness, "enabled">;

type HarnessSummary = {
  id: string;
  name: string;
  kind: HarnessKind;
  address: string;
  accessMode: HarnessAccessMode;
  enabled: boolean;
  health: HarnessHealth;
  lastHeartbeatAt: string | null;
  concurrencyMax: number;
  queuePolicy: QueuePolicy;
  tags: string[];
  revision: number;
  updatedAt: string;
};

type HarnessDetail = HarnessSummary & {
  description: string;
  createdAt: string;
};

type HarnessQuery = {
  q?: string;
  kind?: HarnessKind;
  enabled?: boolean;
  health?: HarnessHealth;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt";
};
```

`HarnessSummary` 不包含 `toolCount`；该字段由 `catalog` 组合时计算。`lastHeartbeatAt` 只读，B1 不提供推进接口。

### 3.2 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 事务/并发 |
|---|---|---|---|---|---|
| `create` | 创建 Harness 与标签 | `CreateHarness` | `{ id, revision }` | `ValidationError`、`NameConflictError` | 单事务插入根与标签 |
| `update` | 更新 Harness，整体替换标签 | `id`、`revision`、`UpdateHarness` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError`、`NameConflictError`、`ValidationError` | 单事务；`revision` 乐观锁 |
| `setEnabled` | 启停 | `id`、`revision`、`enabled` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError` | 单行更新并递增 `revision` |
| `delete` | 删除 Harness | `id`、`revision` | `void` | `NotFoundError`、`RevisionConflictError`、`ReferencedError` | 先 `ReferenceGuard`，再删除；同一事务 |
| `list` | 列表查询 | `HarnessQuery` | `Page<HarnessSummary>` | `ValidationError` | 读 |
| `get` | 详情查询 | `id` | `HarnessDetail` | `NotFoundError` | 读 |

方法定义是本组件的权威来源；`http-gateway` 只把 DTO 映射到这些方法，不定义业务方法。

## 4 依赖与边界

- 允许：`platform` 的 `Db`；`kernel` 的 `Clock`、`IdGenerator`、`ReferenceGuard` 端口与错误类型。
- 禁止：导入 `tool` 组件的 store/service；直接读 `tool` 表；在组件内拼 HTTP 响应。
- `HarnessRead` 供 `catalog` 组合使用；不把领域实体直接暴露给 HTTP。

## 5 验证

- 规则：名称唯一、枚举、`concurrencyMax` 下限、标签顺序/唯一。
- 存储：创建带标签、更新整体替换标签、启停、删除级联。
- 删除保护：注入假的 `ReferenceGuard` 返回工具列表，断言不删除并抛 `ReferencedError`。
- 读契约：列表筛选/分页/排序、详情。`toolCount` 由 `catalog` 通过工具读契约组合，Harness 组件不读工具表。
- 契约：对应 REST 端点的 3 正 1 反在 `http-gateway` 规格中列明。

## 6 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 5 KB。
- 单独验证命令：`bun test tests/components/harness`。
- 当前状态：`current`；已实现并通过契约测试，验证入口见 [`result.md`](../../../works/2026-10-24-db-backend-infra/result.md)。

## 7 B1 实现口径

- 保留 `health=overloaded` 枚举，用于外部界面的「高负载」展示。
- `harness_tag` 不设业务数量上限，只做字段级长度与请求体校验。
