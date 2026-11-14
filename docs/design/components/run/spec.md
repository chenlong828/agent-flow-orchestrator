---
layer: design
module: run
status: active
component: CMP-run
updated: 2026-11-12
---

# `CMP-run` 组件规格

> 范围：一次工作流运行（run）的编排——启动快照、节点推进、判定与回退、人工确认、取消、制品登记与归档指令。
> 不包含：任务列表与派发（[`CMP-scheduler`](../scheduler/spec.md)）、图定义与校验（[`CMP-workflow`](../workflow/spec.md)）、实例登记（[`CMP-instance`](../instance/spec.md)）、执行面 HTTP 传输（[`CMP-http-gateway`](../http-gateway/spec.md)）、client 侧 session 与日志采集。
> 状态：`active`（2026-11-11 设计冻结，2026-11-12 `T-RUN-05`/`T-RUN-06` 实现）。服务与组件测试见 `src/components/run/`、`tests/components/run/` 与 `tests/components/http-gateway/run-*.test.ts`。
> 契约：产品面见 §3；执行面增量见 [`executor-http-v3`](../../contracts/executor-http-v3.md)。

## 1 主目标

把「工作流定义」变成一次真实执行：按启动时冻结的图快照选下一个节点、组装 prompt、入队、等结果、结算，并在 `review` 失败或 `confirm` 拒绝时沿回退边退回指定祖先节点。它是 `workflow_run` / `run_node` / `run_artifact` 三张表的唯一写入口。

**不负责**：

- 不派发任务、不重派、不判定容量与节点门禁（`CMP-scheduler` 的 `S-01`–`S-08`；run 只调 `enqueue`/`cancelInstances`/`inspect`）；
- 不保存、不校验工作流图（启动时读 `CMP-workflow` 的当前定义并冻结快照；定义后续变更不影响本 run）；
- 不创建、不校验工作区目录；不拥有实例状态（`CMP-instance` 的 `enroll`/`get`/`isDispatchable`）；
- 不执行任务、不管理 session、不采集日志（client）；
- 不解析技能包字节（`CMP-skill` 经 `kernel.SkillPackageSource` 由调度器在入队时解析）；
- 不解析 HTTP、不做鉴权、不映射状态码（`CMP-http-gateway`）；
- 不管理归档存储的物理布局之外的生命周期（保留期与清理见 `OQ-27`）。

### 1.1 与 `CMP-scheduler` 的职责分界

两者都记录「任务」，但不是两套队列：

| 维度 | `CMP-scheduler` | `CMP-run` |
|---|---|---|
| 拥有的事实 | 任务生命周期（`queued`/`dispatched`/`done`）、`attempt`、重派、结果接受、容量、节点门禁 | 图上的节点进度（哪个节点、第几轮 `visit`）、节点语义结果（`succeeded`/`rejected`）、run 终态、制品与归档 |
| 数据 | `task`、`task_attempt` | `workflow_run`、`run_node`、`run_artifact` |
| 是否派发 | 是，唯一派发裁决者 | 否，只调 `enqueue` |
| 是否重试 | 是（仅「未回报」的 `S-02`） | 否；失败即 run 失败（`OQ-28`） |
| 对图的理解 | 无，`nodeId` 只是标签 | 有，冻结快照 + 回退边 |
| 路径属性 | 热路径：每次 poll 都跑 | 冷路径：每个节点结算时跑 |

`run_node` 的 `dispatched` 只是「这一轮已经交给调度器」的编排投影，不参与派发决策；任务是否真的在跑、是否 timeout、重派到第几次，以调度器的 `task` / `inspect` 为准。为守住这条，`run_node` **不存 `attempt`**：`attempt` 归调度器与结果/日志键。

## 2 拥有的数据

