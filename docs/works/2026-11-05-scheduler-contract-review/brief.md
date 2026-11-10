---
layer: works
module: global
status: closed
updated: 2026-11-05
---

# 工序：执行面接口契约评审（调度器侧）

## 背景

`agent-flow-client` 侧提交了《调度器契约提案：执行面客户端的接口依赖（v0.1）》，明确请求调度器侧逐项裁决（提案 §4「请求评审」）。该稿是 M1 冻结的输入，冻结后再改字段与错误语义即为破坏性变更，因此在冻结前做一次四档评审。

本工序同时回答一个交互方向上的备选问题：**是否在 client 侧也起一个 HTTP 服务，让调度器反向调用**（用户 2026-11-05 提出，网络与路由层由拓扑解决，不作为约束）。

## 目标

1. 对提案 `C-01`…`C-07`、`SCH-01`…`SCH-18`、`CLT-01`…`CLT-12` 与 §15 的 12 项待裁决给出四档裁决（Blocker / Decision now / Verified sound / Hold），每条带证据位置。
2. 对「client 起 HTTP」给出方案评估与结论，说明它在什么条件下才值得重开。
3. 产出 M1 冻结的输入清单：必须先改的条目、需要拍板的条目、明确不阻塞的条目。

## 范围

- 只评审契约与交互方向；不改提案原文，不改 client 侧 `design/`，不改本仓库 `design/`。
- 评审材料：提案全文；本仓库 `docs/works/2026-11-03-client-boundary/boundary-design.md`；client 侧 `docs/design/architecture.md` 与组件规格（只读）。

## 非目标

- 不冻结字段、不写实现代码、不改 `plan/open-questions.md`（冻结工序再动）。
- 不评调度器侧内部实现（组件切分、表结构），只评它对 client 承诺了什么。
- 不评 `run` 本地模式（提案 §17 明确不在范围内）。

## 验收标准

| 项 | 判据 |
|---|---|
| 四档裁决 | 每条发现带档位、证据位置（§/行）、后果、修法；无「我觉得有问题」式条目 |
| 交互方向 | 给出选项、代价算术、触发条件，结论可执行 |
| 冻结输入 | 列出 Blocker 与 Decision now 的逐条改法，M1 可直接照改 |

## 任务表

| ID | 类型 | 内容 | 状态 |
|---|---|---|---|
| T1 | review | 提案语义走查（身份、租约、幂等、重放、终态） | 完成 |
| T2 | review | 调度器责任与客户端承诺的可实施性核对 | 完成 |
| T3 | design-check | 「client 起 HTTP」方案评估 | 完成 |
| T4 | record | 落 `review.md`；`result.md` 待收口 | 完成 |
| T5 | re-review | v0.2 修订复核（Blocker/Decision 关闭核对 + 新发现 `ND-01`…`ND-06`） | 完成 |
| T6 | re-review | 附评：client 只读观测 HTTP P1（独立对象，`OB-01`…`OB-09`） | 完成 |
| T7 | re-review | v0.4 复核（`cleanupPending` 机制 + `SCH-20`），新发现 `N2-01`…`N2-05` | 完成 |
| T8 | re-review | 观测面处置复核（`OB-02`–`OB-09` 关闭；`OB-01` 风险接受的意见） | 完成 |
