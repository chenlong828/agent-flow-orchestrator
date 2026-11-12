---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-11-12
flow: FLOW-EXE-NODE-001
scenario: SCN-0206
domain: 工作流编排
valueStream: 执行面调度
title: 执行节点登记与派发门禁
entries:
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-catalog
    path: src/components/catalog/index.ts
    symbol: createCatalog
  - component: CMP-scheduler
    path: src/components/scheduler/service.ts
    symbol: createScheduler
docs:
  - path: docs/design/components/harness/spec.md
    heading: 3.3 节点目录与在线状态口径
  - path: docs/design/components/http-gateway/spec.md
    heading: 4.1 业务端点
  - path: docs/design/components/scheduler/spec.md
    heading: 4.8 节点可用性与派发门禁
tests:
  - role: R1
    id: TC-EXN-001
  - role: R2
    id: TC-EXN-002
  - role: R3
    id: TC-EXN-003
  - role: N1
    id: TC-EXN-004
externalRefs: []
---

# 执行节点登记与派发门禁

## 1 场景与价值

管理员把一台执行机器登记成 Harness，并绑定它的执行身份 `clientId`；调度器只向「已登记、已绑定、启用」的节点派发任务，界面上能看到节点是否在线、是否满载。

结果：节点目录成为「谁能接活」的唯一权威；停用节点后不再派新任务，界面状态与调度器观测一致，且不出现第二份状态真相。

前置：`client` 端只持有 Bearer token，不自注册（`executor-http-v3` 没有注册端点）；token → `clientId` 由 Harness 的节点登记提供（`harness.client_token`，经 `kernel.ExecutorAuthenticator` 解析），不读配置。

开发期旁路（2026-11-12）：`EXECUTOR_AUTH=off` 时 `client` 可用 `X-Client-Id` 声明身份，服务端首见自动建节点行（[`harness` §3.4](../../../../components/harness/spec.md)、[`http-gateway` §5.5](../../../../components/http-gateway/spec.md)）；`on` 时旁路失效，回到上面的 Bearer 路径。

## 2 入口

实现后入口（当前 `planned`，frontmatter 的 `entries` 为待补齐）：

- HTTP：`CMP-http-gateway` 的 `API-41` `PATCH /api/v1/harnesses/{id}/client`；列表/详情沿用 `API-01`/`API-02`（详情含 `clientToken`，列表不含）。
- 领域：`CMP-harness` 的 `bindClient` / `unbindClient`、`NodeDirectory` 与 `ExecutorAuthenticator` 实现；`CMP-scheduler` 的 `NodeDirectory` 依赖、`ExecutorAuthenticator` 鉴权与 `presence` 读。
- 组合：`catalog` 的 `listHarnesses` / `getHarness` 合并派生状态。

## 3 运行序

流程定义：`FLOW-EXE-NODE-001`。

1. 管理员创建 Harness（`API-03`），拿到 `id` 与 `revision`。
2. 登记节点：`API-41` 带 `If-Match` 提交 `{clientId, token}`；`clientId` 与 token 都未被其他 Harness 占用 → 两者一起写入、`revision + 1`；详情可读回 `clientToken`，列表不返回。
3. 客户端轮换凭据：同一端点提交新 `token`（`clientId` 不变）→ 新 token 立即生效、旧 token 解析为 `null`；解绑提交 `{clientId: null}` 同时清空凭据。
4. 调度器派发前门禁：实例可用（`instance.isDispatchable`）且节点可用（`NodeDirectory.isDispatchable(clientId)`）才派发；任一不满足则任务留在 `queued`，`attempt` 不变。
5. 在线状态：`catalog` 读调度器 `presence`，按 `unknown` / `online` / `overloaded` / `offline` 派生 `health`，`lastHeartbeatAt` 取最近一次 poll 时间；不写 Harness 表。
6. 停用节点：`API-05` 置 `enabled=false` → 不再派发新任务；在跑任务继续跑完；不向 client 下发 `stop`。
7. 恢复/解绑：重新启用或 `API-41` 提交 `clientId: null` 解绑 → 节点回到不可派发；重新启用后继续派发。
8. 开发期自注册（`EXECUTOR_AUTH=off`）：client 首次 `poll` 带 `X-Client-Id` → 节点不存在则建默认行（`name=clientId`、`enabled=true`）并放行；同一 `clientId` 再次 poll 复用同一行，不新建、不覆盖 `enabled`/`address`；先走通流程，`EXECUTOR_AUTH=on` 前再用 `API-41` 补凭据。

