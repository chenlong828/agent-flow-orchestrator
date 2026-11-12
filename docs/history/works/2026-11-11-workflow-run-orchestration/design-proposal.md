---
layer: works
module: global
status: frozen
updated: 2026-11-11
procedure: 2026-11-11-workflow-run-orchestration
stage: P1 设计提案（已确认；规格冻结见 design/）
---

# 工作流运行编排：P1 设计提案

> 输入：`REQ-0001`、2026-11-11 概念讨论逐项确认（§2）。
> 本文件是 P1 第一次人工评审确认的材料：只定切分、数据、契约与分期，不定列级细节。
> **2026-11-11 已确认**；场景卡与规格已落：[`SCN-0301`–`SCN-0304`](../../../design/scenarios/workflow-orchestration/workflow-execution/)、[`CMP-run` 规格](../../../design/components/run/spec.md)、[`executor-http-v3`](../../../design/contracts/executor-http-v3.md)。本文件保留为决策过程记录，列级细节以规格为准。
> 一句话：**新增 `CMP-run` 编排组件，`CMP-scheduler` 不动，客户端契约升 v3，工作流 DSL 收敛为 7 类节点。**

## 1 现状与缺口

| 层 | 已有 | 缺口 |
|---|---|---|
| 定义侧 | `workflow` + `workflow_definition.graph`；7 类节点；单链拓扑、`fanout→fanin` 成对、`rollback` 仅 `review/confirm` 发起 | 节点没有执行语义；`start`/`end` 只是标记；没有运行入口 |
| 执行侧 | `task` 列表与派发（`S-01`–`S-08`）；一任务一 session；instance 登记与节点目录 | 不知道 run / 图 / 节点先后；结果只有状态，没有 verdict 与制品 |
| 中间 | — | **run 聚合、节点推进、制品回传、归档全部缺失** |

## 2 已确认的决策（2026-11-11）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 节点类型 | 7 类：`start / agent / split / review / confirm / fanout / end`；删除 `fanin` |
| D2 | 执行节点 | `start`、`agent`、`split`、`review`、`end` 建 session；`confirm` 人工；`fanout` 调度器侧展开 |
| D3 | `start` | 常规执行节点，接收启动诉求作为输入 |
| D4 | `end` | 常规执行节点，读取 task-space 整理并输出最终结果 |
| D5 | `confirm` | 不建 session；run 停在 `waiting_confirm`，外部 API 提交 pass/reject；开发期由启动参数 `autoConfirm` 默认通过 |
| D6 | 跳转 | 复用 `rollback` 边；只允许 `review`/`confirm` 发起，目标必须是祖先；模型只输出 pass/fail，不决定目标 |
| D7 | verdict 解析 | 调度器从最终消息解析固定 JSON；解析失败 = 节点失败，不跳转 |
| D8 | task.db | SQLite；skill 带脚本在 client 侧生成；只含任务内容（不含专家）；client 上传，调度器只读校验，格式错误节点失败 |
| D9 | fanout 专家 | 专家取自 `fanout` 节点配置，不写在 task.db 里 |
| D10 | session-log | 全量 ACP 事件 JSONL + gzip；上传成功后才允许上报 result；缺失时 result 被拒 |
| D11 | task-space | `<workspace>/.agent-flow/task/<runId>/`；按 run 隔离；靠提示词与 skill 规范约束，不靠文件权限 |
| D12 | 上下文 | 节点间不注入上游消息，只注入 task-space 路径与约定；诉求落 `<task-space>/intent.md` |
| D13 | 归档 | run 结束后 client 打包 task-space 上传；服务端存 `<archive.root>/history/<instanceId>/<runId>/`；本地目录保留 |
| D14 | 启动 | `POST /workflows/{id}/runs`，带 `harnessId`、`workspacePath`、`intent`、`autoConfirm`；自动登记 instance |
| D15 | 控制 | 本期提供 `POST /runs/{id}/cancel` |
| D16 | 分期 | 第一期：run 骨架 + 常规 + 审核回退 + confirm + session-log + 归档；第二期：`split` + `fanout` |
| D17 | 并发 | 同一 instance（工作区）同一时刻只允许一个活跃 run（`409 run_conflict`）；不同工作区各自并行；fan-out 在同一 run 内并发多个任务（第二期）。原因：`S-06` 要求同实例并发任务同一技能集，不同 run 的专家不同 |

## 3 运行模型

### 3.1 一次 run 的构成

