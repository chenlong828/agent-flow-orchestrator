---
layer: works
module: run
status: closed
updated: 2026-11-18
procedure: 2026-11-18-run-timeout-resume
level: P1
---

# 工序：超时节点继续跑（同一 task 重开 attempt）

> 用户裁决（2026-11-18）：不要新 visit、新 task、TTL 或次数上限。超时后只加一个中间态；续跑时把**同一个 task**从 `done(timeout)` 重开为下一 attempt，带上 `resume_session_id`，run_node 回到 `dispatched`，client 继续用同一 session 跑。要求基础代码继续可用，只修状态。

## 1 背景

`CMP-run` 当前把 client 上报的 `timeout` 结果直接结算为节点 `failed`、run `done(failed)`（[results.ts](../../../src/components/run/results.ts#L106)、[run/spec.md](../../design/components/run/spec.md#L335)）。节点上的 `task_id` 与 `session_id` 已经落库，client 也支持 `session/resume`，缺的只是「不要进终态」和「把同一个 task 重开」这两个动作。

## 2 范围

| 做 | 不做 |
|---|---|
| `workflow_run` / `run_node` 增加 `waiting_resume` 中间态；超时且有 `session_id` 时进入等待 | 不新增 run_node visit、不新增 task、不改 `run_artifact` 日志键 |
| 新增 `POST /api/v1/runs/{id}/nodes/{nodeId}/resume`，人工续跑当前节点 | 不做自动续跑、TTL、续跑次数上限 |
| scheduler 新增 `resumeTask`：`done(timeout)` → `queued`、`attempt+1`、写 `resume_session_id` | 不改 client 协议；不改 scheduler 的 `poll`/`enqueue` 语义 |
| `acceptResult` 增加 attempt 级防重，避免重开后旧结果再次结算 | 不改 prompt；续跑复用原任务快照 |
| 迁移、组件测试、HTTP 契约测试、OpenAPI、run/scheduler 规格与场景断言 | 不做非 timeout 失败的原地重试；不修 confirm 的同 visit 日志覆盖 |
| 取消、重启、无 sessionId、实例不可派发等边界 | 不覆盖 `S-02` 未回报超时（没有 sessionId） |

## 3 定级

**P1**：改 run 的公共状态机（新增 `waiting_resume`）、scheduler 的任务终态例外（`done(timeout)` 可被人工重开）、产品 API 与数据库 check 约束/唯一索引；跨 `CMP-run`、`CMP-scheduler`、`CMP-http-gateway` 与 UI 契约。

## 4 验收标准

1. 超时结果带 `session_id` → `run_node`/`run` 进入 `waiting_resume`，`finished_at` 为空，不归档；无 `session_id` 保持现状直接失败。
2. `POST /runs/{id}/nodes/{nodeId}/resume` 在 `waiting_resume` 下：
   - 同一个 `task_id` 从 `done(timeout)` 重开为 `queued`，`attempt+1`，`resume_session_id` 等于节点 `session_id`；
   - `run_node` 同一行回到 `dispatched`，`visit` 不变；`run` 回到 `running`；
   - client 下一次 poll 拿到同一 `task_id` 的新 attempt，走 `session/resume` 继续。
3. 续跑 attempt 的日志键为 `(run, node, visit, attempt+1)`，与超时日志不冲突；旧日志保留。
4. 重开后旧 attempt 的迟到/重复结果被 `acceptResult` 拒绝，不会把 task 再结算一次。
5. 续跑后再次超时可再次进入 `waiting_resume`；人工可反复续跑，直到取消或正常结束。
6. 等待期可取消；等待 run 占用同工作区活跃 run，直到续跑或取消（无 TTL）。
7. 重复调用不重复重开；无 sessionId、实例不可派发、task 不可重开返回明确错误。
8. `bun test tests/components/run tests/components/scheduler tests/components/http-gateway/run-*.test.ts`、`bun run typecheck` 通过；`bun run quality:report` 无新增违规。

## 5 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-RTR-01` | design | global | 简化设计、范围与验收 | 完成 |
| `T-RTR-02` | change | scheduler | `resumeTask`、attempt 防重、store 写口 | 完成 |
| `T-RTR-03` | change | run | `waiting_resume`、超时分支、`resumeNode`、取消/推进 | 完成 |
| `T-RTR-04` | change | http-gateway | 端点、OpenAPI、run 状态枚举 | 完成 |
| `T-RTR-05` | change | platform | 迁移 `0012`、check 约束/唯一索引 | 完成 |
| `T-RTR-06` | change | UI（跨项目） | `waiting_resume` 展示与「继续执行」动作 | 待开始 |
| `T-RTR-07` | verify | run/scheduler/http | 组件与契约测试、指定 run 状态修复 | 完成 |
| `T-RTR-08` | docs | global | run/scheduler 规格、场景断言、`openapi.yaml` | 完成 |
| `T-RTR-09` | docs | global | 给 UI 的对接提案（状态、端点、交互、错误、验收） | 完成 |

## 6 装载清单

- 现行契约：[`docs/design/components/run/spec.md`](../../design/components/run/spec.md)、[`docs/design/components/scheduler/spec.md`](../../design/components/scheduler/spec.md)、[`docs/design/contracts/executor-http-v3.md`](../../design/contracts/executor-http-v3.md)
- run：[`src/components/run/results.ts`](../../../src/components/run/results.ts)、[`src/components/run/commands.ts`](../../../src/components/run/commands.ts)、[`src/components/run/node-ops.ts`](../../../src/components/run/node-ops.ts)、[`src/components/run/store-node-write.ts`](../../../src/components/run/store-node-write.ts)、[`src/components/run/store-run-read.ts`](../../../src/components/run/store-run-read.ts)、[`src/components/run/store-run-write.ts`](../../../src/components/run/store-run-write.ts)、[`src/components/run/advance.ts`](../../../src/components/run/advance.ts)、[`src/components/run/types.ts`](../../../src/components/run/types.ts)
- scheduler：[`src/components/scheduler/result.ts`](../../../src/components/scheduler/result.ts)、[`src/components/scheduler/store.ts`](../../../src/components/scheduler/store.ts)、[`src/components/scheduler/service.ts`](../../../src/components/scheduler/service.ts)、[`src/components/scheduler/types.ts`](../../../src/components/scheduler/types.ts)
- gateway：[`src/components/http-gateway/routes/run.ts`](../../../src/components/http-gateway/routes/run.ts)、[`src/components/http-gateway/openapi.yaml`](../../../src/components/http-gateway/openapi.yaml)
- 数据库：[`db/migrations/0002_workflow_run.sql`](../../../db/migrations/0002_workflow_run.sql)
- client 参考：`/Users/chenlong/harness/agent-flow-client/src/components/runtime/runtime.ts`、`/Users/chenlong/harness/agent-flow-client/src/components/cli/serve-loops.ts`
- 指定 run：`01a1ee50-ecfa-7286-8bbe-f436b860829d`

## 7 待定

| 项 | 说明 |
|---|---|
| TTL / 次数上限 | 本轮不做；等待 run 占工作区，由人工续跑或取消 |
| `S-02` 未回报超时 | 无 `sessionId`，调度器自行回队；不在本工序 |
| confirm 同 visit 日志覆盖 | 已有隐患，另立工序 |
| UI 文案与按钮 | 独立项目承接；本仓库只约定 `waiting_resume` 与 resume 端点 |
