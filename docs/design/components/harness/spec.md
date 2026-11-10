---
layer: design
module: harness
status: current
component: CMP-harness
updated: 2026-11-10
---

# `CMP-harness` 组件规格

## 1 主目标

维护 Harness 聚合的生命周期、标签与不变量，并作为**执行节点目录**：一个 Harness 绑定一个 client 节点（`clientId`），供执行面判定「这个节点还能不能接活」。它是 `harness` / `harness_tag` 的唯一写入口。

**不负责**：工具管理、在线状态推进（由 `CMP-scheduler` 的 poll 观测派生，见 §3.3）、任务派发、跨资产读模型、HTTP 路由、client 自注册（`executor-http-v2` 没有注册端点）。

## 2 拥有的数据

| 表 | 关键字段 | 说明 |
|---|---|---|
| `harness` | `id`、`name`、`kind`、`address`、`access_mode`、`description`、`concurrency_max`、`queue_policy`、`enabled`、`client_id`、`health`、`last_heartbeat_at`、`revision`、审计字段 | 聚合根；`client_id` 是节点目录绑定，可空、唯一 |
| `harness_tag` | `harness_id`、`position`、`tag` | 有序子实体，随 Harness 级联删除 |

不变量：

- `name` 大小写不敏感唯一。
- `kind ∈ container / server / desktop / laptop`。
- `access_mode ∈ agent / ssh / container_registry`。
- `queue_policy ∈ fifo / priority`；`concurrency_max ≥ 1`。
- 新对象 `health=unknown`、`last_heartbeat_at=null`；**两列保留但不再作为权威**：对外读值由 `catalog` 按 `CMP-scheduler` 的 presence 派生（§3.3），本组件不写这两列。
- `client_id` 可空、全局唯一（非空时唯一）；绑定后同一节点不允许再绑第二个 Harness。空串视为未绑定，与 `null` 等价。
- `client_id` 只能经 `bindClient` / `unbindClient` 修改，不进入 `create` / `update`：避免全量 `PUT` 漏传即解绑。
- 有工具引用时不可删除；删除前调用 `ReferenceGuard`，非空抛 `ReferencedError`。
- 标签同 Harness 内唯一、按 `position` 连续；数量上限在表级设计确认。

## 3 公共契约

```ts
type HarnessService = {
  create(input: CreateHarness): Promise<{ id: string; revision: number }>;
  update(id: string, revision: number, input: UpdateHarness): Promise<{ id: string; revision: number }>;
  setEnabled(id: string, revision: number, enabled: boolean): Promise<{ id: string; revision: number }>;
  /** 绑定/换绑执行节点；同一 clientId 不能被两个 Harness 占用。 */
  bindClient(id: string, revision: number, clientId: string): Promise<{ id: string; revision: number }>;
  /** 解绑：节点回到未登记状态，不再参与执行面派发。 */
  unbindClient(id: string, revision: number): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
};

/** 节点目录端口实现（kernel.NodeDirectory），供 scheduler 派发前校验。 */
type HarnessNodeDirectory = {
  /** 节点存在、已绑定 clientId、enabled；未知 clientId 返回 false。 */
  isDispatchable(clientId: string): Promise<boolean>;
  /** 已绑定且 enabled 的 clientId 列表；启动校验与排障用。 */
  listClientIds(): Promise<string[]>;
};

type HarnessRead = {
  list(query: HarnessQuery): Promise<Page<HarnessSummary>>;
  get(id: string): Promise<HarnessDetail>;
  /** 按执行节点反查；未绑定返回 null。供 NodeDirectory 实现使用。 */
  getByClientId(clientId: string): Promise<HarnessSummary | null>;
};
```

- 输入/输出使用领域字段（`camelCase`），不出现 HTTP 状态码、DTO 包装、SQL 列名。
- `delete` 先 `ReferenceGuard.check("harness", id)`；有引用直接抛 `ReferencedError`，不先删。
- 版本冲突抛 `RevisionConflictError`；不存在抛 `NotFoundError`；名称冲突抛 `NameConflictError`。
- `health` / `lastHeartbeatAt` 不在写契约中；两列不再被写入，读值派生（§3.3）。
- `clientId` 在 `HarnessSummary` 中可读；写入只经 `bindClient` / `unbindClient`。

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
  clientId: string | null;   // 绑定的执行节点；null = 未登记
  health: HarnessHealth;     // 派生值（§3.3），本组件不写
  lastHeartbeatAt: string | null; // 派生值：最近一次 poll 时间
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

`HarnessSummary` 不包含 `toolCount`；该字段由 `catalog` 组合时计算。`health` 与 `lastHeartbeatAt` 是 `catalog` 组合出来的派生值，`HarnessRead` 只返回列内事实（`health` 列为历史值，组合方不再使用）。