| 表 | 关键字段 | 说明 |
|---|---|---|
| `workflow_run` | `id`、`workflow_id`、`workflow_revision`、`graph_snapshot`、`intent_markdown`、`harness_id`、`client_id`、`instance_id`、`workspace_path`、`task_space_path`、`auto_confirm`、`state`、`outcome`、`current_node_id`、`result`（`finalMessage`/`error`）、`archive_state`、`finished_at`、`created_at`/`updated_at`/`created_by` | 运行聚合根；`graph_snapshot` 是启动时冻结的 `WorkflowGraph`；运行创建即开始，`startedAt` 对外取 `created_at`（`0005` 迁移收敛表宽） |
| `run_node` | `run_id`、`node_id`、`visit`、`node_type`、`expert_id`、`state`、`task_id`、`verdict`、`message`、`error`、`enter_reason`、`dispatched_at`、`finished_at` | 追加写为主：同一节点每次重访新增一行，旧行保留；`attempt` 归调度器，不在本表留第二真相 |
| `run_artifact` | `run_id`、`node_id`（归档为 null）、`visit`、`attempt`（归档为 null）、`kind`（`session_log` / `archive`）、`store_key`、`size_bytes`、`sha256`、`created_at` | 制品元数据；一次尝试一份日志，字节在 `FileStore`，本组件不持有字节 |

不变量：

- `workflow_run.id` 为 UUIDv7，全生命周期唯一；`graph_snapshot` 写入后不再改变。
- `task_space_path` 由服务端在启动时生成：`<workspace_path>/task-spaces/<YYYYMMDD-HHmmss>`（本地时间，冲突追加 `-2`），**不接收调用方提供的路径分量**。工作区本身的形态（普通目录 / git 超项目 + submodule）由用户决定，编排只把它当不透明绝对路径，不做 git 校验。
- 同一个 run 同一时刻最多一个 `run_node` 处于 `queued` / `dispatched` / `waiting_confirm`（串行推进）。
- 同一 `(run_id, node_id, visit)` 唯一；`visit` 从 1 开始，回退重访 +1。
- `workflow_run.state` 闭集 `created` / `running` / `waiting_confirm` / `done`；`outcome` 只在 `done` 时存在，取 `succeeded` / `failed` / `cancelled`。
- `run_node.state` 闭集 `queued` / `dispatched` / `waiting_confirm` / `succeeded` / `rejected` / `failed`；`rejected` 只来自 `review` 判定 fail 或 `confirm` 拒绝。
- `archive_state` 闭集 `none` / `pending` / `stored` / `failed`；它**不参与** run 状态判定，run 终态不因归档失败回退。
- 结果前置：`P-02` 到达时该 `taskId+attempt` 必须有通过校验的 `run_artifact(kind=session_log)`，否则不接受。
- 文本上限：`intent_markdown` ≤ 256 KiB；组装后的 `prompt` 必须 ≤ `maxPromptBytes`（1 MiB），超限启动失败。
- **同一 `instance_id`（同一工作区）同一时刻最多一个活跃 run**（`running` 或 `waiting_confirm`）；启动第二个 run 返回 `409 run_conflict`。原因：`S-06` 要求同实例并发任务同一技能集，而不同 run 的节点专家不同；fan-out 是唯一例外（同一 run、同一专家、同一 digest，第二期）。
- 不同工作区（不同 `instance_id`）可以各自跑 run，互不影响。

## 3 公共契约

### 3.1 类型

