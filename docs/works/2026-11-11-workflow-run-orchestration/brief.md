---
layer: works
module: global
status: active
updated: 2026-11-11
procedure: 2026-11-11-workflow-run-orchestration
level: P1
---

# 工序：工作流运行编排（B4 第一期）

> 承接 [`REQ-0001`](../../requirements/REQ-0001-workflow-run-orchestration.md)。设计提案见 [`design-proposal.md`](design-proposal.md)；本文件只定范围、任务与验收。

## 1 目标与结论

把「工作流定义」接到「真正跑起来」：新增 `CMP-run` 编排组件，按启动时冻结的图快照逐节点推进，节点执行仍由 `CMP-scheduler` 派发给 client；`review` 失败沿回退边退回指定节点，`confirm` 等待外部决策，每个节点回传 session-log，run 结束归档 task-space。

`CMP-scheduler` 不改；客户端契约由 v2 升到 v3；工作流 DSL 收敛为 7 类节点。

## 2 范围

**做**（第一期）：

- `workflow_run` / `run_node` / `run_artifact` 三张表与迁移；`archive.root` 配置。
- `CMP-run` 组件：启动、节点推进、verdict 解析、回退轮次、confirm 决策、取消、归档指令。
- 产品面 6 个端点：启动 run、查 run、列 run、取消 run、confirm 决策、读 session-log。
- 执行面 v3：`P-04` 上传 session-log、`P-05` 上传 run 归档；`poll` 增 `archiveRequests` 与 `archivedRuns`；`TaskRequest` 增 `taskSpacePath`；启动诉求并入首节点 `prompt`（2026-11-12 修订，不再单独下发）。
- 工作流 DSL：节点枚举 7 类、删除 `fanin` 与 `fanout→fanin` 配对规则、`review`/`confirm` 回退边规则保持。
- 场景 `SCN-0301`–`SCN-0304` 的 3 正 1 反测试与联调记录。

**不做**：`split` / `fanout` 的执行（第二期）；UI；跨实例调度；管理面鉴权；实时事件推送。

## 3 前置

| 条件 | 状态 | 说明 |
|---|---|---|
| 执行面 v2 与调度层 | 已完成 | `92135de`；`bun run check` 334 pass |
| 节点登记与凭据 | 已完成 | `API-41`；`harness.client_id`/`client_token` |
| `agent-flow-client` 可跑 v2 | 已完成 | 联调 `4c8f8b0`；v3 交接件已建，client 评审「有条件通过」，契约修订后待 client 再确认 |
| 现有工作流定义 | 1 条演示流程 | `start→end`，节点枚举变更对它无影响 |
| 归档存储 | `FileStore` 已有 | 新增 `archive.root`，复用适配器 |

## 4 任务表

| ID | 类型 | 组件 | 范围 | 状态 | 出口 |
|---|---|---|---|---|---|
| `T-RUN-01` | design | global | P1 设计提案：切分、数据、契约 v3、DSL 变更、分期 | 完成（2026-11-11 已确认） | [`design-proposal.md`](design-proposal.md) |
| `T-RUN-02` | design | global | 场景卡 `SCN-0301`–`SCN-0304` | 完成（2026-11-12，4 张 `verified`） | `tests`/`entries` 已随 `T-RUN-08` 补齐 |
| `T-RUN-03` | design | global | 组件规格 `CMP-run`、契约 v3 定稿、`CMP-workflow`/`CMP-http-gateway`/`CMP-config`/`CMP-kernel`/`CMP-instance`/`CMP-scheduler`/`architecture` 规格增量 | 完成（2026-11-11，待第二次人工评审确认） | 规格冻结后进入 `T-RUN-04` |
| `T-RUN-04` | change | kernel / platform / config | 迁移 `0002`：`workflow_run`/`run_node`/`run_artifact` 与活跃 run 唯一索引；`[run]` / `[archive]` 配置 | 完成（2026-11-11） | 迁移可重复执行；`bun run check` 339 pass |
| `T-RUN-05` | change | run | `CMP-run` 服务：start / advance / verdict / rollback / confirm / cancel / archive | 完成（2026-11-12） | `tests/components/run` 13 例；模块拆分为 core/node-ops/dispatch-ops/advance/results/commands/queries/artifacts/store-*；`quality:gate` 0 违规 |
| `T-RUN-06` | change | http-gateway | 产品面 6 端点 + 执行面 `P-04`/`P-05` + `poll` 字段映射 + 组合根接线 | 完成（2026-11-12） | openapi 已补 `API-42`–`API-47`（54 个业务端点、55 个 operation、38 个 path）；nodeId 校验改为图内稳定 ID；日志响应补 `X-Checksum-Sha256`；`quality:gate` 0 违规 |
| `T-RUN-07` | change | workflow | DSL 7 类节点、删除 `fanin` 配对、`fanout` 前驱必须是 `split` | 完成（2026-11-12） | workflow 23 例、openapi/DSL schema 同步 |
| `T-RUN-08` | verify | global | `SCN-0301`–`SCN-0304` 测试落地并转 `verified` | 完成（2026-11-12） | 4 个场景各 3 正 1 反（`TC-RUN-001`–`016`），`tests/components/http-gateway/run-*.test.ts` 全绿 |
| `T-RUN-09` | verify | global | 与 `agent-flow-client` v3 联调：启动→end、review 回退、confirm 决策、cancel、日志与归档 | 完成（2026-11-12） | 真实 client（`95d759a`）四条链路全过；记录见 [`result.md`](result.md) §3 |
| `T-RUN-10` | design | global | 按 client 评审修订契约 v3 与交接件（`B-01`–`B-04`、`D-01`–`D-10`） | 完成（2026-11-12） | 契约 §11.4 修订记录；交接件更新；客户端待按修订版重新确认 |

