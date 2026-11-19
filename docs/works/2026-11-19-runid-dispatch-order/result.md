---
layer: works
module: scheduler
status: closed
updated: 2026-11-19
---

# 结果：派发合并事务 + 提交后唤醒

## 验收结果

| 验收项 | 结果 | 证据 |
|---|---|---|
| 事务未提交时任务对其它连接不可见、回滚后不存在 | 通过 | `tests/components/scheduler/service.test.ts` `TC-EXD-030` |
| 传 `tx` 不唤醒，提交后 `notifyClient` 才唤醒 | 通过 | `tests/components/scheduler/service.test.ts` `TC-EXD-031` |
| 首节点与后继节点下发的任务都带 `runId` | 通过 | `tests/components/http-gateway/run-start.test.ts`「派发任务携带 runId」 |
| 全量测试 | 426 pass / 1 skip / 0 fail | `bun test` |
| 类型检查 | 通过 | `bun run typecheck` |
| 质量报告 | 违规 0 条 | `bun run quality:report` |
| 文档检查 | 通过 | `bun run docs:check` |
| 服务重启 | 通过 | `./scripts/start-dev.sh reload` 后 `/healthz` = ok、`/openapi.yaml` version 与 `package.json` 一致 |
| 在线验收：派发任务带 `runId` | 通过 | 验证 run `01a1f1c6-b3a8-7595-a07a-d2cd478f16cf` 的 n1 attempt meta `runId=01a1f1c6-…-478f16cf` |
| 在线验收：运行中节点实时窗口 | 通过 | 同一 run 的 n3 派发后、仍在 `running` 时 `GET /nodes/n3/session` 返回 200（`status: running`、事件 15 条、归档 pending），修复前此请求为 404 `session_not_linked` |

## 结论落点

| 内容 | 落点 |
|---|---|
| 决策与否决理由 | `docs/history/decisions/2026-11-19-dispatch-transaction-and-notify.md` |
| 调度器契约（`enqueue` 可选 `tx`、`notifyClient`） | `docs/design/components/scheduler/spec.md` §3 |
| run 派发事务边界 | `docs/design/components/run/spec.md` §6 |
| 实现 | `src/components/scheduler/{types,enqueue,service}.ts`、`src/components/run/dispatch-ops.ts` |

## 裁决摘要

blocker 0 / decision 1（`enqueue` 契约形状，已落测试与决策记录）/ hold 1（历史 attempt 缺 `runId` 的兜底反查未做，转待办）

## 未做与待办

- **兜底反查**：`findSession` 在 `runId` 查不到时按 `taskId` 退化查询，可救 2026-11-19 之前已丢 `runId` 的 attempt；本次未做，转 `plan/open-questions.md`。
- **验证 run 残留**：`01a1f1c6-b3a8-7595-a07a-d2cd478f16cf`（`/tmp/af-runid-verify`）验证后已取消，`n3` 为 cancelled 语义的 failed；留作在线验收记录，可忽略。