```ts
type RunState = "created" | "running" | "waiting_confirm" | "done";
type RunOutcome = "succeeded" | "failed" | "cancelled";
type RunNodeState = "queued" | "dispatched" | "waiting_confirm"
                  | "succeeded" | "rejected" | "failed";
type ArchiveState = "none" | "pending" | "stored" | "failed";
type RunArtifactKind = "session_log" | "archive";

type StartRun = {
  workflowId: string;
  harnessId: string;
  workspacePath: string;     // 绝对路径；存在性由 client 校验
  intentMarkdown: string;    // 诉求原文；写进首节点 prompt，不在 TaskRequest 下发
  autoConfirm?: boolean;     // 默认 false
  actor?: string;
};

type RunNodeView = {
  nodeId: string;
  nodeType: NodeType;
  visit: number;
  state: RunNodeState;
  taskId: string | null;
  verdict: Record<string, unknown> | null;
  message: string;
  error: { code: string; message: string } | null;
  dispatchedAt: string | null;
  finishedAt: string | null;
};

type RunDetail = {
  runId: string;
  workflowId: string;
  workflowRevision: number;
  harnessId: string;
  clientId: string;
  instanceId: string;
  workspacePath: string;
  taskSpacePath: string;
  autoConfirm: boolean;
  state: RunState;
  outcome: RunOutcome | null;
  currentNodeId: string | null;
  archiveState: ArchiveState;
  nodes: RunNodeView[];
  finalMessage: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type RunSummary = Omit<RunDetail, "nodes" | "finalMessage">;

type RunQuery = {
  workflowId?: string;
  state?: RunState;
  page: PageQuery;
};

type ArchiveRequest = {
  runId: string;
  instanceId: string;
  workspacePath: string;
  taskSpacePath: string;
};

type RunService = {
  /** 启动：校验可运行性 → 登记/复用实例 → 冻结快照 → 建首节点 → 推进。 */
  start(input: StartRun): Promise<RunDetail>;

  /** 推进（幂等）：选下一个节点并按需入队；终态调用直接返回。 */
  advance(runId: string): Promise<void>;

  /** P-02 入口：有 run 归属走编排结算，无归属委托调度器（手工注入任务兼容）。 */
  handleTaskResult(clientId: string, result: TaskResult): Promise<ResultAck>;

  /** P-04：登记会话日志；先落盘后登记，同一 taskId+attempt 只保留第一份。 */
  attachSessionLog(input: {
    clientId: string;
    taskId: string;
    attempt: number;
    bytes: Uint8Array;
    sha256: string;
  }): Promise<{ stored: boolean }>;

  /** P-05：登记运行归档包；校验归属与终态，落盘后登记 artifact。 */
  storeArchive(input: {
    clientId: string;
    runId: string;
    bytes: Uint8Array;
    sha256: string;
  }): Promise<{ stored: boolean }>;

  /** P-01 归档电平：该 client 待归档的 run 列表。 */
  archiveRequestsFor(clientId: string): Promise<ArchiveRequest[]>;

  /** P-01 归档确认：client 已上传成功的 runId。 */
  ackArchived(clientId: string, runIds: string[]): Promise<void>;

  /** 人工决策：仅 waiting_confirm 可接受；幂等。 */
  decide(input: {
    runId: string;
    nodeId: string;
    decision: "pass" | "reject";
    comment?: string;
    actor?: string;
  }): Promise<RunDetail>;

  /** 取消：幂等；在跑任务经调度器实例级取消。 */
  cancel(runId: string, actor?: string): Promise<RunDetail>;

  /** 读：run 详情与列表。 */
  get(runId: string): Promise<RunDetail>;
  list(query: RunQuery): Promise<Page<RunSummary>>;

  /** 读：会话日志流；未登记返回 null。 */
  readSessionLog(input: {
    runId: string;
    nodeId: string;
    visit?: number;
    attempt?: number;
  }): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes: number } | null>;

  /** 启动恢复：组合根在进程启动时调用一次；非 HTTP 入口。 */
  resumePending(): Promise<{ resumed: number }>;
};
```

