---
layer: works
module: run
status: closed
updated: 2026-11-17
procedure: 2026-11-17-run-node-session-id
level: P2
---

# 结果：run_node 记录 sessionId

## 1 结论

`run_node` 新增可空 `session_id`。client 在 `P-02` 结果里回传的 `sessionId` 在 `scheduler.acceptResult` 接受后，随节点结算的同一事务写入对应行；结果未带、重复/未接受结果、历史行与重启补结算保持 `null`，不补写、不推导。按用户确认，该字段只落库，不进入 `GET /api/v1/runs/{id}` 的节点视图，`openapi.yaml` 未改。

## 2 落点

| 文件 | 改动 |
|---|---|
| `db/migrations/0010_run_node_session_id.sql` | 新增 `run_node.session_id text`，可空，无 backfill |
| `src/components/run/types.ts` | `RunNodeRow` 增加 `session_id` |
| `src/components/run/store-types.ts` | `NODE_COLUMNS` 增加 `session_id` |
| `src/components/run/store-node-write.ts` | 结算 SQL 写 `session_id = coalesce($9, session_id)`，未回传不覆盖 |
| `src/components/run/node-ops.ts` | `settleNode` 接受可选 `sessionId` 并落库 |
| `src/components/run/results.ts` | 成功、review、取消、失败/超时四条结算路径透传 `TaskResult.sessionId` |
| `src/components/http-gateway/routes/executor-request.ts` | 空字符串归一为未返回 |
| `tests/components/run/service.test.ts` | 失败结果带 sessionId 落库 |
| `tests/components/http-gateway/run-review.test.ts` | review 成功/失败带 sessionId 落库；未带为 null；API 不出现该字段 |
| `tests/db/schema.test.ts`、`tests/components/platform/db.test.ts` | 迁移清单与 `run_node.session_id` 可空列断言 |
| `docs/design/components/run/spec.md` | 数据所有权、不变量与验证计划 |
| `docs/design/scenarios/.../review-verdict-and-rollback/scenario.md` | SCN-0302 运行序与 R2/N1 断言 |

## 3 验收

| 项 | 结果 |
|---|---|
| `bun run check` | 403 pass / 0 fail；typecheck 与 `docs:check` 通过 |
| `bun run quality:report` | 违规 0 条；工具健康 8/8；并行修正 `applyReview` 参数超限后无新增 WARN |
| 针对性用例 | `tests/components/run/service.test.ts`、`tests/components/http-gateway/run-review.test.ts` 19 pass |
| 本地服务 `127.0.0.1:3100` | `/healthz` 返回 `{"status":"ok","database":"up"}`；`/openapi.yaml` 无 `sessionId`；启动日志已应用 `0010_run_node_session_id.sql` |
| 回滚 | `alter table run_node drop column session_id`；当前无读方依赖，回滚不改 run/任务状态 |

## 4 裁决摘要

blocker 0 / decision 5（粒度、API 范围、写入时机、未带处理、空串处理；见 [`review.md`](review.md)）/ hold 1（暂无按 sessionId 的读取面与索引，不阻塞）。

## 5 未决

- 工作流结束后该字段仅作历史信息；后续若需要按 `sessionId` 查询或展示，另立改动补读取面与索引。
- 未做历史回填，符合用户 2026-11-17 的明确要求。
