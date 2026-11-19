---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-18-review-verdict-mcp
level: P1
---

# 结果：review MCP 信号与执行中临时确认点（orchestrator 侧）

## 1 结论

orchestrator 侧已按 client 最新契约实现两项能力：

1. **review verdict 走 MCP 信号**：`TaskRequest.resultSignal.kind=review_verdict` 随任务下发；client 采集 `signals`；`CMP-run` 只使用合法 `review_verdict`，不再解析消息末尾 JSON。
2. **agent 执行中临时确认点**：`TaskRequest.resultSignal.kind=confirmation_request`；client 回传 `confirmation_request` 后，当前 `run_node` 置 `waiting_confirm`；人工通过 `decide(pass|reject, comment)` 后，用 `resumeSessionId` 续跑同一节点、同一 session；`visit` 不变、`task_id` 替换、`comment` 注入 prompt。

`needs_human` 不再进入 review verdict；review 只有 `pass`/`fail`，人工确认统一走 `confirmation_request`。

**真实 client + DSH 联调已完成四条主路径**：review pass、review fail 回退、confirmation pass 续跑、confirmation reject 续跑。使用真实模型 API、现有 dev 库和 terminal 里的 client `serve`，不是 fake DSH。

## 2 交付物

| 范围 | 落点 |
|---|---|
| 契约 | `docs/design/contracts/executor-http-v3.md`：`resultSignal`/`resumeSessionId`/`signals`、`C-13`–`C-15`、`S-05`、错误码与常量 |
| 迁移 | `db/migrations/0011_task_signal_continuation.sql`：`task.result_signal`、`task.resume_session_id` |
| 调度器 | `src/components/scheduler/{types,store,enqueue,validate,mappers}.ts`：类型、列、校验（信号 ≤8 KiB）、envelope 透传 |
| 网关 | `src/components/http-gateway/routes/{executor-types,executor-request}.ts`：信号 DTO、`signals` 解析与形状/条数/字节校验 |
| 运行编排 | `src/components/run/signals.ts`、`results.ts`、`commands.ts`、`dispatch-ops.ts`、`prompt.ts`、`node-ops.ts`、`store-node-write.ts`：review 信号、确认点、续跑、prompt 块 |
| 技能与专家定义 | `scripts/seed-skills/review-verdict/SKILL.md` v1.9：只通过 `mcp__agentflow__signal` 提交，不再使用消息 JSON；`implementation-accept` v1.8 同规则；`scripts/seed.ts` 的 `arch-reviewer` / `code-reviewer` notes 统一指向 `review-verdict` |
| 临时联调资产 | 2026-11-18 曾用 `mcp-review`/`mcp-confirm` 技能、3 个 MCP 专家、3 条 `MCP-*` 流程和 `e2e:mcp` 驱动验证真实链路；验证后已按清理要求删除，不进入长期 seed |
| 测试 | `tests/components/http-gateway/run-signals.test.ts`、`tests/db/schema.test.ts`、`tests/helpers/run.ts`、`tests/scripts/seed.test.ts` |

## 3 验证记录

- `bun run check`：**422 pass / 0 fail**，typecheck 通过，`docs:check` 通过。
- 2026-11-19 清理后复核：**423 pass / 1 skip / 0 fail**（skip 为 js-backend-code-review 的既有样例），typecheck 与 `docs:check` 通过。
- `bun run quality:report`：**违规 0**；工具健康 8/8。`quality:gate` 仍有 5 项 WARN（`task` 21 列、`run_node` 可空比例 56.3%、部分文件导出/函数数/可选字段比例），属阈值提醒，本次未作为阻塞。
- 新增用例：
  - review 信号 pass/fail；信号缺失或非法（即使 message 里有合法 verdict JSON）→ `verdict_invalid`，不再解析 message。
  - agent 确认点 `waiting_confirm`；`decide pass` 生成 `resumeSessionId` 续跑任务，`task_id` 替换、`visit=1`、prompt 含 `[人工确认]`。
  - `decide reject` 同样续跑，prompt 含拒绝意见，不把节点判失败。
- 迁移测试：11 个迁移按序；`task` 两列存在。
- **真实链路（2026-11-18，现有 dev 库，client 在 terminal；临时资产与 run 已清理）**：

| 路径 | runId | 结果 |
|---|---|---|
| review pass | `01a1ed8a-9967-73a4-8db5-e2b67380f797` | `succeeded`；n3 verdict=pass；task.result_signal=review_verdict |
| review fail | `01a1ed90-683a-7103-93f1-42ca5d370f4e` | n3 rejected；n2/visit2 已派发；信号 fail 已落 `verdict` |
| confirmation pass | `01a1ed93-ba45-74be-9ce0-b62ff456a9cb` | `waiting_confirm` → 续跑同一 session → `succeeded` |
| confirmation reject | `01a1ed95-023d-75dd-b007-9c4139902d16` | `waiting_confirm` → reject 续跑 → `succeeded`，未判失败 |

- 当时 `all` 一次通过，输出 `ok: true`；真实模型单 run 约 4–5 分钟。临时专家、流程、技能、`e2e:mcp` 驱动、测试 run/task/instance/归档和临时 workspace 已于同日清理。

## 4 已知限制

- 四条主路径已通过，但测试资产已清理；**失败路径（prepare/mount 失败、resume 失败、超预算）尚未真实联调**，仍属 `T-RVM-08` 剩余范围。旧 client 兼容矩阵已按用户 2026-11-19 决定取消。
- `session/resume` 成功路径已实测；失败策略未定：按 client 实测结果再定（失败、保持 session、或允许重跑）；orchestrator 目前要求 `session_id` 非空，缺失时 `decide` 返回 409。
- review 节点只下发 `review_verdict`，因此 review 过程中不能临时发 `confirmation_request`；需要确认点在 agent/design 节点发起。
- 本工序未提交 commit；工作区已有本工序之外未提交的改动，提交时需按文件拆分。

## 5 2026-11-19 清理

- 用户确认没有旧 client：删除 `src/components/run/verdict.ts` 与 `tests/components/run/verdict.test.ts`；`applyReview` 只认 `review_verdict` 信号，没有合法信号即 `verdict_invalid`。
- `review-verdict` v1.9、`implementation-accept` v1.8 与种子专家 notes 去掉消息 JSON 回退。
- 执行面契约 §7 观测面两条承诺原与信号承诺重号（都是 `C-13`/`C-14`），改为 `C-16`/`C-17`。

## 6 与提案/反馈的关系

- 采用 client 第二轮反馈的 `Q-07`（同参重建一次）、`Q-08`（删启动门禁/`signal_unavailable`）、`Q-09`（错误归因）、`A-11`（server/discover 快速回落）、`A-13`（错误码）、`A-15`（run/serve 同语义）。
- 采用用户 2026-11-18 决定：回答统一 `decide.comment`；`confirmation_request` 的 `reject` 是拒绝意见，续跑不失败；`session/resume` 失败由 client 实测后再定。
- 提案中 `needs_human` 已移除；`human-interaction.md` 保留为第二场景设计依据。
- UI 对接方式见 [`ui-integration-proposal.md`](ui-integration-proposal.md)：无新端点，UI 按 `RunNodeView.verdict.kind` 区分确认点与 `confirm` 节点。