### 3.2 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 并发/事务 |
|---|---|---|---|---|---|
| `start` | 建 run 并推进首节点 | `StartRun` | `RunDetail` | `ValidationError`（图/专家/字段）、`NotFoundError`（工作流/节点）、`BindingConflictError`（实例登记）、`RunConflictError`（同工作区已有活跃 run）、`PayloadTooLargeError`（intent 或 prompt 超限） | 校验与建 run 两段：校验只读；建 run + 首节点单事务；`enqueue` 在事务外 |
| `advance` | 推进一个节点 | `runId` | `void` | `NotFoundError` | 同一 run 进程内单飞；状态迁移单事务 |
| `handleTaskResult` | 结算并推进 | `clientId`、`TaskResult` | `ResultAck` | `TaskNotFoundError`、`ValidationError` | 同一 run 单飞；`acceptResult` 与 `run_node` 结算分属两个事务，先调度器后编排 |
| `attachSessionLog` | 登记日志 | `clientId`、`taskId`、`attempt`、`bytes`、`sha256` | `{stored}` | `TaskNotFoundError`、`PayloadTooLargeError` | 先写临时键、校验后原子改名；同键后到覆盖，`stored` 为 `created`/`replaced`/`unchanged` |
| `storeArchive` | 登记归档 | `clientId`、`runId`、`bytes`、`sha256` | `{stored}` | `RunNotFoundError`、`ValidationError`（解包非法）、`InvalidStateError`（未终态）、`PayloadTooLargeError` | 同上；后到覆盖；落盘后置 `archive_state=stored` |
| `archiveRequestsFor` / `ackArchived` | 归档电平 | `clientId`、`runIds` | 列表 / `void` | 无 | 幂等；只读 `pending` 且属于该 client 的 run |
| `decide` | confirm 决策 | `runId`、`nodeId`、`decision`、`comment`、`actor` | `RunDetail` | `NotFoundError`、`ValidationError`（状态不符/节点不是 confirm） | 同一 run 单飞；幂等：同决策重复提交返回当前详情 |
| `cancel` | 取消 run | `runId`、`actor` | `RunDetail` | `NotFoundError` | 幂等；先置 run 终态再取消实例任务 |
| `get` / `list` | 读 run | `runId` / `RunQuery` | `RunDetail` / `Page<RunSummary>` | `NotFoundError` | 只读；`nodes` 按 `dispatchedAt`、`nodeId`、`visit` 排序 |
| `readSessionLog` | 读日志 | `runId`、`nodeId`、`visit`、`attempt` | 流 + 大小 或 `null` | 无 | 只读；`visit` 缺省取该节点最大 `visit`，`attempt` 缺省取该行最大 `attempt` |
| `resumePending` | 重启对账 | 无 | `{resumed}` | 无 | 启动一次；对每个 `running`/`waiting_confirm` run 调 `advance` |

- `start` 的可运行性校验（按顺序）：同 `instance_id` 无活跃 run（否则 `RunConflictError`）→ 工作流存在且图非空 → 恰好一个 `start` 与一个 `end` → 每节点 ≤1 条 seq 入/出边 → `review`/`confirm` 的回退边目标为祖先 → 专家矩阵（`start`/`agent`/`split`/`review`/`fanout`/`end` 必须绑专家且启用，`confirm` 不得绑专家）→ **不含 `split`/`fanout`**（返回 `ValidationError`，`details.field=graph.nodes[<i>].type`，`reason=unsupported_node_type`）。
- `start` 登记实例：按 `(clientId, workspacePath)` 查已有实例并**复用**（`CMP-instance` 的 `getByBinding`），不存在才 `enroll` 新实例。一个工作区一个实例、可承载多个 run——`CMP-instance` 的「同 client 同 `workspacePath` 唯一」不变量不变；并发 run 共享实例的 `active` 状态；工作区失败时只结算该实例当下排队/在跑的任务（实例不再被摘除）。复用时若命中 `retired` → 拒绝启动（`ValidationError`，`reason=instance_retired`）；实例保持 `active`，同工作区下一次启动照常派发。
- `handleTaskResult` 的归属判定：`run_node.task_id = result.taskId` 命中 → 编排结算；未命中 → 委托 `scheduler.acceptResult` 并直接返回（兼容手工注入的临时任务，`jd.ts`）。
- `decide` 的幂等：`waiting_confirm` 下同决策重复提交返回当前详情；run 已推进后再提交 → `ValidationError`（`details.reason=invalid_state`）。
- 错误经 `kernel` 统一类型；`http-gateway` 负责映射（见 [`CMP-http-gateway` §4.5](../http-gateway/spec.md)）。

## 4 状态机与不变量

### 4.1 run 状态机

```
start ──▶ created ──advance──▶ running ⇄ waiting_confirm ──▶ done
                                 │                            ├─ succeeded（end 成功）
                                 └────────── cancel ─────────▶├─ failed（节点失败/轮次用尽）
                                                              └─ cancelled
```

