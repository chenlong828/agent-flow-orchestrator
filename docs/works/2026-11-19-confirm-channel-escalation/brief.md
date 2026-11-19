---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-19-confirm-channel-escalation
level: P2
---

# 工序：确认通道补强（prompt 收敛 + 评审应急呼人）

> 用户方向（2026-11-19）：`auto-confirm` 已改为「普通决策默认确认 + 严重场景 MCP 应急确认」，但节点 prompt 仍只列四类，评审节点也不能呼人。启动本工序：**prompt 写全严重场景；评审节点在非常必要时可以走 `mcp__agentflow__confirm` 呼人，拿到意见后继续同一 session**。
> 本工序当前只做提案与任务拆分；实现由后续任务承接。

## 1 背景

2026-11-18 的工序 [`2026-11-18-review-verdict-mcp`](../2026-11-18-review-verdict-mcp/brief.md) 已经落地：

- 执行中临时确认点：模型调 `mcp__agentflow__confirm` → client 采集 `confirmation_request` → `CMP-run` 进入 `waiting_confirm` → 人 `decide(pass|reject)` → 同一 session 续跑（[`human-interaction.md`](../2026-11-18-review-verdict-mcp/human-interaction.md)）。
- client 的 MCP signal server、`TaskRequest.resultSignal`、`resumeSessionId`、`waiting_confirm` 状态都已实现。

但当前实现有三处只覆盖 `agent` 节点：

1. `signalForNode` 对 `review` 只返回 `review_verdict` 契约（[`signals.ts`](../../../src/components/run/signals.ts)）；
2. client 的 `C-15` 按 `resultSignal.kind` 只挂一个工具（[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md)）；
3. prompt 的 `[确认通道]` 只在 `agent` 节点出现，且只列「契约变更、严重超出范围、关键信息缺失、无法解决的冲突」（[`prompt.ts`](../../../src/components/run/prompt.ts)）。

后果：

- `auto-confirm` §3 已列的「规则突破、不可逆/外部副作用、P0/P1」没有在 prompt 显式承载，模型可能只按旧四类判断；
- 评审遇到需要人拍板的契约口径，只能 `fail` 回退，由上游 agent 再问一次；多一次回退，且评审自身无法澄清。

## 2 范围

| 做 | 不做 |
|---|---|
| `[确认通道]` 文案：agent 写全严重场景；review 增加严格版 | 不改 `review_verdict` 字段/语义；不改 `decide` API/UI |
| review 节点增加**可选**确认契约（建议 `TaskRequest.confirmation`），client 同时挂 `signal` + `confirm` | 不做通用聊天/任意节点呼人；不做新 MCP 工具 |
| 执行面契约、调度校验/透传、run 状态、client、技能、测试、发布文档 | 不改 `auto-confirm` 的默认确认范围（只补 review 例外） |
| 真实 client + DSH 的 review confirm 端到端 | 不改 DB schema/迁移；不重做 UI |

## 3 定级

**P2（已确认 2026-11-19）**：执行面契约加法（可选 `confirmation` 字段）、prompt 文案、review 能力；不改核心 schema/数据所有权，旧 client 契约不变。

## 4 验收标准

设计阶段（本工序当前阶段）：

1. [`proposal.md`](proposal.md) 写清：契约形状、prompt 文案、review confirm 的运行序与边界、client/orchestrator 落点、兼容/发布、测试、风险。
2. 明确「评审只在非常必要时呼人」的判据：只澄清已 accepted 的契约/口径，且该口径直接决定 verdict；**不把评审判断本身交给人**。
3. 与用户确认级别、契约形状、评审范围后再排实现。

实现阶段（后续任务）：

4. agent prompt 显式列出严重场景；普通决策不暂停。
5. review prompt 有严格确认通道；review 调 confirm 后 run 进入 `waiting_confirm`，人答复后同一 session 续跑；评审仍须自行提交 `review_verdict`，不自动 pass。
6. 现有 agent confirm 不回归；没有 `confirmation` 契约的客户端保持旧行为。
7. 单测/契约测试/集成/E2E 通过；`executor-http-v3`、组件规格、技能文本同步。

## 5 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-CCE-01` | design | global | 本提案与契约/语义/测试/发布设计 | 完成 |
| `T-CCE-02` | design | global | 确认级别、契约形状（`confirmation` vs `resultSignals[]`）、评审范围 | 完成（[`proposal.md`](proposal.md) §8） |
| `T-CCE-03` | change | run/scheduler/http-gateway | prompt 文案、review 确认契约、调度校验/透传、run 测试 | 完成 |
| `T-CCE-04` | change | client（跨项目） | 多契约 prepare/mount/collect、review 工具暴露、测试 | 提案完成；实现待 client 仓库 |
| `T-CCE-05` | change | scripts/seed | `auto-confirm` §5、`review-verdict` 文本同步 | 完成 |
| `T-CCE-06` | verify | global | review confirm pass/reject/无答复；agent confirm 回归；真实 client 联调 | 本仓库用桩覆盖；真实 client 联调待 `T-CCE-04` |
| `T-CCE-07` | docs | global | 执行面契约、组件规格、发布记录 | 完成 |

## 6 装载清单

- 既有确认点实现：[`2026-11-18-review-verdict-mcp`](../2026-11-18-review-verdict-mcp/brief.md)、[`human-interaction.md`](../2026-11-18-review-verdict-mcp/human-interaction.md)
- 执行面契约：[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md) §4.2、`C-13`、`C-15`、`S-05`
- orchestrator：[`signals.ts`](../../../src/components/run/signals.ts)、[`dispatch-ops.ts`](../../../src/components/run/dispatch-ops.ts)、[`prompt.ts`](../../../src/components/run/prompt.ts)、[`results.ts`](../../../src/components/run/results.ts)、[`commands.ts`](../../../src/components/run/commands.ts)、[`validate.ts`](../../../src/components/scheduler/validate.ts)
- client：[`contract.ts`](../../../../agent-flow-client/src/components/signal/contract.ts)、[`signal-runner.ts`](../../../../agent-flow-client/src/components/executor/signal-runner.ts)
- 技能：[`auto-confirm`](../../../scripts/seed-skills/auto-confirm/SKILL.md)、[`review-verdict`](../../../scripts/seed-skills/review-verdict/SKILL.md)、[`arch-design-spec`](../../../scripts/seed-skills/arch-design-spec/SKILL.md)
- 本工序提案：[`proposal.md`](proposal.md)
- client 侧实施提案：[`client-implementation-proposal.md`](client-implementation-proposal.md)

## 7 待定

全部已定，见 [`proposal.md`](proposal.md) §8。剩余未完成项是 `T-CCE-04`（client 实现）与 `T-CCE-06`（真实 client 联调）。
