---
layer: design
module: scheduler
status: planned
component: CMP-scheduler
updated: 2026-11-10
---

# `CMP-scheduler` 组件规格

> 范围：执行面任务列表与派发裁决，即 [`executor-http-v2`](../../contracts/executor-http-v2.md) 的 `S-01`–`S-08` 在调度器侧的落点。
> 不包含：任务来源与 prompt 组成（上游编排，后续工序）、HTTP 传输（`CMP-http-gateway`）、实例登记与可用性（`CMP-instance`）、技能包字节与摘要计算（`CMP-skill`）。
> 状态：`planned`，2026-11-10 设计定稿，尚无实现代码与测试。

## 1 主目标

维护一张任务列表，回答两件事：**这条任务现在该发给谁**、**这条任务是否已经结算**。它是任务列表的唯一写入口，也是 `S-01`–`S-08` 判定的唯一落点。

**不负责**：

- 不组装 prompt、不规划 fan-out 任务清单、不决定任务从哪里来（上游编排接缝，见 §3.2 `enqueue`）；
- 不创建、不校验工作区目录（`CMP-instance` 登记路径，client 校验存在与可写）；
- 不读取、不计算技能包内容与 sha256（`CMP-skill` 提供 `SkillPackageSource`，见 [`CMP-kernel` §3.4](../kernel/spec.md)）；
- 不解析 HTTP、不校验 `X-Executor-Protocol`、不做 Bearer 鉴权（`CMP-http-gateway`）；
- 不管理实例状态迁移（`CMP-instance`），只按实例归属决定派发与摘除；
- 不重跑、不执行任务（client 侧）；不读工作区产物。

## 2 拥有的数据

实体级设计；列、索引与迁移在实现工序落成，归本组件唯一写入口。

| 实体 | 说明 |
|---|---|
| `Task` | 任务列表条目：`taskId`、`instanceId`、`nodeId`、`attempt`、`state`、不可变快照（`prompt`/`workspacePath`/`timeoutMs`/`skillSet`）、`outcome`、`error`、`notBefore`、`dispatchedAt`、`cancelRequestedAt`、`finishedAt`、审计字段 |
| `TaskAttempt` | 每次下发与结算的事实流水（追加写）：`taskId`、`attempt`、`clientId`、`dispatchedAt`、`settledAt`、`result` 摘要。用于对账、排障与「未确认重发」判定，不作为第二真相 |
| `ClientPresence` | 判活与电平控制：`clientId`、`lastPollAt`、`stopRequested`、`cancelRequestedAt`（按实例去重）。进程内状态可重建，落库仅为重启后对账 |

不变量：

- `taskId` 由本组件生成（UUIDv7），全生命周期唯一；同一 `taskId` 的不可变快照写入后不再改变（`S-05`）。
- `Task.state` 三值闭集 `queued` / `dispatched` / `done`（`S-01`）；`outcome` 只在 `done` 时存在，取 `succeeded` / `failed` / `cancelled` / `timeout`。
- 同一 `taskId` 同一时刻最多一条 `dispatched` 事实；结果只接受一次（`S-08`）。
- `cancelRequestedAt` 是取消请求的标记，不是第四个状态：置位后任务仍按 `dispatched → done` 收敛，由 `poll` 的 `cancelInstances` 与 client 的 `cancelled` 结果兑现。
- 任务归属的 `clientId` 来自实例绑定，任务表不单独存「可改派给谁」的字段；跨 client 改派不是本组件的隐式行为（见 §4.7）。
- 技能集 digest 由本组件在入队时计算并冻结；规范见 §4.4。

## 3 公共契约

### 3.1 类型

