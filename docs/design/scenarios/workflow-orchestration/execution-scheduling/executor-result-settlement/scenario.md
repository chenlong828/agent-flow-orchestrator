---
layer: design
module: workflow-orchestration
status: draft
updated: 2026-11-10
flow: FLOW-EXE-SETTLE-001
scenario: SCN-0202
domain: 工作流编排
valueStream: 执行面调度
title: 执行面结果回收与重派收敛
entries: []
docs:
  - path: docs/design/components/scheduler/spec.md
    heading: 4 状态机与不变量
  - path: docs/design/components/http-gateway/spec.md
    heading: 4.3 执行面端点
  - path: docs/design/components/scheduler/spec.md
    heading: 6 验证计划
tests: []
externalRefs: []
---

# 执行面结果回收与重派收敛

## 1 场景与价值

client 执行完任务后回报结果；调度器以第一份被接受的结果结算，并按错误类别决定「重派」还是「终止」。

结果：每个任务最终收敛到一个结局——成功、失败、取消或超时；卡住或失联的任务回到队列重派，且不因为重复上报覆盖已有结论。

## 2 入口

实现后入口（当前 `planned`，frontmatter `entries` 待补齐）：

- HTTP：`CMP-http-gateway` 的执行面路由（`P-02` → `POST /api/v1/executor/tasks/{taskId}/result`）。
- 领域：`CMP-scheduler` 的 `acceptResult`；重派判定在 `poll` 内执行。

## 3 运行序

流程定义：`FLOW-EXE-SETTLE-001`。

1. client 上报结果：`status`、`attempt`、`message`、`error`、`usage`、`sessionId`、时间。
2. 调度器判定接受：`taskId` 未知或不属于该 client 的实例 → `404 task_not_found`；任务已 `done` → `accepted=false`；否则接受并写入结局（`S-08`）。
3. `attempt` 不参与接受判定：重派后旧副本先交结果仍然算数（契约 §8 的既定代价）。
4. 结算后按 [`CMP-scheduler` §4.5](../../../../components/scheduler/spec.md) 的重试策略决定是否回队：`idle_timeout`、`asset`、`runtime`/`internal` 回队；`prompt_timeout`、`scheduler`、`protocol` 终止。
5. 回队：`attempt + 1`，`notBefore = now + taskRetryDelayMs`（默认 5000ms）；超过 `taskMaxAttempts`（默认 3）直接 `done(failed)`。
6. 与 `P-01` 对账并行的重派：`now > dispatchedAt + timeoutMs + resultGraceMs`（60s）或 `now - client.lastPollAt > clientSilentMs`（120s）→ 回到 `queued`，`attempt + 1`。
7. 实例失败收敛：`failed(workspace)` → `CMP-instance.block`，同实例其余任务结算为失败，不再往该实例派发。

失败路径：

- 未知 `taskId`：`404 task_not_found`，不创建任务、不写结果。
- 重复上报：`200 accepted=false`，不覆盖首份结果。
- 结果体超过 `maxResultBytes`：`413`，任务不结算（`SCN-0205`）。
- 结果形状非法（`status` 不在闭集、`succeeded` 带 `error`）：`400 validation_error`，任务不结算。

## 4 不可变引用

- 契约：§4.2 `P-02` 语义与错误、§6 `S-02`/`S-08`、§8 失败与恢复矩阵、§4.2 #4 的错误码约定（`prompt_timeout` / `idle_timeout`）。
- 重试策略表与阈值：`CMP-scheduler` 规格 §4.5；退避与次数来自 `CMP-config`。
- `failed(workspace)` 后的实例摘除：`CMP-instance` 规格 §4.1。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-EXR-001` | 首份 `succeeded` 结果 `accepted=true`，任务 `done(succeeded)`；重复上报 `accepted=false` 且结果不被覆盖；未知 `taskId` 返回 404 `task_not_found` |
| R2 | `TC-EXR-002` | `timeout` + `code=idle_timeout` 回队且 `attempt+1`；`timeout` + `code=prompt_timeout` 不回队、`done(failed)`；`failed(scheduler)`/`failed(protocol)` 不回队；重试次数用尽后 `done(failed)` |
| R3 | `TC-EXR-003` | client 静默超过 `clientSilentMs` 与任务超过 `timeoutMs + resultGraceMs` 均回队、`attempt+1`、快照字段（`prompt`/`workspacePath`/`timeoutMs`/`skillSet`）不变；退避期内不派发 |
| N1 | `TC-EXR-004` | `failed(workspace)` 使实例 `blocked`，同实例其余 `queued`/`dispatched` 任务结算失败且不再派发；重派后旧副本先交结果仍被接受（首份为准） |

## 6 覆盖边界

- 不覆盖派发与容量（`SCN-0201`）、停止与取消（`SCN-0204`）、制品下载（`SCN-0203`）、协议与凭据（`SCN-0205`）。
- 不覆盖 prompt 内的重试提示、任务拆分与上游重跑决策。
- 不覆盖「重试策略按任务类型分化」——当前按错误类别统一策略。