- `created`：已建 run 与首节点，尚未入队；`start` 内部随即转 `running`。
- `running`：有一个节点在 `queued`/`dispatched`。
- `waiting_confirm`：当前节点 `waiting_confirm`，无任务在跑。
- `done`：终态，`outcome` 一次写入，不再改变；`archive_state` 可继续从 `pending` 变 `stored`/`failed`。

### 4.2 run_node 状态机

```
           ┌─（普通节点）──▶ dispatched ──result──▶ succeeded ──▶ 推进
queued ────┤
           ├─（confirm）────▶ waiting_confirm ──pass──▶ succeeded ──▶ 推进
           │                                     └─reject─▶ rejected ──▶ 回退
           └─（review fail）─▶ rejected ──▶ 回退
dispatched ──失败/超时/verdict 非法──▶ failed ──▶ run.failed
```

### 4.3 推进规则

1. 取 `current_node_id` 的下一条 `seq` 出边目标；`start` 从冻结图快照中唯一的 `start` 节点开始。
2. 目标为 `confirm`：不入队，写 `run_node(waiting_confirm)`；`auto_confirm` 为真则直接 `succeeded` 并继续推进（审计字段记 `auto`）。
3. 目标为 `end`：正常入队；成功后 `run.done(succeeded)`，`final_message` 取该节点结果的 `message`。
4. 普通/`review` 节点：按 §4.4 组装 prompt，读节点专家 `skillIds`，`scheduler.enqueue`，写 `run_node(dispatched, taskId)`；`attempt` 以调度器返回为准，不在本表落第二份。
5. 没有出边且不是 `end`：`run.failed(missing_out_edge)`（保存校验应已拦截，运行期兜底）。

### 4.4 prompt 组成

按固定顺序拼接，全部为纯文本（`prompt` 对 client 仍 opaque）：

```
[agent-flow工作流任务]
本次任务执行相关记录的 task-space：<taskSpacePath>
读取 <task-space>/intent.md 作为本系列任务运行的目标与约束，方便后续其他任务了解情况。
[输出要求] 无特别要求，跟随Skill执行。
[本次进入] 节点「<被驳回节点名>」判定 fail，本节点被回退重跑。
驳回理由：<被驳回行的 verdict.reason，截断 300 字符>

[专家]
名称：<expert.name>
角色：<expert.role>
性格：<expert.persona 按序用「、」连接>
职责：<expert.duty>
验证顺序：<expert.verifyOrder>
注意事项：<expert.notes>
```

- start 节点把中间那句换成「把下面的诉求原文写入 `<taskSpacePath>/intent.md`，再开始执行」，并追加 `[启动诉求原文]`（受 `maxPromptBytes` 约束）。
- 不写工作流名、节点名、工作目录与目录规范：工作目录由 DSH 的运行上下文提供，产物归属与判定标准由技能承载。
- 专家块空字段整行省略；技能清单与使用顺序不进 prompt（清单由 DSH 技能目录注入，顺序只作人工查看）。
- `[本次进入]` 块只在回退重跑时出现：`run_node.enter_reason` 只存指针 `{kind, from, fromVisit}`，理由正文按指针回查被驳回行的 `verdict`，不复制第二份；confirm 驳回渲染成「人工在「<节点>」节点驳回」+「驳回意见」。

- 不注入上游节点的消息正文；跨节点上下文靠 task-space 文件。
- `confirm` 不组装 prompt、不入队。
- 组装结果超过 `maxPromptBytes` → 启动/推进失败（`PayloadTooLargeError`），不截断。
- 节点超时取配置 `run.default_timeout_ms`（默认 1800000），本期不支持按节点配置覆盖（待定）。

### 4.5 判定与回退

