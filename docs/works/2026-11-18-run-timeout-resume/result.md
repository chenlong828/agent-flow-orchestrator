---
layer: works
module: run
status: closed
updated: 2026-11-18
procedure: 2026-11-18-run-timeout-resume
level: P1
---

# 结果：超时节点继续跑

## 1 结论

超时不再直接终结 run。client 上报 `timeout` 且带 `sessionId` 时，`run_node`/`run` 进入 `waiting_resume`；人工调用 `POST /api/v1/runs/{id}/nodes/{nodeId}/resume` 后，scheduler 把**同一个 task** 从 `done(timeout)` 重开为下一 attempt（`attempt+1`、写 `resume_session_id`），`run_node` 同一行回到 `dispatched`、run 回到 `running`；client 下一次 poll 拿到同一 `taskId` 的新 attempt，用 `session/resume` 继续原 session。未新增 visit、task、日志键或配置项。

指定 run `01a1ee50-cd00-7745-be97-333f7c25c03f`（超时 task `01a1ee50-ecfa-7286-8bbe-f436b860829d`，节点 n3）已修到 `waiting_resume`，等待 UI 接入后调用续跑端点；本次**没有**提前触发续跑。

## 2 落点

| 文件 | 改动 |
|---|---|
| `src/components/scheduler/resume.ts` | 新增 `resumeTask`：done(timeout) → queued、attempt+1、写 `resume_session_id`；幂等 |
| `src/components/scheduler/store.ts` | `reopen`、`findAttempt` 写读口 |
| `src/components/scheduler/result.ts` | 按 `(taskId, attempt)` 已结算防重 |
| `src/components/scheduler/service.ts` / `types.ts` | 暴露 `resumeTask` |
| `src/components/run/types.ts` | `waiting_resume`、`ResumeNodeInput`、`resumeNode` |
| `src/components/run/results.ts` | timeout + sessionId → `waiting_resume`，不 finish、不 advance |
| `src/components/run/node-ops.ts` | `setNodeWaitingResume` |
| `src/components/run/store-node-resume.ts` | 新增 waiting/resume 的 run_node 写入 |
| `src/components/run/commands.ts` | `resumeNode`；等待期取消沿用现有逻辑 |
| `src/components/run/advance.ts` / `queries.ts` / `store-run-read.ts` | `waiting_resume` no-op、恢复扫描跳过、活跃 run 查询包含等待态 |
| `src/components/run/service.ts` | 暴露 `resumeNode` |
| `src/components/http-gateway/routes/run.ts` | `POST /runs/{id}/nodes/{nodeId}/resume` |
| `src/components/http-gateway/openapi.yaml` | 新 path、`RunState`/`RunNodeState` 枚举、API-54、数量 61/62/45 |
| `db/migrations/0012_run_timeout_resume.sql` | 状态 check 加 `waiting_resume`；活跃唯一索引包含等待态 |
| `tests/components/scheduler/service.test.ts` | `TC-EXR-006`/`TC-EXR-007` |
| `tests/components/run/service.test.ts` | `TC-RUN-017`/`TC-RUN-019`/`TC-RUN-020` |
| `tests/components/http-gateway/run-signals.test.ts` | `TC-RUN-018` |
| `tests/components/http-gateway/openapi.test.ts`、`tests/db/schema.test.ts`、`tests/components/platform/db.test.ts` | 数量/迁移/状态断言 |
| `docs/design/components/run/spec.md`、`scheduler/spec.md`、`http-gateway/spec.md`、`contracts/executor-http-v3.md` | 状态、方法、端点与续跑语义 |
| `docs/design/scenarios/.../timeout-resume/scenario.md` | 新增 `SCN-0306`（verified） |
| `docs/works/2026-11-18-run-timeout-resume/ui-integration-proposal.md` | 给 UI 的对接提案：状态、端点、交互、错误、验收 |

## 3 验收

| 项 | 结果 |
|---|---|
| `bun run check` | 428 pass / 1 skip / 0 fail；typecheck 与 `docs:check` 通过；场景索引 17 个 |
| `bun run quality:report` | 违规 0 条；工具健康 8/8 |
| scheduler 续跑 | `TC-EXR-006` 同一 task 重开 attempt 2、幂等、旧 attempt 被拒、新 attempt 接受；`TC-EXR-007` 非 timeout 不可重开 |
| run 续跑 | `TC-RUN-017` 进入 waiting 并回到 dispatched；`TC-RUN-019` 等待期取消；`TC-RUN-020` 无 session 仍失败 |
| HTTP 续跑 | `TC-RUN-018` 同一 taskId/attempt 2/resumeSessionId；原 prompt 不变；attempt 2 结算并推进 |
| 迁移 | `0012` applied=1 skipped=11；状态 check 与活跃唯一索引含 `waiting_resume` |
| 本地服务 `127.0.0.1:3100` | `/healthz` 返回 `{"status":"ok","database":"up"}`；`/openapi.yaml` 含 `/runs/{id}/nodes/{nodeId}/resume` |
| 指定 run | `GET /api/v1/runs/01a1ee50-cd00-7745-be97-333f7c25c03f`：`state=waiting_resume`、`outcome=null`、`archiveState=none`、n3 `state=waiting_resume`、`finishedAt=null`、`taskId`/`sessionId`/timeout error 保留 |

## 4 指定 run 的状态修复

用户在 2026-11-18 给出 task `01a1ee50-ecfa-7286-8bbe-f436b860829d`，定位到 run `01a1ee50-cd00-7745-be97-333f7c25c03f`、节点 n3。修复前：run `done(failed)`、`archive_state=stored`、n3 `failed`、task `done(failed, timeout)`、attempt 1 已结算、`session_id=42bb1616-29d3-4cc3-9b4a-b379b3c45118`。

修复（单事务）：

- `workflow_run`：`state=waiting_resume`、`outcome=null`、`result=null`、`archive_state=none`、`finished_at=null`；
- `run_node` n3：`state=waiting_resume`、`finished_at=null`；保留 `task_id`、`session_id`、timeout `error/message`；
- 不改 task；scheduler `resumeTask` 等 UI 调用时再把它从 `done(timeout)` 重开为 attempt 2。

`archive_state` 置 `none` 是为了最终结束时能重新归档；旧 archive artifact（`history/.../task-space.tar.gz`）仍在，后续 `storeArchive` 会替换。若 UI 直接调用续跑端点，服务会按 `resumeNode` 校验并重开；不会自动开始。

## 5 回滚

- 代码回滚 + `0012` 回滚（重建旧 check/唯一索引）；已处于 `waiting_resume` 的 run 需一次管理动作结算为 `failed`。
- 无配置开关；若要临时停用，只能回滚代码或把等待记录手工结算。

## 6 未决

- UI（独立项目）展示 `waiting_resume` 与「继续执行」按钮；`T-RTR-06`。
- TTL / 次数上限：本轮不做，等待 run 会占工作区直到续跑或取消。
- confirm 同 visit 续跑日志覆盖：既有隐患，另立工序。
- 人工续跑与 `S-02` 共用 `attempt`，会计入 `taskMaxAttempts`；是否拆分另定。
- `S-02` 未回报超时（无 sessionId）不在本方案。
- client 观测面 `findBySession` 对同一 session 返回第一条 attempt：续跑期间 session 代理会显示旧 timeout；任务执行/日志不受影响，client 侧另修。

## 7 裁决摘要

blocker 0 / decision 4（同一 task 重开、attempt 防重、无 TTL/次数、复用原 prompt；见 [`review.md`](review.md)）/ hold 3（confirm 日志覆盖、attempt 预算共用、UI 未接入）。
