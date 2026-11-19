---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-19-confirm-channel-escalation
---

# 结果：确认通道补强（orchestrator 侧 + client 提案）

## 1 结论

- **orchestrator 侧已落地**：review 节点在 `review_verdict` 之外额外下发可选的 `confirmation` 契约；client 同时拿到 `signal` 与 `confirm` 两个契约的意图；prompt 按 agent/review 输出两段互斥文案；调度器把两个契约一起冻结、重派原样下发。
- **client 侧只出提案**：[`client-implementation-proposal.md`](client-implementation-proposal.md) 写明多契约 prepare/mount/collect 的具体改法；真实 client 实现后由本工序做联调（`T-CCE-06`）。
- **未做真实 client 联调**：本仓库用桩任务覆盖 review confirm pass/reject/无答复/取消；client 尚未挂载 `mcp__agentflow__confirm`，所以“模型实际呼人”这一段未验证，标为待后续。

## 2 验收对照（brief §4 实现阶段）

| 条目 | 结果 | 证据 |
|---|---|---|
| 4. agent prompt 显式列出严重场景，普通决策不暂停 | 通过 | `[确认通道]` 新文案六类场景 + `auto-confirm §2`；`tests/components/run/prompt.test.ts` 断言原句与互斥 |
| 5. review prompt 有严格确认通道；confirm 后 `waiting_confirm`；答复后同一 session 续跑；仍须自行提交 verdict | 通过 | review prompt 单测；`tests/components/http-gateway/run-signals.test.ts` 三个 review confirm 用例 + 确认优先用例 |
| 6. agent confirm 不回归；没有 `confirmation` 的任务保持旧行为 | 通过 | 既有 agent confirm pass/reject 用例全绿；`TaskDraft` 无 `confirmation` 时 `envelope` 不出现该字段（`tests/components/scheduler/validate.test.ts`、`TC-EXD-009`） |
| 7. 单测/契约测试/集成通过；执行面契约、组件规格、技能文本同步 | 通过（E2E 待 client） | `bun run typecheck`、`bun test` 全绿；`docs:check` 通过；契约/规格/seed 已改 |

## 3 落点

| 内容 | 文件 |
|---|---|
| review 确认契约 | [`signals.ts`](../../../src/components/run/signals.ts) `REVIEW_CONFIRMATION_SIGNAL` / `confirmationForNode` |
| 派发透传 | [`dispatch-ops.ts`](../../../src/components/run/dispatch-ops.ts) |
| prompt 文案 | [`prompt.ts`](../../../src/components/run/prompt.ts) |
| 调度契约与持久化 | [`types.ts`](../../../src/components/scheduler/types.ts)、[`validate.ts`](../../../src/components/scheduler/validate.ts)、[`store.ts`](../../../src/components/scheduler/store.ts)、[`enqueue.ts`](../../../src/components/scheduler/enqueue.ts)、[`mappers.ts`](../../../src/components/scheduler/mappers.ts) |
| 执行面 DTO | [`executor-types.ts`](../../../src/components/http-gateway/routes/executor-types.ts) |
| 执行面契约 | [`executor-http-v3.md`](../../design/contracts/executor-http-v3.md) §4.2、`S-05`、`C-13`、`C-15`、§11.7 |
| 组件规格 | [`run/spec.md`](../../design/components/run/spec.md) §4.4/§4.5/§4.9、[`scheduler/spec.md`](../../design/components/scheduler/spec.md)、[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) §5.8 |
| 场景 | [`review-verdict-and-rollback`](../../design/scenarios/workflow-orchestration/workflow-execution/review-verdict-and-rollback/scenario.md) 运行序、失败路径、测试 |
| 技能 seed | [`auto-confirm`](../../../scripts/seed-skills/auto-confirm/SKILL.md) §5（v1.3）、[`review-verdict`](../../../scripts/seed-skills/review-verdict/SKILL.md)（v1.11） |
| 测试 | [`prompt.test.ts`](../../../tests/components/run/prompt.test.ts)、[`validate.test.ts`](../../../tests/components/scheduler/validate.test.ts)、[`service.test.ts`](../../../tests/components/scheduler/service.test.ts) `TC-EXD-009`、[`run-signals.test.ts`](../../../tests/components/http-gateway/run-signals.test.ts) review confirm 用例 |
| client 提案 | [`client-implementation-proposal.md`](client-implementation-proposal.md) |

## 4 决策与默认

| 项 | 采用 | 来源 |
|---|---|---|
| 级别 | P2 | 用户 2026-11-19 确认（`proposal.md` §8） |
| 契约形状 | 可选 `confirmation` 字段 | 同上；`resultSignals[]` / `allowConfirm` 不选 |
| 评审范围 | 全部 review 节点 | 同上 |
| 次数上限 | v1 prompt 约束每访问最多 1 问 | 同上 |
| 无答复 | 一直等待，不自动 pass | 同上 |
| 旧 client | 同版本发布；client 先实现、orchestrator 后联调 | 用户 2026-11-19 答复 |
| 持久化 | 复用 `task.result_signal` 列存 `{ resultSignal?, confirmation? }`，不加迁移 | 用户 2026-11-19 答复 |
| review 同时回 confirm 与 verdict | 确认优先：先暂停，不结算 verdict | 实现默认；`run-signals.test.ts` 固化 |

## 5 验证

```text
$ ./.local/bun/bun run typecheck
$ tsc --noEmit        # 通过

$ ./.local/bun/bun test --max-concurrency=1
440 pass / 1 skip / 0 fail（441 tests，53 files）
# 1 skip 是 seed 技能里的坏样例夹具，非本工序新增

$ ./.local/bun/bun run docs:check
场景索引已是最新：17 个场景

$ ./.local/bun/bun run quality:report
合计：违规 0 条；仅报告 223 条；规则分组 3 组；工具健康 8/8
```

## 6 未完成与后续

1. `T-CCE-04`：client 仓库按 [`client-implementation-proposal.md`](client-implementation-proposal.md) 实现多契约 prepare/mount/collect；本仓库未改动 client。
2. `T-CCE-06`：真实 client + orchestrator 的 review confirm pass/reject/无答复/取消联调；Q/A 落 `review.md`。
3. `T-CCE-05` 中 brief 原列的 `arch-reviewer` 在 seed 目录不存在；实际同步的是 `auto-confirm` 与 `review-verdict`，`arch-design-spec` 的确认语义已由 `auto-confirm` 覆盖，未改。
4. 旧 `task.result_signal` 行（单契约形状）不兼容复合形状：按用户决定不做迁移与读兼容；开发库如遇旧任务重派，需要重置数据。
5. 混跑旧 client：旧 client 不解析 `confirmation`，review 仍能回 verdict，但无法呼人；v1 按同版本发布处理。

## 7 裁决摘要

blocker 0 / decision 2（持久化形态、确认优先，均已落文档与测试）/ hold 5（client 实现、真实联调、服务端计数与超时、旧行兼容、`arch-reviewer` 文本，均已写明不阻塞理由）。详见 [`review.md`](review.md)。
