---
layer: design
module: workflow-orchestration
status: draft
updated: 2026-11-10
flow: FLOW-EXE-NODE-001
scenario: SCN-0206
domain: 工作流编排
valueStream: 执行面调度
title: 执行节点登记与派发门禁
entries: []
docs:
  - path: docs/design/components/harness/spec.md
    heading: 3.3 节点目录与在线状态口径
  - path: docs/design/components/http-gateway/spec.md
    heading: 4.1 业务端点
  - path: docs/design/components/scheduler/spec.md
    heading: 4.8 节点可用性与派发门禁
tests: []
externalRefs: []
---

# 执行节点登记与派发门禁

## 1 场景与价值

管理员把一台执行机器登记成 Harness，并绑定它的执行身份 `clientId`；调度器只向「已登记、已绑定、启用」的节点派发任务，界面上能看到节点是否在线、是否满载。

结果：节点目录成为「谁能接活」的唯一权威；停用节点后不再派新任务，界面状态与调度器观测一致，且不出现第二份状态真相。

前置：`client` 端只持有 Bearer token，不自注册（`executor-http-v2` 没有注册端点）；token → `clientId` 由配置 `EXECUTOR_CLIENTS` 提供。

## 2 入口

实现后入口（当前 `planned`，frontmatter 的 `entries` 为待补齐）：

- HTTP：`CMP-http-gateway` 的 `API-41` `PATCH /api/v1/harnesses/{id}/client`；列表/详情沿用 `API-01`/`API-02`。
- 领域：`CMP-harness` 的 `bindClient` / `unbindClient`；`CMP-scheduler` 的 `NodeDirectory` 依赖与 `presence` 读。
- 组合：`catalog` 的 `listHarnesses` / `getHarness` 合并派生状态。

## 3 运行序

流程定义：`FLOW-EXE-NODE-001`。

1. 管理员创建 Harness（`API-03`），拿到 `id` 与 `revision`。
2. 绑定节点：`API-41` 带 `If-Match` 提交 `{clientId}`；`clientId` 非空且未被其他 Harness 占用 → 写入成功、`revision + 1`。
3. 调度器派发前门禁：实例可用（`instance.isDispatchable`）且节点可用（`NodeDirectory.isDispatchable(clientId)`）才派发；任一不满足则任务留在 `queued`，`attempt` 不变。
4. 在线状态：`catalog` 读调度器 `presence`，按 `unknown` / `online` / `overloaded` / `offline` 派生 `health`，`lastHeartbeatAt` 取最近一次 poll 时间；不写 Harness 表。
5. 停用节点：`API-05` 置 `enabled=false` → 不再派发新任务；在跑任务继续跑完；不向 client 下发 `stop`。
6. 恢复/解绑：重新启用或 `API-41` 提交 `clientId: null` 解绑 → 节点回到不可派发；重新启用后继续派发。

失败路径：

- 同一 `clientId` 已被其他 Harness 占用：`409 binding_conflict`，`details.clientId`。
- 缺 `If-Match`：`428`；旧 `revision`：`409 revision_conflict`。
- `clientId` 为空串/空白/超长：`400 validation_error`。
- 未知 token 调执行面：`401`；token 有效但节点未绑定或停用：鉴权通过、返回空批、不派发（不返回 `401`，避免管理动作把 client 踢下线）。
- 调度器不可用：Harness 列表状态降级为 `unknown`，不伪造 `offline`。

## 4 不可变引用

- `executor-http-v2`：三端点与鉴权语义不变；本场景只决定「派给谁」，不改契约字段。
- Harness 资产契约：`create` / `update` 不接受 `clientId`，绑定只走 `API-41`（[`harness/spec.md`](../../../../components/harness/spec.md) §2）。
- `health` / `lastHeartbeatAt` 的派生口径：`harness` §3.3；`presence` 读契约：`scheduler` §3.3。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-EXN-001` | 绑定后 Harness 详情回读 `clientId` 且 `revision+1`；同一 `clientId` 被第二个 Harness 绑定返回 `409 binding_conflict`；解绑幂等且 `clientId=null` |
| R2 | `TC-EXN-002` | 节点停用后新任务不派发、`attempt` 不变、任务仍 `queued`；在跑任务照常完成；重新启用后继续派发；`stop` 未被下发 |
| R3 | `TC-EXN-003` | 派生状态四类：未 poll / `free>0` / `free=0` / 超过 `clientSilentMs` 分别为 `unknown` / `online` / `overloaded` / `offline`；`lastHeartbeatAt` 为最近 poll 时间；调度器不可用时降级 `unknown` |
| N1 | `TC-EXN-004` | 未知 token → `401`；有效 token 但节点未绑定或停用 → `200` 空批且不派发；`POST`/`PUT` 带 `clientId` → `400`；缺 `If-Match` → `428` |

## 6 覆盖边界

- 不覆盖任务派发/重派/结果回收（`SCN-0201`/`SCN-0202`）、制品下载（`SCN-0203`）、停止与取消（`SCN-0204`）、协议与凭据闸门（`SCN-0205`）。
- 不覆盖 `concurrency_max` 的强制上限与 `priority` 队列（当前只展示）。
- 不覆盖凭据落库与轮换（`OQ-23`，第二阶段）。
