---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-11-11
flow: FLOW-EXE-CONTROL-001
scenario: SCN-0204
domain: 工作流编排
valueStream: 执行面调度
title: 执行面停止与取消
entries:
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-scheduler
    path: src/components/scheduler/service.ts
    symbol: createScheduler
  - component: CMP-instance
    path: src/components/instance/service.ts
    symbol: createInstanceService
docs:
  - path: docs/design/components/scheduler/spec.md
    heading: 4 状态机与不变量
  - path: docs/design/components/http-gateway/spec.md
    heading: 4.3 执行面端点
  - path: docs/design/components/instance/spec.md
    heading: 4 状态机与不变量
tests:
  - role: R1
    id: TC-EXC-001
  - role: R2
    id: TC-EXC-002
  - role: R3
    id: TC-EXC-003
  - role: N1
    id: TC-EXC-004
externalRefs: []
---

# 执行面停止与取消

## 1 场景与价值

运维或上游需要停掉一个 client、或取消某个实例上的在跑任务。契约只有电平信号：`stop` 与 `cancelInstances` 在每次 poll 中重复下发，直到 client 的状态收敛。

结果：client 优雅退出；被取消的任务中止并结算为 `cancelled`；未下发的任务不再出现。

## 2 入口

实现后入口（当前 `planned`）：

- 信号置位：`CMP-scheduler` 的 `requestStop` / `cancelInstances`（本期由组合根暴露给运维与上游，不新增对外 REST 面）。
- 下发：`poll` 的 `stop` / `cancelInstances` 字段。
- 对应 HTTP：`P-01` 响应字段；对应客户端承诺 `C-07`。

## 3 运行序

流程定义：`FLOW-EXE-CONTROL-001`。

1. 置位：`requestStop(clientId)` 或 `cancelInstances(instanceIds)`；重复调用幂等。
2. 下一次 `P-01`：`stop=true` 时 `tasks` 必须为空，client 跑完手上任务后退出 0（`C-07`）。
3. `cancelInstances` 命中且在跑：调度器持续在响应中下发这些 `instanceId`，直到对应任务结算或不再出现在 `running[]`（`S-07`）。
4. 命中且未下发：任务直接 `done(cancelled)`，从队列移除；不再出现在 `tasks`。
5. 结算：client 上报 `cancelled` 结果（或任务超时回队前被取消）→ `done(cancelled)`；不进入重试。
6. 结束：`stop` 不影响队列归属，client 恢复后继续领取自己的任务。

失败路径：

- 取消一个没有在跑任务的实例：返回空 `cancelInstances`，不报错。
- 取消与结果上报竞争：以「任务是否已结算」为准，先到者生效；重复信号不重复计数。
- `stop` 期间仍有 `dispatched` 任务未结算：任务按 `S-02`/`S-03` 正常收敛，不因 `stop` 强制结算。

## 4 不可变引用

- 契约：§4.1 `P-01` 响应字段与 `S-07`、`C-07`、§1.1「控制指令不保证有序、至少一次、断连补发」。
- 取消后的实例状态：`CMP-instance` 只在 `failed(workspace)` 时 `block`，取消不改变实例状态。
- 停止不迁移任务：实例粘性见 [`CMP-instance` §4.3](../../../../components/instance/spec.md)。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-EXC-001` | `requestStop` 后下一次 poll `stop=true` 且 `tasks` 为空；client 侧 `running` 结算完成后退出 0；队列任务不丢失 |
| R2 | `TC-EXC-002` | `cancelInstances` 命中在跑任务时持续下发同一 `instanceId`，直到任务结算；client 报 `cancelled` 后任务 `done(cancelled)`，不回队 |
| R3 | `TC-EXC-003` | 命中但未下发的任务直接 `done(cancelled)` 且不再出现在 `tasks`；取消后 `inspect` 的结局为 `cancelled` |
| N1 | `TC-EXC-004` | 重复 `requestStop` / `cancelInstances` 幂等；`stop` 不清空队列、不把任务改派给其他 client；取消与结果上报竞争时先结算者生效 |

## 6 覆盖边界

- 不覆盖派发与容量（`SCN-0201`）、结果回收与重试（`SCN-0202`）、制品下载（`SCN-0203`）、协议与凭据（`SCN-0205`）。
- 不覆盖 client 进程组清理与孤儿回收（`C-09`，client 侧）。
- 不覆盖跨 client 改派与实例回收管理面。
