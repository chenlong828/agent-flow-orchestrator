---
layer: design
module: workflow-orchestration
status: draft
updated: 2026-11-11
flow: FLOW-RUN-003
scenario: SCN-0303
domain: 工作流编排
valueStream: 工作流运行
title: 人工确认与运行控制
entries:
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-scheduler
    path: src/components/scheduler/service.ts
    symbol: createScheduler
docs:
  - path: docs/design/components/run/spec.md
    heading: 4 状态机与不变量
  - path: docs/design/components/run/spec.md
    heading: 3 公共契约
  - path: docs/design/components/run/spec.md
    heading: 4.6 失败与取消
  - path: docs/design/components/scheduler/spec.md
    heading: 4 状态机与不变量
tests: []
externalRefs: []
---

# 人工确认与运行控制

## 1 场景与价值

流程推进到 `confirm` 节点时，服务端不创建 session、不派发任务，run 进入 `waiting_confirm`；外部通过产品 API 提交 `pass` 或 `reject`。`pass` 继续走 seq 出边，`reject` 沿该节点预设的回退边退回指定节点。启动时可通过 `autoConfirm` 让 confirm 自动通过（开发与联调期）。运行中可随时取消，取消经调度器的实例级电平信号生效。

结果：人工节点有明确的外部入口与状态；空等不会占住 client 槽位；取消后不再产生新任务。

前置：run 处于 `running`；图中 `confirm` 节点有一条 seq 入边与一条 seq 出边，可带一条回退边且目标为祖先；`confirm` 不绑定专家。

## 2 入口

- HTTP：`POST /api/v1/runs/{id}/nodes/{nodeId}/decision`；`POST /api/v1/runs/{id}/cancel`。
- 领域：`CMP-run` 的 `decide` / `cancel`（`planned`）；取消经 `CMP-scheduler.cancelInstances` 生效。
- 读：`GET /api/v1/runs/{id}` 返回 `waiting_confirm` 与当前节点。

## 3 运行序

流程定义：`FLOW-RUN-003`。

1. `advance` 选中 `confirm` 节点：不建 task、不入队；`run_node(pending → waiting_confirm)`，`run(waiting_confirm)`。
2. 若 `run.autoConfirm = true`：直接 `approved`，按 seq 出边推进；不进入等待，不落人工决策记录（审计字段记 `auto`）。
3. 否则等待外部决策：`decision = pass` → `run_node(approved)`，`run(running)`，推进 seq 后继；`decision = reject` → `run_node(rejected)`，取该节点唯一 `rollback` 边的 `to` 作为回退目标，目标 `visit+1` 重新执行。
4. 决策幂等与状态校验：仅 `waiting_confirm` 可接受；重复提交同决策返回 `200`（幂等），已推进后再提交返回 `409 invalid_state`。
5. 取消：`POST /runs/{id}/cancel` 幂等；若当前节点有 `dispatched`/`running` 任务 → `scheduler.cancelInstances(instanceId)` 电平取消，直到任务结算；`run(cancelled)`，未执行节点不再推进。
6. `waiting_confirm` 下取消：直接 `run(cancelled)`，无任务可取消；`created` 下取消：`run(cancelled)`，不登记新实例（若已登记则保留）。
7. 取消以任务结算为准：run 先标 `cancelled`，client 随后回报 `cancelled`，对应 `run_node` 记 `failed(cancelled)`；迟到的结果按 `S-08` 首份为准，不再改变 run 状态。

失败路径：

- 未知 run → `404`；决策值非 `pass`/`reject` → `400`。
- 非 `waiting_confirm` 状态下提交决策 → `409 invalid_state`，不改变节点状态。
- `reject` 但节点没有回退边 → `run_node(failed, missing_rollback_edge)`，`run.failed`（保存校验应已拦截，运行期兜底）。
- 取消时调度器不可用 → 返回 `503`，run 保持原状态，允许重试（不写入半取消状态）。

## 4 不可变引用

- [`CMP-run`](../../../../components/run/spec.md) §4.3 推进规则、§4.5 判定与回退（`confirm` 语义与 `autoConfirm`）。
- [`CMP-run`](../../../../components/run/spec.md) §3 公共契约（`decide` / `cancel`）与 [`CMP-http-gateway`](../../../../components/http-gateway/spec.md) §4.1.1。
- [`CMP-run`](../../../../components/run/spec.md) §4.6 失败与取消：取消经 `cancelInstances` 电平生效。
- [`CMP-scheduler`](../../../../components/scheduler/spec.md) §4 状态机与不变量：`cancelInstances` 幂等、取消以结算为准。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-RUN-009` | 推进到 `confirm`：不产生任务、`run=waiting_confirm`、`run_node=waiting_confirm`；提交 `pass` 后 `approved` 并推进 seq |
| R2 | `TC-RUN-010` | `autoConfirm=true`：confirm 不等待，直接 `approved` 并推进 |
| R3 | `TC-RUN-011` | 提交 `reject`：节点 `rejected`，回退边目标以 `visit+1` 重新执行 |
| N1 | `TC-RUN-012` | 取消：`cancelInstances` 电平下发、run `cancelled`、不再入队；重复取消幂等；非 `waiting_confirm` 提交决策返回 `409` |

测试落盘后补齐 frontmatter `tests` 并转 `designed`。

## 6 覆盖边界

- 不覆盖审核 verdict 解析（`SCN-0302`）。
- 不覆盖 pause/resume 与超时自动决策：本期没有 `waiting_confirm` 超时策略（转 `OQ-28` 一并评估）。
- 不覆盖多实例 run 的取消：本期一个 run 只绑一个实例。
- 不覆盖客户端进程优雅停机：仍由信号处理，`OQ-25` 已关闭该部分。
