---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-19-confirm-channel-escalation
---

# 评审：确认通道补强（P2）

> 范围：本工序 orchestrator 侧改动 + client 实现与真实联调。定级 P2（用户 2026-11-19 确认）。评审结论：**通过**（含真实 client + DSH 四条路径）。

## 1 变更面

- 契约：`TaskRequest.confirmation`（review 可选，`kind=confirmation_request`、`required=false`）；`TaskDraft.confirmation` 校验与冻结；`task.result_signal` 存 `{ resultSignal?, confirmation? }`。
- 运行：`confirmationForNode(review)`；派发透传；prompt 两段文案；review confirm 复用现有 `waiting_confirm` / `resumeSessionId`。
- 文档与技能：执行面契约 `C-13`/`C-15`/`S-05`/§11.7；run/scheduler/http-gateway 规格；SCN-0302；`auto-confirm` §5、`review-verdict`。
- 测试：prompt 单测、`validateDraft` 单测、调度双契约冻结、review confirm pass/reject/无答复/取消、确认优先。

## 2 Blocker

无。

## 3 Decision now

| # | 决定 | 证据 | 落点 |
|---|---|---|---|
| D1 | 不新增 `task.confirmation` 列，两个契约一起放进现有 `task.result_signal` 列 | 用户 2026-11-19 明确「复用 result_signal，不考虑旧版本」；`TC-EXD-009` 证明两个契约在重派 `attempt+1` 时原样下发 | [`scheduler/spec.md`](../../design/components/scheduler/spec.md) §2/§3.1；[`store.ts`](../../../src/components/scheduler/store.ts)；[`enqueue.ts`](../../../src/components/scheduler/enqueue.ts) |
| D2 | review 同一结果同时带 `confirmation_request` 与 `review_verdict` 时，**确认优先**：先暂停、不结算 verdict | 与 agent 路径一致；新增用例断言 `waiting_confirm`、`verdict.kind=confirmation_request`、后继未派发 | [`run/spec.md`](../../design/components/run/spec.md) §4.9；[`run-signals.test.ts`](../../../tests/components/http-gateway/run-signals.test.ts) |

代价与回退：

- D1 的旧 `task.result_signal` 行（单契约形状）不再被识别；开发库如需保留旧任务，重置数据即可。回退方案是加一列并迁移，不涉及契约面。
- D2 若将来要求「同一结果同时给确认与 verdict」按错误处理，改 `applyResult` 的优先级判断并补一条反例；当前行为已用测试固化，改动需要同步该测试。

## 4 Verified sound

| 区域 | 查了什么 | 结果 |
|---|---|---|
| prompt | 两段文案与 proposal §3 逐字对照；agent/review 互斥；start/end/confirm 不出现 | [`prompt.test.ts`](../../../tests/components/run/prompt.test.ts) 4 个用例通过 |
| 调度校验 | `confirmation` 只收 `confirmation_request` + `required=false`；8 KiB 上限；缺省不出现 | [`validate.test.ts`](../../../tests/components/scheduler/validate.test.ts) 5 个用例通过；`resultSignal.*` 错误字段前缀未变 |
| S-05 | 首次派发与重派 `attempt=2` 的 `resultSignal`/`confirmation` 逐字段相等 | `TC-EXD-009` 通过 |
| run 状态 | review confirm → `waiting_confirm`，无 verdict；pass/reject 续跑同一 `sessionId`；续跑仍带两契约；无答复不自动 pass；取消不产生 verdict | [`run-signals.test.ts`](../../../tests/components/http-gateway/run-signals.test.ts) 4 个新用例通过 |
| agent 回归 | 既有 agent confirm pass/reject 用例未改且通过；agent 任务无 `confirmation` 字段 | 全量测试通过；`run-signals.test.ts` 断言 `confirmation` 为 `undefined` |
| 边界 | `CMP-run` 不写 `task` 表；`CMP-scheduler` 不解释节点类型，只存 opaque JSON；`http-gateway` 只透传 DTO | 阅读 diff：改动集中在 `run/signals.ts`、`dispatch-ops.ts`、`prompt.ts`、`scheduler/{types,validate,store,enqueue,mappers}.ts`、`executor-types.ts`；无反向依赖 |
| 文档链接 | 新增/修改的 works、design 路径逐条核对相对层级；场景索引重新生成 | `docs:check` 通过 |
| 全量门禁 | `typecheck`、`test`、`docs:check`、`quality:report` | 440 pass / 1 skip / 0 fail；违规 0 条；工具健康 8/8 |
| E2E 联调 | 真实 client（多契约改动）+ 真实 DSH：双工具挂载、confirm 暂停、pass/reject 续跑同一 session、无答复、取消、Q/A 落 `review.md` | [`e2e.md`](e2e.md) 四条路径；[`evidence/`](evidence/) 存 client 日志、两份评审报告与 run 快照 |

### 4.1 E2E 证据摘要

| 路径 | 观察到的结果 |
|---|---|
| pass | `signal.prepared kinds=["review_verdict","confirmation_request"]` → `signal.collected confirmation_request` → run `waiting_confirm` → `decide pass` → 续跑任务 `resumeSessionId` 等于原 `sessionId` → `signal.collected review_verdict` → 节点 `rejected`、回退 start |
| reject | `decide reject` → 续跑 prompt 含「人工决定：拒绝」与拒绝意见 → 评审调整口径后提交 `verdict=fail` |
| 无答复 | report 后 15s 保持 `waiting_confirm`，无新任务、无自动 pass、无 verdict |
| 取消 | run `done/cancelled`，节点 `failed(cancelled)`，`verdict=null`，未写「已通过」 |

Q/A 落点：pass 与 reject 两份 `review.md` 的「人工确认记录」都记录了问题、决定、人的回答，并写明「答复不是 verdict，verdict 仍由评审提交」。非阻塞现象：e2e client 的观测面端口被旧 client 占用（`observability_disabled` 警告），不影响任务与信号。

## 5 Hold

| 项 | 为什么不阻塞 | 去向 |
|---|---|---|
| client 改动提交/发版 | 联调通过的是 client 工作区版本；提交、版本号与发布由 client 侧处理，不影响本仓库代码合并 | client 仓库工序 |
| 服务端确认次数计数、确认超时 | proposal 已明确 v1 由 prompt 约束、无答复一直等待；本轮每次访问只问一次 | 观察滥用后再评估 |
| 旧 `result_signal` 行兼容 | 开发期无生产数据；用户明确不考虑旧版本 | 不做 |
| `arch-reviewer` 文本同步 | seed 目录没有该技能；对应语义由 `auto-confirm` §5 与 `review-verdict` 承载 | 不新增文件 |

## 6 结论

**通过。** blocker 0；decision 2 均已落文档与 pinning test；真实 client 四条路径已验证（[`e2e.md`](e2e.md)）；hold 4（client 提交/发版、服务端计数与超时、旧行兼容、`arch-reviewer` 文本）均已转出并写明不阻塞理由。P2 的人工最终确认由用户 2026-11-19 「client 提案 + orchestrator 实现」的答复与本工序决策记录承担。
