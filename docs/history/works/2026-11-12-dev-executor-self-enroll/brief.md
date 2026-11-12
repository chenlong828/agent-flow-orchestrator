---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-12-dev-executor-self-enroll
level: P1
---

# 工序：执行面身份旁路与节点自注册（开发期）

> 状态：设计已按 2026-11-12 用户裁决落定（[`2026-11-12-executor-auth-dev-bypass`](../../history/decisions/2026-11-12-executor-auth-dev-bypass.md)），本工序只实现编排侧；客户端改动以提案交回 client 仓库。

## 1 要解决的问题

开发期从零接一台 client 要做三件事：建 Harness 资产、用 `API-41` 登记 `clientId` + token、把 token 抄进 client 配置。任一环节缺失，client 都拿不到任务：

- 没有 token：非 loopback 配置期退出 2（`scheduler_token_missing`），loopback 首次 poll `401` 退出 3；
- 没有 `client_id` 绑定：`NodeDirectory.isDispatchable` 为假，poll 返回空批，现象是「连上了但永远没任务」；
- UI 只有资产注册，没有节点登记入口。

用户裁决（2026-11-12）：开发阶段不做完整 enrollment 握手，也不做审批；**调度器侧放开 token 校验，客户端首见即自动登记为节点；同一 `clientId` 重复注册以新值为准，不产生重复行**。

## 2 范围

| 做 | 不做 |
|---|---|
| `EXECUTOR_AUTH` 开关（默认 `off`，启动告警） | 待批准队列 / 审批流 / 服务端发放 token |
| `X-Client-Id` + 可选 `X-Client-Address` 身份头 | 客户端代码改动（以 [`client-proposal.md`](client-proposal.md) 交回 client 仓库） |
| 未知 `clientId` 首见自动建 Harness 行（幂等） | UI 登记入口（自动登记后不再需要） |
| `CMP-harness` 新增 `ensureNode` | schema 变更（`client_token` 列保留不删） |

## 3 验收标准

1. `EXECUTOR_AUTH=off`（默认）时，`POST /api/v1/executor/poll` 带 `X-Client-Id: dev-node-01` 返回 `200` 空批，且 Harness 列表新增一行（`name=dev-node-01`、`kind=container`、`enabled=true`、`concurrencyMax=4`、`queuePolicy=fifo`、`createdBy` 为自动登记标记）。
2. 同一 `clientId` 连续 poll 不新增行；人工建的同名 Harness 不被覆盖、不报 409。
3. `EXECUTOR_AUTH=on` 时同一请求返回 `401 unauthorized`，且不建行；Bearer 语义与现状完全一致。
4. 已存在的 Harness 行（含 `enabled=false`）不被自动登记修改：停用后不复活。
5. 未知 token + 有 `X-Client-Id` 时仍按头放行（开发期容错）；两者都没有 `401`。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-ENR-01` | design | config / gateway / harness | 决策记录 + 三份规格增量 + 场景增补 | 完成 |
| `T-ENR-02` | change | `CMP-config` | `EXECUTOR_AUTH` 解析（默认 `off`） | 完成 |
| `T-ENR-03` | change | `CMP-http-gateway` | 身份头解析、`authenticate` 返回来源、`ensureNode` 调用 | 完成 |
| `T-ENR-04` | change | `CMP-harness` | `ensureNode` 幂等建节点（名称冲突兜底） | 完成 |
| `T-ENR-05` | test | 上述三组件 | 契约测试：头放行、默认值、幂等、停用不复活、`401` | 完成 |
| `T-ENR-06` | handoff | 外部仓库 | 客户端修改提案（`X-Client-Id`） | 完成 |

## 5 装载清单

- 规格：`design/components/config/spec.md`、`design/components/http-gateway/spec.md` §5.5、`design/components/harness/spec.md` §3、`design/contracts/executor-http-v3.md` §3。
- 代码：`src/core/config/executor-config.ts`、`src/components/http-gateway/routes/executor.ts`、`src/components/harness/service.ts`、`src/main.ts`。
- 场景：`SCN-0206`（执行节点登记与派发门禁）。

## 6 未决

- 自动登记节点的清理：开发期反复换 `clientId` 会累积无用 Harness 行，本工序不做回收；需要时另立「节点回收」工序。
- 自动登记不刷新 `address`：人工改过的地址不会被覆盖，客户端换机后需手工改或解绑重登。
