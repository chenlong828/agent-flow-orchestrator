---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-18-review-verdict-mcp
level: P1
---

# 评审：review MCP 信号与执行中临时确认点

> 说明：本文件是交付前自审，不是独立评审上下文。
> 2026-11-19 更新：用户确认没有旧 client，消息 JSON 回退已移除；`D-01` 中「消息 JSON 仅回退」作废，review verdict 只认 `review_verdict` 信号。

## 结论

**通过。** blocker 0；decision 5；verified sound 6；hold 2。

## Decision now

| 决策 | 内容 | 落点 |
|---|---|---|
| `D-01` | review 优先 `review_verdict` 信号，消息 JSON 仅回退；信号非法时回退消息，两者都非法才 `verdict_invalid` | `run/results.ts`、`run/signals.ts`、`run-signals.test.ts` |
| `D-02` | agent 确认点用 `confirmation_request` + `waiting_confirm`；`decide` 的 pass/reject 都续跑同一 session，`visit` 不变、`task_id` 替换 | `run/commands.ts`、`run/dispatch-ops.ts`、`run/prompt.ts`、`run-signals.test.ts` |
| `D-03` | review 不再支持 `needs_human`；人工确认只走 `confirmation_request`，避免 review 状态机出现两条确认路径 | `run/signals.ts`、`run/results.ts`、`review-verdict` v1.8 |
| `D-04` | 回答统一 `decide.comment`，不新增 `answer` 字段；`reject` 对确认点表示拒绝意见，不判失败 | `run/commands.ts`、`human-interaction.md` |
| `D-05` | 真实联调用临时资产：`mcp-review`/`mcp-confirm` 技能、3 个 MCP 专家、3 条流程、`e2e:mcp` 驱动；验证后已清理，不进入长期 seed | `scripts/seed.ts`（当时）、临时资产（已删除） |

## Verified sound

| 项 | 查了什么 | 结论 |
|---|---|---|
| `V-01` 契约 | `executor-http-v3.md` 与 client 契约逐项对照 | `resultSignal`/`resumeSessionId`/`signals`、C-13–C-15、S-05、错误码齐全 |
| `V-02` 迁移 | 0011 执行、schema 测试 | `task.result_signal`/`resume_session_id` 存在且可空 |
| `V-03` 调度器 | `TaskDraft`→`TaskEnvelope` 贯通 | 信号与 resumeSessionId 随任务下发；≤8 KiB 校验 |
| `V-04` 网关 | `P-02` 信号解析 | 只在 succeeded 接受；条数/字节/形状错误 400 |
| `V-05` 门禁 | `bun run check`、`quality:report` | 422 pass / 0 fail；违规 0；文档检查通过 |
| `V-06` 真实链路 | 现有 dev 库 + terminal client + 真实模型，临时 `e2e:mcp` 四个 phase | review pass/fail、confirmation pass/reject 全部通过；session resume 同一 id；测试资产与 run 已清理 |

## Hold

| 项 | 不阻塞理由 | 去向 |
|---|---|---|
| 兼容矩阵与失败路径 | 主路径已通过；旧 client/旧 scheduler、prepare/mount 失败、resume 失败仍需单独验证 | `T-RVM-08` |
| `session/resume` 失败策略 | 成功路径已实测；失败策略未定，不预设 | `human-interaction.md` §8.1 |
