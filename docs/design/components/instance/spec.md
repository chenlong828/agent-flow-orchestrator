---
layer: design
module: instance
status: planned
component: CMP-instance
updated: 2026-11-10
---

# `CMP-instance` 组件规格

> 范围：执行实例的登记、工作区路径归属、client 绑定与可用性状态，即 `executor-http-v2` 的 `TaskRequest.instanceId` / `workspacePath` 与 `S-02`/`S-06` 依赖的实例事实。
> 不包含：任务状态与派发裁决（[`CMP-scheduler`](../scheduler/spec.md)）、工作区目录的创建与校验（client 侧）、HTTP 传输（`CMP-http-gateway`）、跨 client 改派的管理面。
> 状态：`planned`，2026-11-10 设计定稿，尚无实现代码与测试。

## 1 主目标

维护「一个执行实例 = 一个工作区路径 + 一个归属 client」，回答两件事：**这条任务可以派给谁**、**这个实例还能不能接活**。它是实例事实的唯一写入口。

**不负责**：

- 不创建、不检查工作区目录是否存在/可写/是否在 git 仓库外；契约 `P-01` §4.1 #3 规定 client 只校验不创建，调度器只登记路径字符串；
- 不决定任务派发顺序、容量与重试（`CMP-scheduler`）；
- 不持有任务状态、技能集 digest 或安装状态（digest 一致性由调度器按任务派生）；
- 不回收目录、不清理进程（v2 没有清理指令，实例不再需要时由运维按 `instanceId` 回收）；
- 不解析 HTTP、不做鉴权（`CMP-http-gateway`）。

## 2 拥有的数据

实体级设计；列、索引与迁移在实现工序落成，归本组件唯一写入口。

| 实体 | 说明 |
|---|---|
| `Instance` | 执行实例：`instanceId`、`clientId`、`workspacePath`、`state`、`blockReason`、`enrolledAt`、`updatedAt`、审计字段 |

不变量：

- `instanceId` 全局唯一（UUIDv7），创建后不可变；重复登记同 `instanceId` 时 `clientId` 与 `workspacePath` 必须完全一致，否则拒绝（见 §3.2 `enroll`）。
- 同一 `clientId` 下 `workspacePath` 唯一（`(clientId, workspacePath)` 唯一约束）；不同 client 上出现相同路径字符串是合法的（不同机器）。
- `workspacePath` 必须是绝对路径字符串：非空、以 `/` 开头、不含 NUL 与控制字符；不做目录存在性检查。
- `state` 三值闭集：`active`（可派发）/ `blocked`（暂不派发，可恢复）/ `retired`（终态，不再派发也不再登记）。
- 实例与 client 的绑定关系是派发粘性的唯一依据：`CMP-scheduler` 不得把任务发给非绑定 client。
- `blocked` 不删除实例，其 `queued` 任务由调度器结算为失败；恢复（`unblock`）后实例重新可派发，历史任务不自动复活。

## 3 公共契约

### 3.1 类型

```ts
type InstanceState = "active" | "blocked" | "retired";
type BlockReason = "workspace_failure" | "operator";

type Instance = {
  instanceId: string;
  clientId: string;
  workspacePath: string;   // 绝对路径字符串；存在性由 client 校验
  state: InstanceState;
  blockReason: BlockReason | null;
  enrolledAt: string;
  updatedAt: string;
};

type EnrollInstance = {
  instanceId: string;
  clientId: string;
  workspacePath: string;
};

type InstanceService = {
  /** 上游接缝：任务启动时登记实例（界面设置 workspacePath，目录提前建好）。 */
  enroll(input: EnrollInstance): Promise<Instance>;

  /** 读：不存在返回 null。 */
  get(instanceId: string): Promise<Instance | null>;

  /** 读：按 client 列可派发实例。 */
  listDispatchable(clientId: string): Promise<Instance[]>;

  /** 派发前复核：实例存在、active、绑定该 client。 */
  isDispatchable(instanceId: string, clientId: string): Promise<boolean>;

  /** 执行失败导致实例不可用：active → blocked（幂等）。 */
  block(instanceId: string, reason: BlockReason): Promise<void>;

  /** 运维恢复：blocked → active（幂等）。 */
  unblock(instanceId: string): Promise<void>;

  /** 运维回收：任意非 retired → retired（幂等，终态）。 */
  retire(instanceId: string): Promise<void>;
};
```

### 3.2 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 并发/事务 |
|---|---|---|---|---|---|
| `enroll` | 登记实例 | `EnrollInstance` | `Instance` | `ValidationError`、`BindingConflictError`（同 ID 不同绑定、或同 client 同路径重复）、`DatabaseUnavailableError` | 单事务；唯一约束兜底 |
| `get` | 读实例 | `instanceId` | `Instance \| null` | 无 | 只读 |
| `listDispatchable` | 列可派发实例 | `clientId` | `Instance[]` | `ValidationError` | 只读；只回 `active` |
| `isDispatchable` | 派发复核 | `instanceId`、`clientId` | `boolean` | 无 | 只读 |
| `block` | 摘除实例 | `instanceId`、`reason` | `void` | `NotFoundError` | 幂等；`retired` 不回到 `blocked` |
| `unblock` | 恢复实例 | `instanceId` | `void` | `NotFoundError` | 幂等；`retired` 拒绝恢复（`ValidationError`） |
| `retire` | 回收实例 | `instanceId` | `void` | `NotFoundError` | 幂等；终态 |