1. `review` 结果结算：取 `message` 末尾窗口内**最后一个**可解析的 verdict JSON 对象（裸 JSON，不要求独占一行、不要求代码围栏）；`verdict` 必须是 `"pass"` 或 `"fail"` 字符串，否则 `run_node(failed, verdict_invalid)`、`run.failed`。
2. `pass` → `succeeded` → 推进 seq。
3. `fail` → `rejected`：在冻结图中找该节点唯一 `rollback` 出边；无 → `run.failed(missing_rollback_edge)`。目标必须是当前节点的祖先（按 seq 入边回溯），否则 `run.failed(invalid_rollback_target)`。
4. 回退：`current_node_id = 目标节点`，目标节点下次执行时 `visit = 该节点历史最大 visit + 1`；目标到 `review` 之间的节点依次重跑，各自 `visit+1`，新行写入同一个 `enter_reason` 指针（指向被驳回行），派发时渲染成 prompt 的 `[本次进入]` 块。
5. 轮次上限：任一节点本次 `visit > run.max_node_visits`（默认 5）→ `run.failed(visit_limit_exceeded)`，不再入队。
6. `confirm` 决策：`pass` → `succeeded` → 推进；`reject` → `rejected` → 按第 3–5 条回退。

### 4.6 失败与取消

| 情形 | run_node | run | 后续 |
|---|---|---|---|
| 结果 `failed`/`timeout` | `failed` | `failed` | 停在此节点，不自动重试（`OQ-28`） |
| 结果 `cancelled` | `failed(cancelled)` | `cancelled`（若由 cancel 触发） | 不再推进 |
| verdict 非法 | `failed(verdict_invalid)` | `failed` | 停在此节点 |
| 回边缺失/目标非法 | `failed` | `failed` | 保存校验应已拦截，运行期兜底 |
| 轮次用尽 | `failed(visit_limit_exceeded)` | `failed` | 停在此节点 |
| 取消 | 当前节点 `failed(cancelled)` | `cancelled` | `scheduler.cancelInstances(instanceId)` |

- 取消以任务结算为准：run 先置 `cancelled`，client 随后回报 `cancelled` 时不再改变 run 状态（`S-08` 首份为准）。
- 归档失败不改变 run 终态。

### 4.7 归档

1. run 进入 `done`：**只有存在成功结算节点**（`run_node.state='succeeded'`）时置 `archive_state = pending`；从未成功过的取消/失败 run 置 `none`，不下发归档指令（客户端本地没有可打包的 task-space）。
2. `archiveRequestsFor(clientId)` 返回 `pending` 且属于该 client 的 run；`poll` 按电平持续下发。
3. `storeArchive` 落盘 `history/<instanceId>/<runId>/task-space.tar.gz`、把该 run 已有的日志副本复制到同目录 `logs/<nodeId>-<visit>-a<attempt>.jsonl.gz`，并置 `stored`；`ackArchived` 后不再下发。
4. `storeArchive` 失败（超限/解包非法）置 `failed`，不再自动重试；运维处理。
5. **超时降级**：`pending` 且 `finished_at` 超过 `archivePendingTtlMs`（默认 10 分钟）仍未被确认 → 置 `failed` 并停止下发，避免客户端离线或本地目录被删导致电平长期空转；之后 client 若真的补传，`storeArchive` 仍会把状态改回 `stored`。

### 4.8 并发与恢复

- **单飞**：`advance` / `handleTaskResult` / `decide` / `cancel` 按 `runId` 进程内串行（`Map<runId, Promise>`），避免同一 run 的并发推进。
- **跨 run**：按工作区互斥——同一 `instance_id` 同一时刻只允许一个活跃 run（`run_conflict`），因此不存在两个 run 争同一容器的技能集；不同工作区之间互不影响。fan-out 在同一 run 内并发多个任务（第二期），共用同一专家与 digest，不违反 `S-06`。
- **重启恢复**（`resumePending`）：扫描 `running` 与 `waiting_confirm`；
  - 当前节点 `dispatched` 且有 `taskId` → `scheduler.inspect(taskId)`：`done` 则用结果补结算再推进；`queued`/`dispatched` 则等待（调度器 `S-02` 会重派）；
  - 当前节点 `queued` 且无 `taskId` → 重新入队。**已知代价**：若崩溃发生在「enqueue 已提交、run_node 未回填 taskId」之间，会重复入队一次并可能重复执行该节点；这与契约的 at-least-once 口径一致，不额外引入幂等键（若将来需要，给 `enqueue` 加幂等键属调度器变更）。
  - `waiting_confirm` → 保持等待，不自动决策。