- **图快照**：启动时把 `workflow_definition` 的 graph 连同 `revision` 冻结进 run，运行期改定义不影响在跑的 run。
- **启动诉求**：markdown 原文，随首个任务下发，由 client 写入 `<task-space>/intent.md`。
- **目标**：`harnessId` → `clientId`；`workspacePath` → instance；`<workspace>/.agent-flow/task/<runId>/` → task-space。
- **开关**：`autoConfirm`（confirm 节点默认通过，默认 false）。

### 3.2 状态机

```
run:      created ──▶ running ⇄ waiting_confirm ──▶ done
                       │                              ├─ succeeded
                       └────────── cancel ───────────▶├─ failed
                                                      └─ cancelled
run_node: pending ──▶ dispatched ──▶ running ──▶ succeeded
                                          ├─ rejected（review fail / confirm reject）
                                          └─ failed（错误、超时、verdict 非法）
confirm:  pending ──▶ waiting_confirm ──▶ approved / rejected
archive:  none ──▶ pending ──▶ stored / failed（run 终态后的独立子状态，不改变 run 状态）
```

- `run_node` 按「访问轮次」`visit` 记录：回退后目标节点起重新执行，产生 `visit+1` 的新行，旧行保留为历史。
- 每节点最大重访次数 `run.max_node_visits`（默认 5）；超限 run `failed`，错误码 `visit_limit_exceeded`。

### 3.3 目录

```
client 工作区
  <workspace>/.agent-flow/task/<runId>/
    ├── intent.md                     ← 首任务由 client 写入
    ├── （节点产物、task.db 等）        ← 各节点自查自写
    └── …                             ← run 结束打包上传，本地保留

服务端 archive.root（配置）
  ├── runs/<runId>/nodes/<nodeId>-<visit>.jsonl.gz   ← session-log 权威副本
  └── history/<instanceId>/<runId>/                  ← 归档包 + 日志副本
```

## 4 节点语义与推进

| 节点 | 执行 | 输入 | 输出 / 制品 | 路由 | 本期 |
|---|---|---|---|---|---|
| `start` | 是 | `intent.md` + 节点说明 | 自由文本 | seq 出边 | 是 |
| `agent` | 是 | task-space + 节点说明 | 自由文本 | seq 出边 | 是 |
| `split` | 是 | task-space + 拆分指令（skill） | `task.db`（SQLite，上传） | seq 出边（须接 `fanout`） | 否 |
| `review` | 是 | task-space + 审核指令 | verdict JSON | pass→seq；fail→`rollback` 边目标 | 是 |
| `confirm` | 否 | — | 人工决策 | pass→seq；reject→`rollback` 边目标 | 是 |
| `fanout` | 否（展开） | 上游 `split` 的 task.db | N 个 task（专家取自本节点） | 全部结算→seq 出边 | 否 |
| `end` | 是 | task-space 全部产物 | 最终 markdown | 无出边 | 是 |

### 4.1 prompt 组成（概念级，模板在组件规格定稿）

```
<节点说明：工作流名 + 节点名 + 节点描述>
本次运行的工作区：<workspacePath>
本次运行的 task-space：<taskSpacePath>（读写都限制在这里）
启动诉求：<taskSpacePath>/intent.md（开工前必读）
输出要求：产物写入 task-space；review 额外要求末尾给出 verdict JSON
```