### 3.2 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 事务/并发 |
|---|---|---|---|---|---|
| `create` | 创建 Harness 与标签 | `CreateHarness` | `{ id, revision }` | `ValidationError`、`NameConflictError` | 单事务插入根与标签 |
| `update` | 更新 Harness，整体替换标签 | `id`、`revision`、`UpdateHarness` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError`、`NameConflictError`、`ValidationError` | 单事务；`revision` 乐观锁 |
| `setEnabled` | 启停 | `id`、`revision`、`enabled` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError` | 单行更新并递增 `revision`；停用不改变在飞任务 |
| `bindClient` | 绑定/换绑节点 | `id`、`revision`、`clientId` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError`、`ValidationError`（`clientId` 为空/含空白）、`BindingConflictError`（该 `clientId` 已被其他 Harness 占用） | 单行更新并递增 `revision`；唯一索引兜底 |
| `unbindClient` | 解绑节点 | `id`、`revision` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError` | 幂等：本就未绑定视为成功，仍递增 `revision` |
| `delete` | 删除 Harness | `id`、`revision` | `void` | `NotFoundError`、`RevisionConflictError`、`ReferencedError` | 先 `ReferenceGuard`，再删除；同一事务 |
| `list` | 列表查询 | `HarnessQuery` | `Page<HarnessSummary>` | `ValidationError` | 读 |
| `get` | 详情查询 | `id` | `HarnessDetail` | `NotFoundError` | 读 |
| `getByClientId` | 按节点反查 | `clientId` | `HarnessSummary \| null` | 无 | 读；唯一索引命中 |

方法定义是本组件的权威来源；`http-gateway` 只把 DTO 映射到这些方法，不定义业务方法。

### 3.3 节点目录与在线状态口径

Harness 是执行节点目录：`client_id` 绑定 `CMP-instance` 里实例所属的 `clientId`；节点是否可派发由 `enabled` + 绑定决定，**在线状态只用于展示**。

| 值 | 判定（`catalog` 组合时） |
|---|---|
| `unknown` | 该 `clientId` 尚未被调度器观测到 poll（含调度器重启后、未绑定） |
| `online` | 最近一次 poll 距 now ≤ `clientSilentMs`（120s），且该 client 上报 `free > 0` |
| `overloaded` | 最近一次 poll 距 now ≤ `clientSilentMs`，且该 client 上报 `free = 0` |
| `offline` | 最近一次 poll 距 now > `clientSilentMs` |

- 权威来源是 `CMP-scheduler` 的 presence 读契约（[`scheduler` §3.3](../scheduler/spec.md)）；本组件不写 `health` / `last_heartbeat_at`，两列保留但非权威。
- `lastHeartbeatAt` 派生为「最近一次 poll 时间」；从未 poll 则为 `null`。
- 调度器不可用时，组合方降级为 `unknown` 并记 warning 日志，不伪造 `offline`。
- 在线状态不参与派发：派发只看 `NodeDirectory.isDispatchable`（`enabled` + 已绑定）与 client 自报的 `capacity.free`（`executor-http-v2` §9 规定容量不做二次限制）。
- 停用（`enabled=false`）语义：不派发新任务；在跑任务继续跑完；不向 client 下发 `stop`（`stop` 只由运维停止动作触发，见 `scheduler` §4.6）。

## 4 依赖与边界

- 允许：`platform` 的 `Db`；`kernel` 的 `Clock`、`IdGenerator`、`ReferenceGuard` 端口、`NodeDirectory` 端口与错误类型。
- 本组件实现 `NodeDirectory`（`HarnessNodeDirectory`），由组合根注入 `scheduler`；不依赖 `scheduler`、`instance` 或 `http-gateway`。
- 禁止：导入 `tool` 组件的 store/service；直接读 `tool` 表；在组件内拼 HTTP 响应。
- `HarnessRead` 供 `catalog` 组合使用；不把领域实体直接暴露给 HTTP。

## 5 验证

- 规则：名称唯一、枚举、`concurrencyMax` 下限、标签顺序/唯一。
- 存储：创建带标签、更新整体替换标签、启停、删除级联。
- 删除保护：注入假的 `ReferenceGuard` 返回工具列表，断言不删除并抛 `ReferencedError`。
- 读契约：列表筛选/分页/排序、详情。`toolCount` 由 `catalog` 通过工具读契约组合，Harness 组件不读工具表。
- 节点目录：绑定/解绑幂等；`clientId` 空串与空白拒绝；同一 `clientId` 被第二个 Harness 绑定 → `BindingConflictError`；解绑后 `isDispatchable` 为 `false`。
- 派生状态：四类状态各一例（从未 poll、`free>0`、`free=0` 且有在跑、超过 `clientSilentMs`）；调度器不可用时降级 `unknown`。
- 契约：对应 REST 端点的 3 正 1 反在 `http-gateway` 规格中列明。

## 6 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 5 KB。
- 单独验证命令：`bun test tests/components/harness`。
- 当前状态：`current`；已实现并通过契约测试，实施与验证的历史记录见 [`result.md`](../../../history/works/2026-10-24-db-backend-infra/result.md)（归档件，仅作追溯）。

## 7 B1 实现口径

- 保留 `health=overloaded` 枚举，用于外部界面的「高负载」展示；该值由派生口径产出，不由本组件写入。
- `client_id` 是 2026-11-10 节点目录设计新增（见 [`history/decisions/2026-11-10-harness-node-registry.md`](../../../history/decisions/2026-11-10-harness-node-registry.md)），**未实现**；实现时直接在基线里加列，不做数据迁移（演示数据可丢弃）。
- `harness_tag` 不设业务数量上限，只做字段级长度与请求体校验。
