---
layer: history
module: global
status: frozen
updated: 2026-11-11
---

# 2026-11-11 工作流运行编排：新增 `CMP-run`、执行面 v3、DSL 收敛 7 类节点

## 背景

B1（资产注册）与 B3（工作流定义）已实现，执行面调度层（`CMP-scheduler`/`CMP-instance` + v2 三端点）也已实现并联调通过。但「工作流定义」到「真正跑起来」之间缺一层运行编排：没有 run 聚合、没有节点推进、没有判定与回退、没有会话日志与归档。`REQ-0001` 与 [`2026-11-11-workflow-run-orchestration`](../../works/2026-11-11-workflow-run-orchestration/brief.md) 承接这件事。

本记录固化 2026-11-11 概念讨论与 P1 设计评审确认的**结构性决策**；字段级细节见 [`design-proposal.md`](../../works/2026-11-11-workflow-run-orchestration/design-proposal.md)、[`CMP-run` 规格](../../design/components/run/spec.md) 与 [`executor-http-v3`](../../design/contracts/executor-http-v3.md)。

## 决策

1. **新增 `CMP-run` 编排组件**（`planned`）：拥有 `workflow_run` / `run_node` / `run_artifact` 三张表；负责启动快照、节点推进、verdict 解析与回退、人工确认、取消、制品登记与归档指令。
2. **`CMP-scheduler` 不改**：仍是任务列表的唯一写入口；`run` 通过 `enqueue` / `cancelInstances` / `inspect` 使用它，`scheduler` 不感知 `run`，`task` 表不加 `run_id`。
3. **执行面契约升 v3**：新增 `P-04` 会话日志（gzip JSONL，先传后报，缺失 `409 session_log_missing`）与 `P-05` 运行归档（tar.gz）；`P-01` 增 `archiveRequests`/`archivedRuns` 电平字段；`TaskRequest` 增 `taskSpacePath` 与首任务 `intentMarkdown`；常量、错误码与客户端承诺同步增补。
4. **节点类型收敛为 7 类**：`start / agent / split / review / confirm / fanout / end`，删除 `fanin`；`start`/`end` 变为执行节点；`confirm` 为人工节点（不建 session，`autoConfirm` 可自动通过）；`split`/`fanout` 本期可保存、启动时拒绝（`unsupported_node_type`）。
5. **跳转复用 `rollback` 边**：只允许 `review`/`confirm` 发起、目标必须是祖先；模型只输出 verdict，不决定目标；回退按 `visit` 计数，超过 `run.max_node_visits` 则 run 失败。
6. **业务解析留在调度器**：client 只传输（日志、归档、结果），verdict 由 `CMP-run` 从最终消息解析，task.db（第二期）由服务端解析，client 不懂工作流语义。
7. **task-space 与归档**：运行期目录 `<workspace>/.agent-flow/task/<runId>/`（client 创建），`intent.md` 由 client 首任务写入；服务端归档根 `archive.root` 下按 `history/<instanceId>/<runId>/` 存 task-space 包与日志副本；本地目录保留不删除。
8. **并发与实例**：同一 instance（工作区）同一时刻只允许一个活跃 run，启动第二个返回 `409 run_conflict`；不同工作区各自并行；fan-out 在同一 run 内并发多个任务（第二期）。实例按 `(clientId, workspacePath)` 复用（`instance.getByBinding`），不随 run 新建。原因：`S-06` 要求同实例并发任务同一技能集，不同 run 的节点专家不同；task-space 只隔离文件，不隔离 `.dsh/skills`。

## 被否决的方案

- **扩展 `CMP-scheduler` 承载 run**：会让调度器依赖图与 prompt 组装，违反「只管任务列表」的单一职责，执行面热路径混入编排。
- **在 `http-gateway` 内做编排**：网关应只做协议翻译；编排有持久状态与事务，放网关会让协议层承担业务状态。
- **用 `behavior` 字段与 `type` 并存**：两个概念解释成本高；本轮直接收敛节点类型（库里只有 1 条演示流程，迁移成本低）。
- **client 解析 verdict/task.db 后上报**：client 会懂工作流语义，两端规则容易漂移；改为服务端解析。
- **同一 instance 多 run 并发**：用户最初确认允许并发，随后在发现 `S-06` 与专家技能集冲突后修订为「同一工作区同时只跑一个活跃 run」；task-space 只隔离文件，不隔离技能目录。
- **task.db 用 JSON**：用户选择 SQLite（大任务量、格式校验、可查询）；风险「模型不能可靠生成 SQLite 二进制」由 skill 脚本在 client 侧解决（第二期落）。

## 后果与回滚

- 执行面 v3 是破坏性升级：`X-Executor-Protocol: 2` 的 client 升级后会被 `400` 拒绝；client 与调度器必须同批升级。v2 契约已归档到 [`history/works/2026-11-10-executor-contract-v2/executor-http-v2.md`](../works/2026-11-10-executor-contract-v2/executor-http-v2.md)，`design/contracts/` 只保留 v3，不设过渡期与双版本并行期。
- 节点枚举删除 `fanin` 是定义侧破坏性变更：旧图若含 `fanin` 将无法保存/运行；当前仅 1 条 `start→end` 演示流程，无需迁移。UI 为独立项目，需按新枚举适配。
- `CMP-run` 是新增组件与 3 张表，属 P1 结构性变更；实现前需 P1 第二次人工评审确认（规格冻结）。
- 回滚方式：撤销 `CMP-run`、`workflow_run` 系列表与 v3 契约，执行面回到 v2；`split`/`fanout` 枚举与 `fanin` 删除可单独回滚到 2026-11-10 版本（需同步回滚 `CMP-workflow` 规格与 UI）。
- 本次只改文档，不改代码、端点实现、表或迁移。

## 确认记录

- 2026-11-11：用户在对话中逐项确认节点语义、启动参数、task-space、并发、契约 v3、fan-out 分期与部分失败策略，并接受 P1 设计提案；T-RUN-03 规格冻结仍待第二次人工评审确认。
