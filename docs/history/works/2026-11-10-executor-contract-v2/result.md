---
layer: history
module: global
status: frozen
updated: 2026-11-10
---

# 结果：执行面契约 v2

## 1. 验收

| 判据（brief） | 结果 | 证据 |
|---|---|---|
| 可交付：client 不需要回看 v1 即可实现，字段无歧义 | 满足 | client 已按本契约完成实现（`e047e0a`）；接口验证 55/57 通过，2 项偏离在 client 实现侧，契约文本本身无歧义 |
| 可追溯：每个被删机制在 §11 有「为什么删」与兜底 | 满足 | 契约正文 §11.1/§11.2 |
| 可验收：§10.1 桩面覆盖重复派发、静默回队、超时回队、重复结果 | 满足（client 侧可验部分） | 静默回队/超时回队属调度器侧行为，尚未实现；client 侧由验证工序覆盖下发、重复下发、重复结果、stop、取消、超时 |
| 时机：明确「调度器侧尚无实现」，不承诺 v1 兼容 | 满足 | `delivery.md` §9；本次复核 `src/`、`tests/`、`db/` 仍无 executor 实现 |

## 2. 交付说明 §8 的两个待确认项

| 项 | client 实现 | 结论 |
|---|---|---|
| `maxConcurrent` 默认值 | `[capacity].max_concurrent` 缺省 4（`agent-flow-client/src/components/cli/config.ts:176`） | 已确认，落在建议区间 2–4 |
| `idle_timeout` 默认关闭 | `[executor].idle_timeout_ms` 缺省 0（同文件 `:185`） | 已确认 |

## 3. 结论落点

| 结论 | 落点 |
|---|---|
| 契约正文（现行权威） | [`../../../design/contracts/executor-http-v2.md`](../../../design/contracts/executor-http-v2.md) |
| 客户端改造清单 | `delivery.md` §6；client 已按单落实 |
| 接口一致性与偏离 | [`../2026-11-10-executor-contract-verification/verification.md`](../2026-11-10-executor-contract-verification/verification.md) |
| 契约待修订 3 项 | `plan/open-questions.md` `OQ-12`…`OQ-14` |
| client 侧待修 3 项 | 同表 `OQ-15`…`OQ-17` |

## 4. 收口说明

- 本工序交付物（契约、client 改造清单、v1 差异表）已完成并被 client 实现吸收；本轮验证没有再发现契约骨架问题，只发现 2 处需修订的语义边界与 1 处未定义行为，已转出为开放问题，不阻塞收口。
- **归档前已处置**（2026-11-10）：契约正文已移到 `docs/design/contracts/executor-http-v2.md`，本工序目录不再持有现行权威。client 仓库契约副本头部的权威路径仍需同步更新（跨仓库，登记为待办）。
- 契约正文的 3 处修订（`OQ-12`–`OQ-14`）属语义变更，按 P2 另行处理，不在本工序内改。