```ts
type TaskState = "queued" | "dispatched" | "done";
type TaskOutcome = "succeeded" | "failed" | "cancelled" | "timeout";

type TaskDraft = {
  instanceId: string;      // 必须已在 CMP-instance 登记
  nodeId: string;          // 工作流节点 ID，仅透传
  prompt: string;          // ≤ maxPromptBytes
  timeoutMs: number;       // > 0
  skillIds: string[];      // 由上游给出；解析为不可变 skillSet
};

type EnqueueInput = { tasks: TaskDraft[]; actor?: string };

type EnqueueResult = {
  taskIds: string[];
  // 每个实例一份冻结技能集：同实例共用同一 digest，不同实例可不同（S-06）
  skillSets: { instanceId: string; skillSet: SkillSet }[];
};

type ClientReport = {
  free: number;                       // ≥ 0
  running: {
    taskId: string;
    instanceId: string;
    startedAt: string;
    lastEventAt?: string;
  }[];
  finished: { taskId: string; attempt: number; finishedAt: string }[];
};

type PollOptions = { holdMs: number };  // 契约 pollHoldMs=30000，由网关传入

type TaskEnvelope = {
  taskId: string;
  instanceId: string;
  nodeId: string;
  attempt: number;
  prompt: string;
  workspacePath: string;
  timeoutMs: number;
  skillSet: SkillSet;
};

type DispatchDecision = {
  tasks: TaskEnvelope[];      // ≤ min(free, maxTasksPerPoll)
  stop: boolean;
  cancelInstances: string[];
  nextPollAfterMs: number;    // 0 = 立即再拉
};

type TaskResult = {
  taskId: string;
  attempt: number;
  status: "succeeded" | "failed" | "cancelled" | "timeout";
  sessionId?: string;
  message: string;
  truncated: boolean;
  stopReason: string | null;
  usage: { inputTokens?: number; outputTokens?: number } | null;
  error: TaskError | null;
  startedAt?: string;
  finishedAt?: string;
};

type TaskError = {
  class: "workspace" | "asset" | "runtime" | "protocol"
       | "cancelled" | "timeout" | "scheduler" | "internal";
  code: string;
  message: string;
};

type ResultAck = { taskId: string; accepted: boolean };

type TaskSnapshot = {
  taskId: string;
  instanceId: string;
  nodeId: string;
  attempt: number;
  state: TaskState;
  outcome?: TaskOutcome;
  error?: TaskError;
  skillSetDigest: string;
  createdAt: string;
  updatedAt: string;
};
```

```ts
type SchedulerService = {
  /** 上游接缝：冻结快照并入队；同批同实例必须同一技能集。 */
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;

  /** P-01：容量裁决 + 批量下发 + 对账 + 电平控制；可能挂起至多 holdMs。 */
  poll(clientId: string, report: ClientReport, options: PollOptions): Promise<DispatchDecision>;

  /** P-02：首份结果为准；未知任务 404。 */
  acceptResult(clientId: string, result: TaskResult): Promise<ResultAck>;

  /** 置位 `stop` 电平；不影响已下发任务。 */
  requestStop(clientId: string): Promise<void>;

  /** 对实例发起取消；任务在跑则进入取消请求态，未下发则直接取消。 */
  cancelInstances(instanceIds: string[]): Promise<{ requested: number }>;

  /** 排障与验收读口；不进入对外 REST 契约。 */
  inspect(taskId: string): Promise<TaskSnapshot>;
};
```

### 3.2 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 并发/事务 |
|---|---|---|---|---|---|
| `enqueue` | 冻结快照并入队 | `EnqueueInput` | `EnqueueResult` | `ValidationError`、`PayloadTooLargeError`、`NotFoundError`（实例未登记）、`DatabaseUnavailableError` | 一批一个事务；同批同实例的 `skillIds` 投影不一致、或与实例在飞任务的 digest 不一致 → 整批拒绝 |
| `poll` | 派发与对账 | `clientId`、`ClientReport`、`PollOptions` | `DispatchDecision` | `ValidationError`、`DatabaseUnavailableError` | 同 `clientId` 串行（单飞）；派发预留与任务状态同事务 |
| `acceptResult` | 接受结果并结算 | `clientId`、`TaskResult` | `ResultAck` | `TaskNotFoundError`、`ValidationError`、`DatabaseUnavailableError` | 单事务；首份为准，后到只回 `accepted=false` |
| `requestStop` | 置位停止电平 | `clientId` | `void` | 无 | 幂等 |
| `cancelInstances` | 取消实例任务 | `instanceIds` | `{requested}` | `ValidationError` | 幂等；按实例去重 |
| `inspect` | 读任务快照 | `taskId` | `TaskSnapshot` | `TaskNotFoundError` | 只读 |