- 不注入上游节点的消息正文；跨节点上下文靠 task-space 里的文件传递。
- 首个任务额外带 `intentMarkdown`，client 写入 `intent.md` 后再建 session；重复下发可覆盖（内容不变）。
- `review` 的 verdict 约定：最终消息里最后一段 ```json 代码块，`{"verdict":"pass"|"fail","reason":string}`；解析失败 → `failed(verdict_invalid)`。

### 4.2 回退

1. `review` 判定 fail 或 `confirm` 被 reject：沿该节点唯一一条 `rollback` 边的 `to` 作为回退目标。
2. 目标节点及其到 review 之间的节点，下次推进时以 `visit+1` 重新执行；已成功的旧 `run_node` 行保留。
3. 没有 `rollback` 边或目标不是祖先（理论被保存校验挡住）→ 节点 `failed`，run `failed`。
4. 目标节点 `visit+1 > max_node_visits` → run `failed(visit_limit_exceeded)`。

## 5 组件切分（P1 决策）

### 5.1 三个候选

| 方案 | 做法 | 结论 |
|---|---|---|
| **A. 新增 `CMP-run`** | 独立编排组件，拥有 run/node/artifact；依赖工作流读、专家读、instance、scheduler、harness 读 | **推荐**：编排是独立变化轴，scheduler 保持无感知 |
| B. 扩展 `CMP-scheduler` | 让调度器拥有 run 与图 | 否决：调度器会依赖 workflow/图与 prompt 组装，违反「只管任务列表」；执行面热路径混入编排 |
| C. 放在 `http-gateway` | 网关内做编排 | 否决：网关只做协议翻译；编排有持久状态与事务，放网关会让协议层承担业务状态 |

### 5.2 组件地图

| 组件 | 变化 | 职责 |
|---|---|---|
| `CMP-run`（新增） | — | run 聚合、节点推进、verdict 解析、退与轮次、confirm 决策、取消、归档指令与制品元数据 |
| `CMP-workflow` | 只读增量 | 提供「取当前定义」读契约（已存在） |
| `CMP-expert` | 无 | run 按节点 `expertId` 读 skillIds |
| `CMP-harness` | 无 | run 按 `harnessId` 读 `clientId` |
| `CMP-instance` | 无 | run 启动时 `enroll` |
| `CMP-scheduler` | **不改** | 派发、重派、结果接受原样 |
| `CMP-http-gateway` | 增量 | 产品面 6 端点；执行面 `P-02` 转交 run 包装；`P-04`/`P-05` 新增 |
| `kernel` | 增量 | 复用 `FileStore`；新增执行面 v3 相关错误类型 |
| `config` | 增量 | `archive.root`、`run.max_node_visits`、节点超时默认值 |

### 5.3 依赖与禁止边

```
http-gateway ──▶ run ──▶ workflow（读）
                  ├──▶ expert（读 skillIds）
                  ├──▶ harness（读 clientId）
                  ├──▶ instance（enroll / get）
                  ├──▶ scheduler（enqueue / cancel / inspect）
                  ├──▶ kernel（FileStore / Clock / Ids / 错误）
                  └──▶ platform（Db）