装载清单（开工前必读）：

- `T-RUN-02`：本文件、`design-proposal.md`、`REQ-0001`、现有执行面场景 `SCN-0201`–`SCN-0206`。
- `T-RUN-03`：`design-proposal.md`、[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md)、[`scheduler/spec.md`](../../design/components/scheduler/spec.md)、[`workflow/spec.md`](../../design/components/workflow/spec.md)、[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)。规格冻结产物：[`run/spec.md`](../../design/components/run/spec.md)、[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md)、[`architecture.md`](../../design/architecture.md)。
- `T-RUN-04`：迁移 `0001_baseline.sql`、[`config/spec.md`](../../design/components/config/spec.md)、[`platform/spec.md`](../../design/components/platform/spec.md)。
- 实现记录（2026-11-12）：`CMP-run` 落 `src/components/run/`（`types`/`deps`/`store`/`service`/`prompt`/`verdict`/`archive`/`graph-checks`/`validate`）；DSL 落 `graph.ts`/`graph-analysis.ts`/`dsl.schema.json`/`openapi.yaml`；`instance.getByBinding` 与 kernel 新错误码/常量已落。
- T-RUN-06 记录（2026-11-12）：新增 `task_space_path`（迁移 `0003_task_space.sql`、scheduler `TaskDraft`/`TaskEnvelope`），执行面协议升 3；`P-04`/`P-05` 与 `archiveRequests`/`archivedRuns` 已接线；产品面 `POST /workflows/{id}/runs`、`GET /runs`、`GET /runs/{id}`、`POST /runs/{id}/cancel`、决策与日志下载已实现；`3100` 已重启并验证 `/healthz`、`/openapi.yaml`、run 启动/取消。
- 联调问题（2026-11-12）：取消的 run 若从未有成功节点，服务端仍下发 `archiveRequests`，客户端本地无 task-space 只能反复 `archive.skipped`。已修：`finishRun` 仅在存在成功节点时置 `pending`；`archiveRequestsFor` 对 `pending` 超过 10 分钟（`archivePendingTtlMs`）的 run 降级 `failed` 并停止下发；迁移 `0004` 回填存量。测试 13 例，`bun run check` 353 pass。
- 质量门禁收口（2026-11-12）：`run` 模块拆为 `core`/`node-ops`/`dispatch-ops`/`advance`/`results`/`commands`/`queries`/`artifacts` + `store-*`；去掉全部非空断言与深导入；`workflow_run` 由迁移 `0005` 收敛到 20 列（`final_message`/`error` 合入 `result`，去掉冗余 `started_at`/`updated_by`）；`quality:gate` 0 违规。
- 实现期修正（2026-11-12）：决策/日志端点的 `nodeId` 改为图内稳定 ID（不再按 UUID 校验）；图引用专家不存在改为 400；访问轮次用尽不再抛 409（结果已接受，仅置 run failed）；`RunSummary` 列表按契约移除 `workspacePath`/`taskSpacePath`/`autoConfirm`/`error`（详情仍返回）。
- `T-RUN-05`：`T-RUN-03` 冻结的规格、`src/components/scheduler/service.ts`、`src/components/instance/service.ts`。
- `T-RUN-06`：`T-RUN-03` 冻结的契约、`src/components/http-gateway/routes/executor.ts`、`src/components/http-gateway/routes/workflow.ts`。
- `T-RUN-07`：`src/components/workflow/graph.ts`、`graph-analysis.ts`、`dsl.ts`、`dsl.schema.json`。

## 5 验收标准