- 错误类型定义在 [`CMP-kernel`](../kernel/spec.md)；`TaskNotFoundError` 对应 `404 task_not_found`，与「任务不存在」同义，用于 `P-02` 与未知 `taskId`。
- `enqueue` 与 `poll` 的入参使用领域类型，不出现 HTTP 头、协议版本或 DTO 字段名；`CMP-http-gateway` 负责映射。
- `poll` 的长轮询挂起在本组件：`enqueue` 与 `acceptResult` 唤醒同一 `clientId` 的等待者，`holdMs` 到期返回空批。挂起是进程内行为，调度器单进程部署；多实例部署不在本轮范围。
- `poll` 不抛「无任务」错误：无任务返回空批，`nextPollAfterMs` 为 `0`（服务端已挂起一个周期）。

## 4 状态机与不变量

### 4.1 任务状态机

```
enqueue ──▶ queued ──dispatch──▶ dispatched ──settle──▶ done
                ▲                    │
                └──requeue（attempt+1）┘
```

- `queued`：可派发。`notBefore` 未到（退避中）或实例不可派发（blocked/retired）时不派发。
- `dispatched`：已下发且未结算。满足 §4.3 的重派条件时回到 `queued`。
- `done`：终态，不可再改变；`outcome` 与 `error` 在结算时一次写入。
- 未确认重发（`S-03`）不改变状态与 `attempt`：仍是 `dispatched`，下一次 poll 把同一 `taskId` 再放进 `tasks`。

### 4.2 契约职责落点

| 契约 | 本组件落点 |
|---|---|
| `S-01` | §4.1 状态机；任务表唯一写入口；同一 `taskId` 只 `dispatched` 给绑定的 client |
| `S-02` | §4.3 重派：`dispatchedAt + timeoutMs + resultGraceMs` 或 `lastPollAt + clientSilentMs` 超时 → `queued`，`attempt + 1` |
| `S-03` | §4.3 未确认重发：`dispatched` 且不在 `running[]`、不在 `finished[]`、无结果 → 下一跳原样重发 |
| `S-04` | `poll` 的批量上限 `min(free, maxTasksPerPoll)`；同 client 单飞，不超卖 |
| `S-05` | §4.4 快照冻结；重派只递增 `attempt` |
| `S-06` | §4.4 同实例 digest 一致：入队拒绝 + 派发复核 |
| `S-07` | §4.6 `stop` / `cancelInstances` 电平，持续到 client 的 `running[]` 不含对应任务 |
| `S-08` | §4.7 首份结果为准；未知 `taskId` 抛 `TaskNotFoundError` |

### 4.3 重派与未确认重发

判定顺序（每次 `poll` 与定时对账时执行）：

1. **未确认重发**：任务 `dispatched` 给 C，但本次 `report.running` 与 `report.finished` 都不含它、且没有已接受结果 → 本次 `tasks` 原样重发（同 `attempt`）。适用于「响应丢失」；`attempt` 不递增。重发同样计入 `S-04` 的容量（`tasks.length ≤ min(free, maxTasksPerPoll)`），超出容量的部分留到下一条 poll。
2. **静默回队**：`now - C.lastPollAt > clientSilentMs`（契约常量 120000）→ C 上的 `dispatched` 任务回到 `queued`，`attempt + 1`，`notBefore = now`。
3. **超时回队**：`now > dispatchedAt + timeoutMs + resultGraceMs`（契约常量 `resultGraceMs=60000`）→ 回到 `queued`，`attempt + 1`，`notBefore = now + taskRetryDelayMs`。
4. **失败结果重试**：见 §4.5 的重试策略表。

- 重派后 `tasks` 只回**同一 client**（实例粘性，见 §4.7）；`S-02` 允许重派，但本组件把「另一个 client」排除在外。
- 重派可能与旧副本重叠；旧副本结果先到则照常接受（`S-08`），新副本结果回 `accepted=false`。这是契约 §8 的既定代价。
- `running[].lastEventAt` 只作观测（记录最近事件时间供排障），不参与重派、判活或排序（`OQ-18` 的结论）。

### 4.4 快照冻结与技能集

