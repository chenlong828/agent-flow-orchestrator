---
layer: design
module: workflow-orchestration
status: draft
updated: 2026-11-10
flow: FLOW-EXE-SETTLE-001
scenario: SCN-0202
domain: 工作流编排
valueStream: 执行面调度
title: 执行面结果回收与未回报重派
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

结果：每个任务最终收敛到一个结局——成功、失败、取消或超时；失败与超时直接结算、不自动重跑；只有「没交结果」的任务（client 崩溃、响应丢失）回到队列重派，且不因为重复上报覆盖已有结论。

## 2 入口

实现后入口（当前 `planned`，frontmatter `entries` 待补齐）：

- HTTP：`CMP-http-gateway` 的执行面路由（`P-02` → `POST /api/v1/executor/tasks/{taskId}/result`）。
- 领域：`CMP-scheduler` 的 `acceptResult`；重派判定在 `poll` 内执行。

## 3 运行序

流程定义：`FLOW-EXE-SETTLE-001`。

1. client 上报结果：`status`、`attempt`、`message`、`error`、`usage`、`sessionId`、时间。
2. 调度器判定接受：`taskId` 未知或不属于该 client 的实例 → `404 task_not_found`；任务已 `done` → `accepted=false`；否则接受并写入结局（`S-08`）。
3. `attempt` 不参与接受判定：重派后旧副本先交结果仍然算数（契约 §8 的既定代价）。
4. 结算：按 [`CMP-scheduler` §4.5](../../../../components/scheduler/spec.md) 直接写入结局——失败/超时（含 `idle_timeout`）一律 `done(failed)`，**不自动回队**（用户 2026-11-11 裁决）；需要重跑由上游新建任务。
5. 未回报重派：`now > dispatchedAt + timeoutMs + resultGraceMs`（60s）或 `now - client.lastPollAt > clientSilentMs`（120s）且**没有收到结果** → 回到 `queued`，`attempt + 1`，`notBefore = now + taskRetryDelayMs`（默认 5000ms）；超过 `taskMaxAttempts`（默认 3）后 `done(failed)`。
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
| R2 | `TC-EXR-002` | 失败/超时结果一律直接 `done(failed)`、不再派发：`timeout` + `idle_timeout`、`timeout` + `prompt_timeout`、`failed(runtime)`、`failed(asset)`、`failed(scheduler)` 各一例；重复上报只回 `accepted=false` |
| R3 | `TC-EXR-003` | 未回报才回队：client 静默超过 `clientSilentMs`、任务超过 `timeoutMs + resultGraceMs` 均回队、`attempt+1`、快照字段（`prompt`/`workspacePath`/`timeoutMs`/`skillSet`）不变；`attempt` 用尽后 `done(failed)`；退避期内不派发 |
| N1 | `TC-EXR-004` | `failed(workspace)` 使实例 `blocked`，同实例其余 `queued`/`dispatched` 任务结算失败且不再派发；重派后旧副本先交结果仍被接受（首份为准） |

## 6 覆盖边界

- 不覆盖派发与容量（`SCN-0201`）、停止与取消（`SCN-0204`）、制品下载（`SCN-0203`）、协议与凭据（`SCN-0205`）。
- 不覆盖 prompt 内的重试提示、任务拆分与上游重跑决策。
- 不覆盖失败后的自动重试——当前不重试；重跑由上游新建任务。