## 5 依赖与边界

允许依赖：

- `CMP-workflow` 的 `WorkflowRead.get`（取图与 `revision`）；
- `CMP-expert` 的 `ExpertRead.get`（取 `skillIds` 与 `enabled`）；
- `CMP-harness` 的 `HarnessRead.get`（`harnessId → clientId` 与 `enabled`）；
- `CMP-instance` 的 `InstanceService.enroll` / `get`（登记与读工作区）；
- `CMP-scheduler` 的 `SchedulerService.enqueue` / `cancelInstances` / `inspect`；
- `CMP-kernel` 的 `FileStore` 端口、`Clock`、`IdGenerator`、错误类型、分页；
- `CMP-platform` 的 `Db`（事务与查询）。

禁止依赖：

- `CMP-http-gateway`、`CMP-catalog`、`CMP-skill` 的写服务；
- 直接读写 `task`/`instance`/`harness`/`expert`/`workflow` 表；
- 在组件内拼 HTTP 响应、DTO、状态码；发起对 client 的网络请求；
- 使用 Bun 文件 API（字节一律经 `FileStore`）。

组合根注入：`createRunService({ db, clock, ids, fileStore, workflowRead, expertRead, harnessRead, instance, scheduler, config })`；`http-gateway` 只调用公开方法。

## 6 验证计划

| 覆盖 | 用例 |
|---|---|
| 启动 | 合法图建 run 并派发首节点；`split`/`fanout`/缺专家/缺 `start` 均 400 且不建 run；instance 重复登记冲突 409 |
| 推进 | 首节点成功→后继入队；`end` 成功→`done(succeeded)`；无出边→`failed` |
| 判定 | verdict pass 推进；fail 回退到祖先且 `visit+1`；verdict 缺失/非法→`failed(verdict_invalid)`；无回边→`failed` |
| 轮次 | `visit > max_node_visits` → `failed(visit_limit_exceeded)`，不再入队 |
| 确认 | `waiting_confirm` 无任务；pass 推进、reject 回退；`auto_confirm` 不等待；非 `waiting_confirm` 决策 409 |
| 日志 | 缺日志报结果 409 且不结算；补传后接受；同内容重复 200 `unchanged`、异内容后到覆盖 200 `replaced`；超限 413 |
| 归档 | 终态后电平下发；上传后落 `history/<instanceId>/<runId>/` 并置 `stored`；`archivedRuns` 确认后停止；损坏包 400；未终态 409 |
| 取消 | 在跑任务经 `cancelInstances` 取消；`waiting_confirm` 直接取消；重复取消幂等 |
| 恢复 | `dispatched` 已结算补结算；`queued` 无 `taskId` 重新入队；`waiting_confirm` 保持 |
| 边界 | 不依赖 `http-gateway`/`catalog`/`skill` 写服务；无跨组件 store 导入；无 Bun 文件 API |
| prompt | 组成顺序固定；超 `maxPromptBytes` 不截断直接失败；`confirm` 不组装 |

## 7 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 12 KB。
- 单独验证入口：`src/components/run/service.ts` 的 `createRunService`；命令 `bun test tests/components/run tests/components/http-gateway/run-*.test.ts`。
- 当前状态：`active`；契约见 [`executor-http-v3`](../../contracts/executor-http-v3.md)，实现与任务状态见 [`T-RUN-05`/`T-RUN-06`](../../../history/works/2026-11-11-workflow-run-orchestration/result.md)。

## 8 待定

- 节点级超时覆盖（当前统一取 `run.default_timeout_ms`）。
- 失败后「从当前节点原地重试」（`OQ-28`）。
- `split`/`fanout` 的执行语义（第二期；`OQ-26`）。
- 会话日志与归档的保留期与清理（`OQ-27`）。
- 并发 run 的工作区冲突策略：当前不互斥，是否需要按工作区加软锁由真实使用反馈决定。