失败路径：

- 同一 `clientId` 已被其他 Harness 占用：`409 binding_conflict`，`details.clientId`。
- 同一 token 已被其他 Harness 使用：`409 binding_conflict`，`details.field=clientToken`，不回显 token 值。
- 缺 `If-Match`：`428`；旧 `revision`：`409 revision_conflict`。
- `clientId` 为空串/空白/超长、登记时缺 `token`、解绑时携带 `token`：`400 validation_error`。
- 未知 token（含解绑后、轮换后的旧 token）调执行面：`401`；token 有效但节点停用：鉴权通过、返回空批、不派发（不返回 `401`，避免管理动作把 client 踢下线）。
- 调度器不可用：Harness 列表状态降级为 `unknown`，不伪造 `offline`。
- `EXECUTOR_AUTH=off` 且既无 Bearer 也无 `X-Client-Id`：`401 unauthorized`，不建行；`X-Client-Id` 形状非法：`400 validation_error`（`details.field=clientId`），不建行。
- `EXECUTOR_AUTH=on` 且只带 `X-Client-Id`：`401 unauthorized`，不建行（旁路被忽略，不报「不支持的头」）。

## 4 不可变引用

- `executor-http-v3`：三端点与鉴权语义不变；开发期身份旁路是该契约 §3 的追加头（`X-Client-Id`/`X-Client-Address`），`EXECUTOR_AUTH=on` 时完全不生效。
- Harness 资产契约：`create` / `update` 不接受 `clientId` / `token`，登记只走 `API-41`（[`harness/spec.md`](../../../../components/harness/spec.md) §2）。
- 凭据权威：`harness.client_token` 是执行端 Bearer 的唯一权威，配置不持有凭据（[`2026-11-10-executor-client-token.md`](../../../../../history/decisions/2026-11-10-executor-client-token.md)）。
- `health` / `lastHeartbeatAt` 的派生口径：`harness` §3.3；`presence` 读契约：`scheduler` §3.3。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-EXN-001` | 登记后 Harness 详情回读 `clientId`/`clientToken` 且 `revision+1`，列表不含凭据；同一 `clientId` 或同一 token 被第二个 Harness 使用返回 `409 binding_conflict`（凭据冲突不回显 token）；解绑清空两者且幂等 |
| R2 | `TC-EXN-002` | 节点停用后新任务不派发、`attempt` 不变、任务仍 `queued`；在跑任务照常完成；重新启用后继续派发；`stop` 未被下发 |
| R3 | `TC-EXN-003` | 派生状态四类：未 poll / `free>0` / `free=0` / 超过 `clientSilentMs` 分别为 `unknown` / `online` / `overloaded` / `offline`；`lastHeartbeatAt` 为最近 poll 时间；调度器不可用时降级 `unknown` |
| R4 | `TC-EXN-101` | `EXECUTOR_AUTH=off`：`X-Client-Id` 放行并建默认节点行（`name=clientId`、`kind=container`、`address=上报值或 auto`、`concurrencyMax=4`、`enabled=true`）；重复 poll 只一行、已存在行不被修改；无身份头 `401`；形状非法 `400` 且不建行 |
| N2 | `TC-EXN-102` | `EXECUTOR_AUTH=on`：只带 `X-Client-Id` → `401` 且不建行；有效 Bearer 语义与旁路前一致 |
| N1 | `TC-EXN-004` | 未知 token、解绑后 token、轮换后旧 token → `401`；有效 token 但节点停用 → `200` 空批且不派发；登记缺 `token`、解绑带 `token`、`POST`/`PUT` 带 `clientId` → `400`；缺 `If-Match` → `428` |

## 6 覆盖边界

- 不覆盖任务派发/重派/结果回收（`SCN-0201`/`SCN-0202`）、制品下载（`SCN-0203`）、停止与取消（`SCN-0204`）、协议与凭据闸门（`SCN-0205`）。
- 不覆盖 `concurrency_max` 的强制上限与 `priority` 队列（当前只展示）。
- 不覆盖执行面三端点的协议闸门与结果语义（`SCN-0205`）；凭据落库与轮换已并入本场景（`OQ-23` 关闭）。
- 不覆盖自动登记节点的回收/清理，以及「客户端自助接入 + 管理员批准」的 enrollment 流程（已被 2026-11-12 决策否决，重开条件见该决策 §5）。