1. `SCN-0301`–`SCN-0304` 的 3 正 1 反全部通过并转 `verified`；无 skip 无替身。
2. 契约 v3 冻结后与 `agent-flow-client` 联调完成：启动→执行→日志→结算→归档全链路；`review` 失败回退、`confirm` 等待与决策、`cancel` 生效各有记录。
3. `bun run check` 与 `bun run quality:gate` 通过；`docs:check` 通过。
4. 结论落 `result.md`：每条场景的通过/失败、偏差分级（阻塞/待定/已修）、未覆盖项。
5. 不把 token、工作区路径、模型凭据写入文档或提交。

## 6 不做什么

- 不改 `CMP-scheduler` 的派发、重派、结果接受语义（`S-01`–`S-08` 原样）。
- 不给 `task` 表加 `run_id`：run 侧自己存 `taskId` 关联，保持调度器对编排无感知。
- 不做 `split` / `fanout` 的运行语义；本期这两类节点可保存、不可启动。
- 不做 run 的 pause/resume；只做 cancel。
- 不做归档的读取端点；归档产物由运维按 `archive.root` 访问。
- 不改 `agent-flow-client` 代码；client 侧 v3 改造另立工序。

## 7 风险与待定

| 风险 | 影响 | 处理 |
|---|---|---|
| `split`/`fanout` 本期只定义不执行 | UI 可画出不可运行的图 | 启动时返回 `unsupported_node_type` 并给明确说明；第二期补齐 |
| 回退无环保护 | 反复不通过的 review 无限烧 token | 每节点最大重访次数（默认 5），超限 run 失败；写入规格 |
| session-log 体积 | 单节点日志可能上百 MB | 压缩上传 + 64 MiB 上限；超限时 client 先传 0 行空日志再报 `session_log_too_large`，任务正常失败结算，真实日志不保留（`R-001` 已接受） |
| 节点失败语义 | 失败即终态，运维只能重开 run | 先按「失败即终态」实现；是否支持重试转 `OQ-28` |
| 同一工作区并发 run | `S-06` 要求同实例并发任务同一技能集，不同 run 的专家不同 → 第二个 run 的 `enqueue` 会被拒 | 同工作区同一时刻只允许一个活跃 run，启动第二个返回 `409 run_conflict`；fan-out 在同一 run 内并发（第二期） |
| client 契约副本与实现未同步 | `T-RUN-09` 阻塞：client 仓库 HEAD 仍是 `executor-http-v2`；工作区已有未提交的 v3 实现与部分联调记录（`agent-flow-client/docs/works/2026-11-12-contract-v3-handoff/result.md`），但未提交、未确认 | 联调前需确认 client 工作区 v3 版本可作为被测版本，并补 review 回退/confirm/cancel 场景 |

## 8 领取的开放问题

- `OQ-22`（任务启动入口）→ 本工序关闭：启动端点定为 `POST /api/v1/workflows/{id}/runs`。
- `OQ-24`（联调注入通道）→ 本工序关闭：联调改用 run 启动；`jd.ts` 保留作排障。
- `OQ-25`（stop 无外部触发面）→ 本工序关闭运行级入口：`POST /runs/{id}/cancel` 经 `cancelInstances` 生效；进程优雅停机仍由信号处理。
- 新增 `OQ-26`–`OQ-28`（见 [`open-questions.md`](../../plan/open-questions.md)），本工序不阻塞。
- 跨项目依赖：`agent-flow-client` 的契约副本与 v3 实现不在本工序范围（见 §6「不做什么」），需在 client 仓库另立工序，交接件已建在 [`agent-flow-client/docs/works/2026-11-12-contract-v3-handoff/`](../../../../agent-flow-client/docs/works/2026-11-12-contract-v3-handoff/brief.md)；本工序只交付调度器侧，`T-RUN-09` 以其完成为前置。

## 9 规格冻结记录（T-RUN-03，2026-11-11）

**冻结产物**

- [`CMP-run` 规格](../../design/components/run/spec.md)：数据所有权、公共契约、状态机、推进/判定/回退/prompt/归档、恢复、验证计划。
- [`executor-http-v3`](../../design/contracts/executor-http-v3.md)：协议版本 3、`P-04`/`P-05`、`P-01`/`TaskRequest` 增量、错误码、客户端承诺 `C-10`–`C-12`。
- [`CMP-workflow` §5.1](../../design/components/workflow/spec.md)：7 类节点语义、删 `fanin`、`fanout` 前驱规则、执行侧归属。
- [`CMP-http-gateway`](../../design/components/http-gateway/spec.md)：`API-42`–`API-47`、`EXE-04`/`EXE-05`、DTO、错误映射、依赖边界。
- [`CMP-config`](../../design/components/config/spec.md)：`[run]` / `[archive]` 分节与三个配置项。
- [`CMP-kernel`](../../design/components/kernel/spec.md)：6 个新错误码与语义边界。
- [`CMP-instance`](../../design/components/instance/spec.md)：`getByBinding` 读方法。
- [`CMP-scheduler`](../../design/components/scheduler/spec.md)：`inspect` 用于运行对账；调度语义不变。
- [`architecture.md`](../../design/architecture.md)：第 13 个组件、依赖边、数据所有权、端点计数。
- [`history/decisions/2026-11-11-workflow-run-orchestration.md`](../../history/decisions/2026-11-11-workflow-run-orchestration.md)：结构性决策与被否决方案。