```

- 扇出 7（≤8）；`run` 是冷路径（分钟级），不进入 poll 热路径。
- 禁止：`scheduler → run`（executor poll 由网关直接调 scheduler）；`run → http-gateway`；`run` 直接读写 `task` 表；`scheduler` 依赖 `workflow`。

### 5.4 数据所有权

| 数据 | 所有者 | 写入口 |
|---|---|---|
| `workflow_run` | `CMP-run` | run 服务 |
| `run_node` | `CMP-run` | run 服务（追加写 + 状态迁移） |
| `run_artifact` | `CMP-run` | run 服务（上传时登记） |
| `runs/` 与 `history/` 字节 | `CMP-run`（经 `FileStore` 端口） | run 服务 |
| `task` / `task_attempt` | `CMP-scheduler` | 不变 |

## 6 契约 v3 增量

### 6.1 执行面（client）

| 变更 | 内容 |
|---|---|
| 版本 | `X-Executor-Protocol: 3`（新必填字段 + 语义变化，按 §13 升整数） |
| `TaskRequest` 增 `taskSpacePath` | 绝对路径；client 收到后 `mkdir -p` 再建 session |
| `TaskRequest` 增 `intentMarkdown?` | 仅 run 首个任务携带；client 写入 `<taskSpacePath>/intent.md` |
| `P-01` 请求增 `archivedRuns?: string[]` | client 已归档成功的 runId，服务端据此停止下发归档指令 |
| `P-01` 响应增 `archiveRequests?: {runId, instanceId, taskSpacePath}[]` | 电平信号，直到 `archivedRuns` 确认 |
| `P-04`（新）上传 session-log | `POST /tasks/{taskId}/session-log?attempt=n`；`application/x-ndjson` + `Content-Encoding: gzip`；按 `taskId+attempt` 幂等（同 sha256 返回 200，不同返回 409） |
| `P-05`（新）上传 run 归档 | `POST /runs/{runId}/archive`；`application/gzip`（tar.gz）；按 `runId` 幂等 |
| `P-02` 新错误 | 执行节点没有对应 session-log 时返回 `409 session_log_missing`；client 补传后重试 |
| `C-08` 修订 | 结果仍只含控制信息；会话全文与 task-space 归档按 `P-04`/`P-05` 上传，不进结果 |
| 常量 | `maxSessionLogBytes = 64 MiB`（压缩后）、`maxArchiveBytes = 512 MiB` |

### 6.2 产品面端点（48 → 54）

| 端点 | 用途 |
|---|---|
| `POST /api/v1/workflows/{id}/runs` | 启动 run；校验流程可运行、登记 instance、冻结快照、推进首节点 |
| `GET /api/v1/runs/{id}` | run 详情 + 节点列表（含当前节点、verdict、归档状态） |
| `GET /api/v1/runs?workflowId=&state=` | run 列表 |
| `POST /api/v1/runs/{id}/cancel` | 取消 run（幂等） |
| `POST /api/v1/runs/{id}/nodes/{nodeId}/decision` | confirm 决策 `{decision: pass\|reject, comment?}` |
| `GET /api/v1/runs/{id}/nodes/{nodeId}/session-log` | 下载 session-log（优先本地副本，缺则 404） |

执行面三个端点仍**不进** `openapi.yaml`（契约权威是 v3 文档）。

### 6.3 不改变的部分

- `S-01`–`S-08` 的派发、重派、结果接受语义；`task` 表结构。
- `prompt` 对 client 仍是 opaque 文本。
- 结果首份为准、失败不自动重派。

## 7 工作流 DSL 变更

- `NodeType` 改为 7 类，删除 `fanin`。
- 拓扑：保留单链（每节点 ≤1 seq 入/出）、`rollback` 仅 `review`/`confirm` 且目标为祖先；删除 `fanout→fanin` 配对校验；新增 `fanout` 必须恰好一个前驱且类型为 `split`（第二期生效，本期保存校验也按此）。
- 专家绑定：`start`/`end`/`agent`/`split`/`review`/`fanout` 必须绑专家，`confirm` 禁止绑专家（不变）。
- 本期运行期拒绝 `split`/`fanout`：启动返回 `400 unsupported_node_type`，消息说明第二期支持。
- 兼容性：现有 1 条演示流程只含 `start`/`end`，两者均已有 `expertId`，无需迁移；UI 需按新枚举调整节点面板（破坏性变更，按契约变更流程通知）。

## 8 失败、取消与归档

- **节点失败**（错误 / 超时 / verdict 非法）：run `failed`，停在此节点；运维可重开 run。是否支持原地重试转 `OQ-28`。
- **取消**：`POST /runs/{id}/cancel` → `scheduler.cancelInstances(instanceId)` 电平取消当前任务 → run `cancelled`；`waiting_confirm` 直接取消。
- **归档**：run 进入终态后置 `archive.pending`，随 poll 下发 `archiveRequests`；client 上传 `P-05` 后下一跳报 `archivedRuns`，服务端置 `stored`；client 离线则保持 `pending`（不阻塞 run 终态）。
- **重启恢复**：`CMP-run` 启动时扫描 `running`/`waiting_confirm` 的 run；`dispatched` 的 `run_node` 用 `scheduler.inspect(taskId)` 对账，已结算则补结算再推进；未结算保持等待（调度器 `S-02` 会重派）。

## 9 分期

| 期 | 内容 | 出口 |
|---|---|---|
| 第一期（本工序） | run 启动/推进/判定/回退/确认/取消/日志/归档；DSL 7 类（`split`/`fanout` 可存不可跑） | 四个场景 `verified` + 与 client v3 联调通过 |
| 第二期（另立工序） | `split` + `fanout`：SQLite task.db 生成与校验、大任务量展开、专家技能集一致性（`OQ-26`）；单条任务失败不中断，全部跑完再汇总（2026-11-11 确认） | 见第二期 brief |

## 10 需要确认的四件事（P1 第一次人工评审确认）

1. **切分**：新增 `CMP-run`（方案 A），`CMP-scheduler` 不改。
2. **契约 v3**：§6 的端点、字段、常量、`C-08` 修订是否接受；版本号升 3。
3. **DSL**：7 类节点、删除 `fanin`、`split`/`fanout` 本期可保存但启动拒绝。
4. **并发策略（2026-11-11 修订）**：同一 `instance_id` 同一时刻只允许一个活跃 run，启动第二个返回 `409 run_conflict`。理由：`S-06` 规定同实例并发任务必须同一技能集，而不同 run 的节点专家不同；task-space 按 `runId` 隔离只解决文件，不解决 `.dsh/skills`。fan-out 是例外：它在一个 run 内展开多个任务，共用同一专家与 digest。不同工作区之间互不影响。

确认后：`T-RUN-02` 落四张场景卡，`T-RUN-03` 冻结组件规格与契约，再做 P1 第二次确认，然后才编码。