- 入队时冻结 `prompt`、`workspacePath`、`timeoutMs`、`skillSet` 四要素；`workspacePath` 取自 `CMP-instance` 的实例登记，不由任务改。
- 入队时按「实例」冻结技能集：同一批里指向同一实例的任务必须解析出同一 `skillIds` 投影；不同实例各自冻结，互不影响。
- `skillSet` 由 `skillIds` 解析为不可变包引用（经 `SkillPackageSource.currentForSkill`）：

```ts
type SkillPackageRef = {
  packageId: string;   // 不可变内容标识，由 CMP-skill 发放
  name: string;
  version: string;
  digest: string;      // sha256:<hex>，包字节摘要
  sizeBytes: number;
  etag: string;        // 与 P-03 的 ETag 一致
};
type SkillSet = { digest: string; packages: SkillPackageRef[] };
```

- `skillSet.digest` 的规范化口径（契约 `S-06` 要求「规范化由调度器定义」）：按 `packageId` 升序排列，对每项取 `[packageId, version, digest, sizeBytes]`，序列化为 UTF-8 JSON 数组后取 `sha256:<hex>`。空技能集为 `[]` 的摘要。
- 同一实例上在飞任务（`dispatched` 未结算）的 `skillSet.digest` 必须相同：`enqueue` 时若实例已有在飞任务且 digest 不同 → 该实例的任务整批拒绝；`poll` 派发前复核，不一致不派发（任务留在 `queued`）。
- 技能包在任务进行中被保存成新版本时，原 `packageId` 不再由 `CMP-skill` 提供（当前不保留历史包）→ `P-03` 返回 404，client 报 `failed(asset)`，本组件按 §4.5 处理；不在任务进行中改写快照。

### 4.5 结果结算与重试策略

`acceptResult` 判定：

1. `taskId` 未知或不属于该 `clientId` 的实例 → `TaskNotFoundError`（`404 task_not_found`）。
2. 任务已 `done` → `accepted: false`。
3. 否则接受：写 `done` 与 `outcome`/`error`；`attempt` 不参与判定（旧副本结果也算首份）。

接受后按 `status` 与 `error.class`/`code` 决定是否回队（`S-02` 委托给调度器重试策略）：

| 结果 | 默认动作 | 依据 |
|---|---|---|
| `succeeded` | `done(succeeded)` | — |
| `cancelled` | `done(cancelled)` | 取消已生效 |
| `timeout` + `code=idle_timeout` | 回队重试（有限次） | 疑似工具卡死，重派大概率能过 |
| `timeout` + `code=prompt_timeout`（含未知总超时码） | `done(failed)`，不回队 | 任务本身太大，重派只会再超时；由上游拆分或调整 `timeoutMs` 新建任务 |
| `failed` + `class=workspace` | 不回队；`CMP-instance.block`，同实例其余 `queued`/`dispatched` 任务置 `done(failed)` | 实例不可用；重复派发只会持续失败（`OQ-21` 的调度器侧兜底） |
| `failed` + `class=asset` | 回队重试（有限次） | 制品瞬时不可用；超过上限后 `done(failed)` |
| `failed` + `class=runtime` / `internal` | 回队重试（有限次） | 执行环境偶发失败 |
| `failed` + `class=scheduler` / `protocol` | `done(failed)`，不回队 | 快照已冻结，重派不会改变输入；需人工处理 |
| `failed` + `class=cancelled` | `done(cancelled)` | 与取消结果同义 |

- 重试上限 `taskMaxAttempts`（默认 3，可配置）与退避 `taskRetryDelayMs`（默认 5000，可配置），定义见 [`CMP-config`](../config/spec.md)。
- 「调度器误判重派、被 client 拒绝」不计入尝试次数：`failed(scheduler)` 是 client 拒绝执行的唯一口径，直接结算，不再累计。
- 重试不改变快照；`attempt` 单调递增。

### 4.6 停止与取消（`S-07`）

- `requestStop(clientId)`：该 client 的 `poll` 返回 `stop: true` 且 `tasks: []`，直到 client 退出。停止不迁移任务：该 client 的 `queued` 任务保持在队，等待该 client 恢复或运维改派（跨 client 改派见 §4.7）。
- `cancelInstances(instanceIds)`：对命中实例的在跑任务置 `cancelRequestedAt`，`poll` 持续回 `cancelInstances` 直到这些任务结算或不再出现在 `running[]`；未下发任务直接 `done(cancelled)`；`queued` 任务从队列移除。
- 电平信号幂等：重复请求不重复计数；取消生效以任务结算为准，不以 client 回执为准。