**冻结中发现并调整的设计点**（第二次人工评审确认重点）

1. **实例复用**：原提案让 run 自建实例；但 `CMP-instance` 有「同 client 同 `workspacePath` 唯一」不变量，第二次启动会撞冲突。改为按 `(clientId, workspacePath)` 复用，新增 `getByBinding`；同工作区同时只允许一个活跃 run（见第 6 点）。
2. ~~**冲突错误码统一**~~（2026-11-12 被 client 评审否决）：同键重传改为**后到覆盖**，`content_conflict` 删除；理由见 §9.1。
3. **`run_node` 不设 `running`**：编排侧没有「已开始」信号，只有 `dispatched` 与结果；少一个不可观测状态。
4. **崩溃窗口**：`enqueue` 提交后、`run_node.task_id` 回填前崩溃会重复入队一次并可能重复执行。按契约的 at-least-once 接受，不引入幂等键；已写入规格 §4.8。
5. **契约形态**：v2 → v3 是开发期版本替换，不设过渡期。v3 写成**完整契约**（含 v2 全部有效条款），v2 已移入 `history/works/2026-11-10-executor-contract-v2/` 冻结，`design/contracts/` 只保留 v3。

6. **同工作区单活跃 run**：发现 `S-06`（同实例并发任务必须同一技能集）与「多 run 共用工作区」冲突，改为同一 `instance_id` 同时只允许一个活跃 run（`409 run_conflict`）；不同工作区各自并行；fan-out 是唯一例外。
7. **`run_node` 去重**：移除 `attempt` 与 `running`，只保留编排进度与节点语义结果；任务生命周期、`attempt`、重派以调度器为唯一真相（详见规格 §1.1）。

### 9.1 2026-11-12 契约修订（client 评审闭环）

client 评审见 `agent-flow-client/docs/works/2026-11-12-contract-v3-handoff/review.md`（有条件通过）。调度器侧按 `B-01`–`B-04`、`D-01`–`D-10` 修订契约 v3，摘要：

| 项 | 修订 |
|---|---|
| 日志超限（`B-01`） | 不再形成死锁：client 先传 0 行空日志，再报 `failed(session_log_too_large)`；真实日志不保留（`R-001` 接受） |
| 早失败无日志（`B-02`） | 每个 `attempt` 必须有一份日志，允许 0 行；早失败与取消先传空日志 |
| 重传幂等（`B-03`/`D-01`） | `P-04`/`P-05` 改为「后到覆盖」，响应 `stored`；删除 `content_conflict`；不要求 client 持久化压缩字节 |
| 归档与心跳（`B-04`） | 归档后台执行，不阻塞 poll；`archiveRequests` 不缩短 `pollHoldMs`；只在首次下发那一跳唤醒 |
| task-space 写入（`D-04`） | client 只建目录、不写内容；`intent.md` 由 start 节点模型写；删除 `TaskRequest.intentMarkdown` 与 `maxIntentBytes` |
| 归档字段（`D-03`） | `ArchiveRequest` 增 `workspacePath` |
| 日志透传（`D-05`） | 完整透传、不脱敏，服务端只存不解析；记 `R-002` |
| 错误码（`D-06`） | 结果错误码增 `session_log_too_large`、`archive_too_large` |
| §11 修正（`D-08`） | 明确 `S-02`、`S-07`、`C-06`、`C-08` 属变更，不再列在「未改变」 |
| 其他 | `archivedRuns` 保留到服务端不再下发；清理不覆盖 `.agent-flow/task`；归档确认后保留本地目录；升级丢弃 v2 遗留 `settled` 结果 |

新增任务：`T-RUN-10`（design，完成）：按 client 评审修订契约 v3 与交接件。client 需按修订版重新同步后再确认。

**第二次人工评审确认项**

- 上述 7 点是否接受。
- 规格冻结后进入 `T-RUN-04`（迁移）与 `T-RUN-05`–`T-RUN-07`（实现）；此前不写产品代码。
