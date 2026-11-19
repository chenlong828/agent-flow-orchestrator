---
layer: works
module: run
status: closed
updated: 2026-11-17
procedure: 2026-11-17-run-node-session-id
level: P2
---

# 评审：run_node 记录 sessionId

范围与定级见 [`brief.md`](brief.md)。本次改动是 `run_node` 加一列并在结果结算事务内写入，不新增依赖、不改公共 API。

## Blocker

无。迁移只加可空列，旧行保持 `null`；写入点只影响已有结算路径。

## Decision now

| 决策 | 结论 | 依据 |
|---|---|---|
| 字段粒度 | 放 `run_node`，每个节点/轮次一行 | 一个 run 会派发多个节点任务，`P-02` 的 `sessionId` 属于单个 task；放 `workflow_run` 会互相覆盖。用户 2026-11-17 确认 |
| 对外暴露 | 只落库，不改 `RunNodeView` / `GET /runs/{id}` / `openapi.yaml` | 用户 2026-11-17 确认；当前没有读取面，避免提前固定产品契约 |
| 写入时机 | `scheduler.acceptResult` 接受后，与 `run_node` 结算同一事务 | 拒绝/重复结果不允许覆盖节点状态，也不应写入会话绑定；`coalesce` 保证未回传时不覆盖已有值 |
| 结果未带 `sessionId` | 保持 `null`，不补写、不推导 | 用户明确历史/未返回不补；重启对账只有 `inspect` 的 outcome，没有 sessionId 来源 |
| 空字符串 | 网关解析时归一为未返回 | 避免把「没有会话标识」落成空串，保持「有值或 null」两类 |

## Verified sound

- 迁移 `0010_run_node_session_id.sql` 只执行 `add column session_id text`；Postgres 已有行自动为 `null`，无 backfill。
- `CMP-run` 的四种结果分支（普通成功、review 判定、取消、失败/超时）都把 `ResultView.sessionId` 传给 `settleNode`；验证由 `tests/components/run/service.test.ts`（失败结果）与 `tests/components/http-gateway/run-review.test.ts`（review 成功/失败）覆盖。
- 未带 `sessionId` 的结果由 `TC-RUN-008` 覆盖：节点结算成功，`run_node.session_id` 为 `null`。
- `GET /runs/{id}` 节点视图无该字段，由 `TC-RUN-006` 的 `sessionId` 未定义断言覆盖；`openapi.yaml` 未改。
- `resumePending` 补结算不传 sessionId，SQL 的 `coalesce` 保留原值；历史行不被改写。

## Hold

- 当前没有按 `sessionId` 的查询、索引或读取接口。等出现实际读取方时另立改动；本次不预置。

## 裁决

blocker 0 / decision 5（均已落实现或文档）/ hold 1（不阻塞，已记录）。