### 4.7 实例粘性与排障读口

- 实例首次派发时绑定 `clientId`（以 `CMP-instance` 登记为准），之后该实例的任务只发给该 client；`S-02` 的重派不跨 client。跨 client 改派需要运维在 `CMP-instance` 显式改绑（另立管理面，当前不做）。
- `inspect` 只读任务快照，供排障、验收与后续只读面使用；`executor-http-v2` §12.4 的只读状态端点仍未定，不在本组件新增对外端点。

## 5 依赖与边界

允许依赖：

- `CMP-instance` 的读契约（`get` / `isDispatchable` / 绑定信息）；
- `CMP-kernel` 的 `SkillPackageSource` 端口（冻结技能集时解析包引用）、`Clock`、`IdGenerator`、错误类型、分页类型；
- `CMP-platform` 的 `Db`（事务与查询）。

禁止依赖：

- `CMP-http-gateway`、`CMP-catalog`、写服务；在组件内拼 HTTP 响应或 DTO；
- 直接读写 `instance` 表、`skill` 表或存储根；调用 client（调度器不发起任何执行面 HTTP 请求）；
- 编排/工作流组件；fan-out 规划与 prompt 组装。

组合根注入：`SchedulerService` 由入口创建，注入 `Db`、`InstanceService`、`SkillPackageSource` 实现与 `Config` 的执行面参数；`http-gateway` 只调用公开方法。

## 6 验证计划

实现工序按以下矩阵落测试；场景卡 [`SCN-0201`–`SCN-0205`](../../scenarios/workflow-orchestration/execution-scheduling/) 给出 3 正 1 反的较低层断言。

| 覆盖 | 用例 |
|---|---|
| 状态机 | 入队 → 派发 → 结算；重派回到 `queued`；`done` 后不可写；`inspect` 不改变状态 |
| `S-04` | `free=0` 空批；`free=3` 返回 ≤3；`free > maxTasksPerPoll` 截断到 10；同 client 并发 poll 不超卖 |
| `S-03` | 不在 `running[]`/`finished[]`/无结果 → 原样重发，`attempt` 不变 |
| `S-02` | 静默超过 `clientSilentMs` 回队；`timeoutMs + resultGraceMs` 过期回队；回队后 `attempt + 1`、快照不变 |
| `S-06` | 同实例不同 digest 入队被拒；同实例在飞任务同 digest 才派发 |
| `S-08` | 首份 `accepted=true`、第二份 `accepted=false`；未知 `taskId` → `TaskNotFoundError`；旧副本先到结果被接受 |
| 重试策略 | 上表每类 `status`/`class`/`code` 各一例；`taskMaxAttempts` 用尽后 `done(failed)`；退避期不派发 |
| 控制 | `stop` 后 `tasks` 为空且 `stop=true`；取消后 `cancelInstances` 持续到结算；重复请求幂等 |
| 长轮询 | 无任务挂起到 `holdMs` 返回空；`enqueue` 唤醒等待者；`nextPollAfterMs=0` |
| 架构 | 只依赖 `instance` 读契约、`kernel`、`platform`；无 HTTP 类型；无跨组件 store 导入 |

## 7 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 12 KB。
- 单独验证入口：未实现；实现工序落 `src/components/scheduler/index.ts` 的 `createScheduler` 与 `tests/components/scheduler`，命令为 `bun test tests/components/scheduler`。
- 当前状态：`planned`。契约冻结在前（[`executor-http-v2`](../../contracts/executor-http-v2.md)），本规格只定调度器侧落点；实现按 P1 确认记录另立工序。

## 8 待定

- 任务列表规模上界（几十 vs 上千）与批量下发查询的索引策略，属实现取舍，不改契约。
- 退避是否按错误类别区分（`asset` 与 `runtime` 是否需要不同退避）——当前统一 `taskRetryDelayMs`，等真实失败样本再分化。
- `inspect` 是否升级为对外只读面（`executor-http-v2` §12.4），待排障需求出现后定。
