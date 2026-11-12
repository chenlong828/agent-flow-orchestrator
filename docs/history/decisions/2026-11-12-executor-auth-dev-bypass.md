---
layer: history
module: global
status: frozen
updated: 2026-11-12
decision: 2026-11-12-executor-auth-dev-bypass
---

# 决策：开发期执行面身份旁路与节点自注册

> 背景：执行面唯一身份来源是 `Bearer <token> → clientId`（[`2026-11-10-executor-client-token.md`](2026-11-10-executor-client-token.md)），登记走管理面 `API-41`。开发期从零接一台 client 要人工建资产、登记 `clientId` + token、再把 token 抄进 client 配置；任一步缺失，client 要么配置期退出 2，要么首次 poll `401` 退出 3，要么拿到空批空转。UI 侧也没有节点登记入口（`agent-flow-ui` 的 `2026-11-12-run-live-integration` 工序在 `result.md` 记为未决）。
> 用户裁决（2026-11-12）：开发阶段以功能推进优先，**调度器侧放开 token 校验**；客户端首见即自动登记，**同一 `clientId` 重复注册以新值为准、不产生重复数据**；客户端改动交由 client 仓库实施。

## 1 决策

1. **开关**：配置项 `EXECUTOR_AUTH`（`on` / `off`，默认 `off`）。`off` 时执行面不再强制 Bearer；`on` 时行为与本决策前完全一致。启动日志在 `off` 下打一条告警，不回显任何凭据。
2. **身份头**：`off` 时客户端可用 `X-Client-Id: <1–64 个非空白字符>` 声明 `clientId`，可选 `X-Client-Address: <1–200 字符>` 声明接入地址。解析顺序：**能解析的 Bearer 优先**（存量节点与测试不受影响），否则取身份头；两者都没有 → `401 unauthorized`。
3. **自动登记**：身份头解析出 `clientId` 且节点不存在时，由 `CMP-harness.ensureNode` 按默认值建一行：`name=clientId`、`kind=container`、`accessMode=agent`、`address=上报值或 auto`、`concurrencyMax=4`、`queuePolicy=fifo`、`enabled=true`、`createdBy=auto-enroll`。`name` 与已有资产冲突时追加 `-2`、`-3` 后缀（`name` 唯一索引）。
4. **重复注册**：同一 `clientId` 只对应一行。已存在则**幂等复用**：不新建、不报 `409`、不修改 `enabled`、不覆盖人工维护的字段（含 `address`）。即自动登记只负责「补齐缺失的节点行」，不承担管理面写权限。
5. **手工登记保留**：`API-41`、`client_token` 列、`ExecutorAuthenticator` 全部保留不动；`EXECUTOR_AUTH=on` 时自注册不生效，凭据语义回到决策前的状态。开关就是回补的接缝。
6. **客户端契约**：新增头属于执行面契约的**开发期扩展**，写入 `executor-http-v3.md`；客户端实现以提案交回 client 仓库，编排侧不依赖客户端先实现（可用 curl 直接验证）。

## 2 被否决方案

| 方案 | 否决理由 |
|---|---|
| 完整 enrollment 握手（pending 队列 + UI 批准 + 服务端发 token） | 需要新表、新端点、审批语义与凭据发放面；产品端点当前无鉴权，「批准」等于任何人可自批一枚有效身份。开发期成本远大于收益，用户明确否决 |
| 服务端生成 token 并在批准后交付客户端 | 同上，且客户端当前只读配置，需新增凭据落盘职责 |
| 只放开鉴权、不自动建节点 | `isDispatchable` 要求存在 `harness.client_id` 行，否则 poll 恒为空批；现象从「401 退出」变成「静默空转」，更难排查 |
| 自动登记同时刷新 `address` / 重启用停用节点 | 执行面获得管理面写权限，会与人工管理动作互相覆盖；停用后自动复活会让「停用」失效 |
| 删除 `client_token` 列与 `API-41` | 生产前必须回补鉴权；删掉后续要重做表与端点，且违反「开关即回补接缝」 |

## 3 影响

- `CMP-config`：+`EXECUTOR_AUTH`（环境变量，默认 `off`）。
- `CMP-http-gateway`：`ExecutorDeps` +`authMode` / `ensureNode`；`authenticate` 返回 `{clientId, source}`；`off` 时接受 `X-Client-Id` / `X-Client-Address`。
- `CMP-harness`：`HarnessService` +`ensureNode(clientId, {address, actor})`；`NodeDirectory` / `ExecutorAuthenticator` 不变。
- `CMP-kernel`：不变（不新增端口）。
- `agent-flow-client`（外部）：执行面请求带 `X-Client-Id`；详见 [`client-proposal.md`](../../works/2026-11-12-dev-executor-self-enroll/client-proposal.md)。
- `agent-flow-ui`：不需要改动；自动登记的节点会出现在现有 Harness 列表与详情中。
- 场景 `SCN-0206`：增补「开发期身份头 + 首见自动登记」运行序与失败路径。
- 未改动：`task` / `task_attempt` / `instance` schema，产品端点计数与 `openapi.yaml`（身份头不进 OpenAPI 的产品 `paths`）。

## 4 风险与边界

- **开发期等同无身份校验**：任何能连上网关的人可用任意 `clientId` 领取任务，读到 `intent.md` 全文与工作区路径。当前服务只监听本机、数据为演示数据，用户已接受；**暴露到非 loopback 或多人共用环境之前必须设 `EXECUTOR_AUTH=on`**。
- **默认值 `off` 是 fail-open**：与 `OQ-19`（观测面 fail-open）同类。区别是执行面已经承载派发，因此本决策把它标为「上线阻塞项」：生产部署清单必须包含 `EXECUTOR_AUTH=on`。
- **自动登记节点的数据卫生**：反复更换 `clientId` 会累积无用 Harness 行；本工序不做回收。
- **地址只在首次登记时写入**：客户端换机、改端口后不会自动刷新，需要人工改或解绑重登。

## 5 复试条件

- 需要把服务暴露到非 loopback 或多人共用：先设 `EXECUTOR_AUTH=on`，并补管理面鉴权。
- 需要「客户端自助接入、管理员批准」：重开本决策，按 enrollment 方案另立工序（需新表、新端点、审批与凭据发放）。
- 自动登记节点数量影响列表与调度可读性时：补节点回收（未 poll 超过 N 天自动停用/删除），另立工序。
