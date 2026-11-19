---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-11-18
flow: FLOW-RUN-003
scenario: SCN-0306
domain: 工作流编排
valueStream: 工作流运行
title: 超时节点继续跑
entries:
  - component: CMP-run
    path: src/components/run/service.ts
    symbol: createRunService
  - component: CMP-scheduler
    path: src/components/scheduler/service.ts
    symbol: createScheduler
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
docs:
  - path: docs/design/components/run/spec.md
    heading: 3 公共契约
  - path: docs/design/components/run/spec.md
    heading: 4 状态机与不变量
  - path: docs/design/components/scheduler/spec.md
    heading: 3 公共契约
  - path: docs/design/components/scheduler/spec.md
    heading: 4 状态机与不变量
tests:
  - role: R1
    id: TC-RUN-017
  - role: R2
    id: TC-RUN-018
  - role: R3
    id: TC-RUN-019
  - role: N1
    id: TC-RUN-020
externalRefs: []
---

# 超时节点继续跑

## 1 场景与价值

执行节点被 client 以 `timeout` 结束且结果带 `sessionId` 时，编排侧不把 run 直接判死，而是把节点与 run 置 `waiting_resume`；运维/UI 调用续跑端点后，**同一个 task** 从 `done(timeout)` 重开为下一 attempt，`attempt+1` 并写入 `resume_session_id`，client 用 `session/resume` 继续同一 session。节点 visit 不变、taskId 不变、prompt 不变，基础推进与结算代码继续生效。

结果：超时不再必然导致整条流程重跑；一次人工动作即可把原任务接上，旧 attempt 的日志保留。

前置：当前节点因超时进入 `waiting_resume`；`run_node.task_id` 与 `run_node.session_id` 非空；实例 `active` 且节点 `enabled`。

## 2 入口

- HTTP：`POST /api/v1/runs/{id}/nodes/{nodeId}/resume`。
- 领域：`CMP-run.resumeNode` → `CMP-scheduler.resumeTask`。
- 读：`GET /api/v1/runs/{id}` 返回 `waiting_resume` 与节点超时错误。

## 3 运行序

1. client 上报 `timeout`（带 `sessionId`）：scheduler 把 task 结算为 `done(failed)`，`error.class=timeout`；`CMP-run` 把 `run_node` 与 `run` 置 `waiting_resume`，不写 `finished_at`、不归档、不推进。
2. 等待期没有在跑任务；同工作区新 run 返回 `run_conflict`；可取消（节点 `failed(cancelled)`、run `cancelled`）。
3. 调用续跑端点：`CMP-run` 校验节点 `waiting_resume`、task/session 非空、实例与节点可派发；调用 `scheduler.resumeTask`。
4. `resumeTask` 把同一个 task 改为 `queued`、`attempt+1`、写入 `resume_session_id`，清空 `outcome/error/finished_at/dispatched_at`；唤醒该 client 的 poll。
5. `CMP-run` 把同一 `run_node` 行改回 `dispatched`（visit 不变）、run 改回 `running`。
6. client 下一次 poll 拿到同一 `taskId` 的新 attempt 与 `resumeSessionId`；`session/resume` 后发送原 prompt，继续同一 session；结果按新 attempt 上传日志并结算。
7. 再次超时可再次进入 `waiting_resume`，人工可反复续跑；无 TTL、无次数上限。

失败路径：

- timeout 结果没有 `session_id` → 保持现状 `failed`，run 失败。
- 非 `waiting_resume` 调用续跑 → `409 invalid_state`。
- task 不是 `done(timeout)` / 不属于该 client → scheduler 拒绝，节点保持等待。
- 缺 `task_id` / `session_id`、实例或节点不可派发 → `409 invalid_state`，不偷偷排队。
- 重开后旧 attempt 的迟到结果 → `acceptResult` 按 attempt 已结算返回 `accepted=false`，不会再次结算。

## 4 不可变引用

- [`CMP-run`](../../../../components/run/spec.md) §3 公共契约与 §4 状态机：`waiting_resume`、`resumeNode`。
- [`CMP-scheduler`](../../../../components/scheduler/spec.md) §3 公共契约与 §4 状态机：`resumeTask`、attempt 级结果防重。
- [`executor-http-v3`](../../../../contracts/executor-http-v3.md) §5：`TaskRequest.resumeSessionId` 驱动 `session/resume`，不新增执行面字段。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-RUN-017` | timeout + `sessionId` → node/run `waiting_resume`，`finishedAt=null`、`outcome=null`；`resumeNode` 后 node `dispatched`、run `running`，scheduler 收到同一 taskId 与 sessionId |
| R2 | `TC-RUN-018` | HTTP 续跑后 client 拿到同一 `taskId`、`attempt=2`、`resumeSessionId`；上传 attempt 2 日志并回报成功后节点 `succeeded`、后继 `dispatched` |
| R3 | `TC-RUN-019` | `waiting_resume` 下取消：run `cancelled`、节点 `failed`，不再推进 |
| N1 | `TC-RUN-020` | timeout 无 `sessionId` 仍按现状 `failed`，不进入 `waiting_resume` |

测试落盘：`tests/components/run/service.test.ts`、`tests/components/http-gateway/run-signals.test.ts`、`tests/components/scheduler/service.test.ts`。

## 6 覆盖边界

- 不覆盖无结果超时（`S-02`，没有 `sessionId`）。
- 不覆盖 TTL / 次数上限（当前不做）。
- 不覆盖 confirm 同 visit 的日志键覆盖（另立工序）。
- 不覆盖真实 client 的 `session/resume` 联调；本场景验证编排侧同一 task 重开与 attempt 防重。
