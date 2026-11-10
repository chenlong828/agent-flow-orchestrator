---
layer: design
module: workflow-orchestration
status: draft
updated: 2026-11-10
flow: FLOW-EXE-DISPATCH-001
scenario: SCN-0201
domain: 工作流编排
valueStream: 执行面调度
title: 执行面任务派发
entries: []
docs:
  - path: docs/design/components/scheduler/spec.md
    heading: 3 公共契约
  - path: docs/design/components/http-gateway/spec.md
    heading: 4.3 执行面端点
  - path: docs/design/components/instance/spec.md
    heading: 3 公共契约
tests: []
externalRefs: []
---

# 执行面任务派发

## 1 场景与价值

智能体 client 常驻轮询，调度器把任务列表里的任务按容量批量下发，client 领到任务后执行。

结果：每个任务最终被下发、同一个实例上并发任务的技能集一致、容量不被超卖、下发的任务内容不随重派改变。

前置：实例已由任务启动用例登记（[`CMP-instance`](../../../../components/instance/spec.md)）；任务已入队并冻结快照。本场景不覆盖任务从哪里来、prompt 如何组成——那是上游编排工序。

## 2 入口

实现后入口（当前为 `planned`，frontmatter 的 `entries` 为待补齐）：

- HTTP：`CMP-http-gateway` 的 `createHttpApp` 下的执行面路由（`P-01` → `POST /api/v1/executor/poll`）。
- 领域：`CMP-scheduler` 的 `createScheduler`：`poll`。
- 读：`CMP-instance` 的 `createInstanceService`：`get` / `isDispatchable`。

契约冻结在前：[`executor-http-v2`](../../../../contracts/executor-http-v2.md) §4.1。本场景不修改契约。

## 3 运行序

流程定义：`FLOW-EXE-DISPATCH-001`。

1. client 携带 `capacity.free`、`running[]`、`finished[]` 调 `P-01`；网关校验协议版本与 Bearer 后映射为 `CMP-scheduler.poll`。
2. 调度器对账：
   - `finished[]` 中的任务视为「已有结果未确认」，不再重发；
   - `dispatched` 但既不在 `running[]`、也不在 `finished[]`、且无已接受结果的任务，本次原样重发（同 `taskId`、同 `attempt`，`S-03`）。
3. 容量裁决：可派发数 = `min(free, maxTasksPerPoll=10)`；同一 client 的 poll 串行，不超卖（`S-04`）。
4. 挑选 `queued` 且 `notBefore` 已到、实例 `active` 且绑定该 client 的任务；按入队顺序（FIFO）取。
5. 派发前复核同实例在飞任务的 `skillSet.digest` 一致（`S-06`）；不一致不派发，任务留在队列。
6. 下发 `TaskEnvelope` 快照（`prompt`、`workspacePath`、`timeoutMs`、`skillSet`）；`attempt` 从 1 开始，重派递增（`S-01`/`S-05`）。
7. 无任务可派：挂起到 `pollHoldMs=30000` 或新任务入队唤醒；返回 `200` + `tasks: []` + `nextPollAfterMs: 0`。

失败路径：

- `free=0`：返回空批，不下发、不预留。
- `running[]` 出现调度器未派发或已结算的 `taskId`：忽略并且不放进 `tasks`，不报错（client 侧清理责任）。
- 实例 `blocked` / `retired` / 未登记：该实例任务不派发，留在队列；不返回错误。
- `finished[]` 与 `running[]` 同时包含同一任务：以 `finished[]` 为准，不重发。
- 请求体未知字段、`capacity.free` 非法：`400`，见 `SCN-0205`。

## 4 不可变引用

- 契约 [`executor-http-v2`](../../../../contracts/executor-http-v2.md)：§4.1 `P-01` 请求/响应与语义、`S-01`/`S-03`/`S-04`/`S-05`/`S-06`、`C-01`、§3 常量。
- 任务快照与技能集 digest 口径：`CMP-scheduler` 规格 §4.4（不改契约字段）。
- `workspacePath` 只登记与透传，不创建、不校验存在性（`P-01` §4.1 #3）。

## 5 测试方案

实现工序落盘测试后，本卡随 `tests` 与 `entries` 一起转 `designed`；断言只走 HTTP 契约与组件公开方法。

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-EXD-001` | `free=3` 时最多返回 3 条任务，字段完整（`taskId`/`instanceId`/`nodeId`/`attempt`/`prompt`/`workspacePath`/`timeoutMs`/`skillSet`），`attempt=1`；同批中指向同一实例的任务 `skillSet.digest` 相同 |
| R2 | `TC-EXD-002` | `free=0` 返回空批且不下发；无任务时挂起约 30s 后返回空批；新任务入队立即唤醒并返回任务；`nextPollAfterMs=0` |
| R3 | `TC-EXD-003` | 同实例并发派发的任务 digest 相同；同实例在飞任务已有不同 digest 时新任务不派发，任务留在队列 |
| N1 | `TC-EXD-004` | 响应丢失：任务既不在 `running[]` 也不在 `finished[]`、无结果 → 下一次 poll 原样重发且 `attempt` 不变；任务出现在 `running[]` 或 `finished[]` 时不重发 |

## 6 覆盖边界

- 不覆盖结果回收与重派收敛（`SCN-0202`）、停止与取消（`SCN-0204`）、制品下载（`SCN-0203`）、协议与凭据闸门（`SCN-0205`）。
- 不覆盖任务入队、prompt 组成、fan-out 规划与实例登记（上游编排工序）；节点绑定与停用门禁见 `SCN-0206`。
- 不覆盖多调度器实例部署下的跨进程长轮询（本轮单进程）。