- 错误类型定义在 [`CMP-kernel`](../kernel/spec.md)；`BindingConflictError` 用于「同 `instanceId` 的绑定被改」与「同 client 同路径重复登记」，映射为 `409 binding_conflict`。
- `enroll` 的调用方向：任务启动用例（上游编排 / 界面）在创建任务列表前登记实例并确保目录已建好；`enroll` 不接受来自执行面 client 的请求（`executor-http-v2` 没有注册端点）。
- `block` / `unblock` / `retire` 是运维与调度器的写入口；本期没有对外 REST 面，由组合根暴露给运维脚本与调度器。

## 4 状态机与不变量

### 4.1 实例状态机

```
enroll ──▶ active ──block──▶ blocked ──unblock──▶ active
              │                  │
              └──────retire──────┴──────▶ retired
```

- `active`：可派发；`scheduler` 只从这里取实例。
- `blocked`：不派发新任务；调度器在检测到 `failed(workspace)` 时调用 `block(workspace_failure)`；同一实例后续任务按 [`CMP-scheduler` §4.5](../scheduler/spec.md) 结算，不持续重派。
- `retired`：终态；工作区目录与进程由运维按 `instanceId` 回收，本组件不删数据。`retire` 前调度器应先把该实例的 `dispatched` 任务取消、`queued` 任务结算为失败，避免任务停在不可派发的实例上；顺序见 §4.2。

### 4.2 与其他组件的边界

| 消费方 | 用法 |
|---|---|
| `CMP-scheduler` | `get`（取 `workspacePath`）、`isDispatchable`（派发复核）、`listDispatchable`（批量筛选）；`block`（实例失败摘除） |
| 上游编排 / 任务启动用例 | `enroll`（任务启动时登记实例，目录提前建好） |
| 运维脚本 | `unblock` / `retire`；`retire` 前先经调度器取消该实例在跑任务、结算排队任务 |
| `CMP-http-gateway` | 不直接依赖；执行面三个端点只经 `CMP-scheduler` |

### 4.3 与 `executor-http-v2` 的对应

| 契约 | 落点 |
|---|---|
| `TaskRequest.instanceId` | 实例主键；任务绑定实例，实例绑定 client |
| `TaskRequest.workspacePath` | `Instance.workspacePath` 原样透传；client 按 `P-01` §4.1 #3 校验 |
| `S-02` 重派 | 实例粘性：重派只回 `Instance.clientId`；`OQ-20` 的结论落在本表 |
| `S-06` 同容器技能集一致 | 由 `CMP-scheduler` 按 `instanceId` 聚合同实例在飞任务得出，本组件不存 digest |
| 实例不可用（`OQ-21`） | 契约仍无上报载体；本组件 `blocked` 是调度器侧兜底，恢复由运维触发 |

### 4.4 节点停用与实例回收

- 节点（Harness）`enabled=false` **不改变实例状态**：实例仍 `active`，只是调度器不再往该 client 派发新任务；在跑任务继续。
- 回收顺序（运维）：停用节点 → 经调度器取消该 client 在跑实例的任务、结算排队任务 → `instance.retire` → 按 `instanceId` 回收工作区。实例不主动感知节点，避免 `instance → harness` 的同层读依赖。
- 节点解绑（`unbindClient`）与停用同等：不派发；实例保留，等节点重新绑定后恢复。
- 实例与节点的关联只靠 `clientId`：`listByClient` 是回收时反查实例的入口。

## 5 依赖与边界

允许依赖：

- `CMP-platform` 的 `Db`；
- `CMP-kernel` 的 `Clock`、`IdGenerator`、错误类型。

禁止依赖：

- `CMP-scheduler`、`CMP-http-gateway`、`CMP-skill` 与四类资产组件；
- 文件系统与 `FileStore`（不创建/校验目录）；`Bun` 文件 API；
- 在组件内拼 HTTP 响应或 DTO；不发起对 client 的网络请求。

## 6 验证计划

实现工序按以下矩阵落测试：

| 覆盖 | 用例 |
|---|---|
| 登记 | 首次登记成功；同 `instanceId` 重复登记幂等；同 ID 改 client 或改路径 → `BindingConflictError`；非绝对路径/空路径/含控制字符 → `ValidationError` |
| 路径唯一 | 同一 client 下同路径重复登记 → `BindingConflictError`；不同 client 同路径字符串允许登记 |
| 可派发 | `active` 可派发且绑定 client 匹配；`blocked`/`retired` 不可派发；未知实例返回 `null` / `false` |
| 状态机 | `block` 幂等；`unblock` 恢复；`retire` 终态后 `unblock` 拒绝；`retire` 幂等 |
| 边界 | 不读写文件系统；不导入 `scheduler`/`http-gateway`；只依赖 `platform`/`kernel` |

## 7 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 6 KB。
- 单独验证入口：未实现；实现工序落 `src/components/instance/index.ts` 的 `createInstanceService` 与 `tests/components/instance`，命令为 `bun test tests/components/instance`。
- 当前状态：`planned`；实现按 P1 确认记录另立工序。

## 8 待定

- 实例与 client 的绑定是否需要「临时改派」接口（跨 client 迁移工作区）——当前只做 `retire` + 重新 `enroll`，不提供迁移；等真实运维需求出现再定。
- `blocked` 是否自动恢复（client 重启后重新探活）——v2 无实例不可用上报载体（`OQ-21`），当前保持人工 `unblock`。
