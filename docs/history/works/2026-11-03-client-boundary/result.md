---
layer: history
module: global
status: frozen
updated: 2026-11-10
---

# 结果：调度器与 agent-flow-client 边界设计

## 1. 关闭裁定（2026-11-10，用户裁决）

本工序直接关闭，**不按契约 v2 改写交互章节**。

理由：本工序在**没有智能体客户端真实执行负载数据**的前提下，预设了注册、心跳、租约、会话绑定、清理回执、幂等键等一整套交互机制，属过度设计。2026-11-10 契约 v2 按 at-least-once 重新裁定后，这些机制大半被删除或替换（见 `v2-alignment.md` 的 12 处冲突）；继续逐条修补只会保留错误前提。保留下来的是职责、所有权与决策归属，这些部分与 v2 不冲突。

## 2. 验收对照

| 判据（brief） | 结果 | 说明 |
|---|---|---|
| 职责矩阵覆盖定义、调度、执行、状态、技能、工作区、结果、失败、安全、观测 | 满足 | 设计稿 §3 |
| 主流程能说明两侧在实例启动、节点执行、技能刷新、结果、关闭、取消、离线时的动作 | 满足（v1 机制口径） | §4.2；其中会话绑定、技能换取等动作已被 v2 取代 |
| 明确状态与数据所有权，不出现双权威 | 满足 | §5；v2 仍保持调度器权威 |
| 两侧工作包与里程碑可据此开工 | 满足 | §7、`client-work.md`；`CW-02`/`CW-07` 口径已过时 |
| client 侧工作清单可直接拆任务 | 满足 | `client-work.md` |
| 不把实现细节写成结论 | 满足 | — |

## 3. 结论落点

| 结论 | 落点 |
|---|---|
| 现行交互机制（唯一依据） | [`docs/design/contracts/executor-http-v2.md`](../2026-11-10-executor-contract-v2/executor-http-v2.md)：三端点、at-least-once、无租约/心跳/绑定/清理指令 |
| 与 v2 的逐条冲突（12 处）与缺口（2 处） | [`v2-alignment.md`](v2-alignment.md) |
| 进程模型决策 | `docs/history/decisions/2026-11-03-client-workspace-process-model.md` |
| 仍成立的边界结论 | 控制面/执行面分离、状态单家、工作区与产物归 client、决策归属、`timeoutMs` 上界、client 只重试传输层 |

## 4. 未执行项与遗留

- `T-CB-05`（按 v2 改写交互章节）**取消**：不重写文档，改为整工序关闭归档。
- `BC-13` 实例粘性（重派是否允许换 client）、`BC-14` 实例不可用上报，转 `plan/open-questions.md` `OQ-20`、`OQ-21`；这两条要在调度器实现前定，否则会各自补一套。
- 跨仓库引用：client 仓库 `README.md` 仍指向 `docs/works/2026-11-03-client-boundary/`，归档后失效，需 client 侧同步为 `docs/history/works/`。
- 归档后，`2026-11-03-client-workspace-process-model.md` 中的两处 `works/` 路径属于冻结历史文本，按纪律不改；以本结果与 `v2-alignment.md` 的归档路径为准。
