---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-11-11
flow: FLOW-EXE-PROTOCOL-001
scenario: SCN-0205
domain: 工作流编排
valueStream: 执行面调度
title: 执行面协议版本与凭据闸门
entries:
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-scheduler
    path: src/components/scheduler/service.ts
    symbol: createScheduler
docs:
  - path: docs/design/components/http-gateway/spec.md
    heading: 4.3 执行面端点
  - path: docs/design/components/http-gateway/spec.md
    heading: 3.3 错误体
  - path: docs/design/components/kernel/spec.md
    heading: 3.1 错误
tests:
  - role: R1
    id: TC-EXV-001
  - role: R2
    id: TC-EXV-002
  - role: R3
    id: TC-EXV-003
  - role: N1
    id: TC-EXV-004
externalRefs: []
---

# 执行面协议版本与凭据闸门

## 1 场景与价值

执行面只有三个端点，协议演进靠一个整数版本号与 Bearer 凭据把关。闸门必须挡在业务之前：版本不匹配、凭据无效、请求形状不对时，不产生任何派发与结算副作用。

结果：不兼容的 client 收到 `400 unsupported_protocol` 后停止退出；凭据失效收到 `401` 后停止领取；错误请求不会污染任务列表。

## 2 入口

实现后入口（当前 `planned`）：

- HTTP：`CMP-http-gateway` 的执行面路由与协议守护（`X-Executor-Protocol`、`Authorization: Bearer`、未知字段白名单、`maxResultBytes`）。
- 凭据到 `clientId` 的映射：`CMP-harness` 的 `harness.client_token`，经 `kernel.ExecutorAuthenticator` 解析（[`harness/spec.md`](../../../../components/harness/spec.md) §3）。

## 3 运行序

流程定义：`FLOW-EXE-PROTOCOL-001`。

1. 请求进入执行面路由：先校验 `X-Executor-Protocol` 是否等于当前整数版本 `2`，不匹配（缺失、`1`、`"2"` 等非精确值）→ `400 unsupported_protocol`，client 停止并退出。
2. 校验 `Authorization: Bearer <token>`：经 `ExecutorAuthenticator` 解析 `clientId`；无效或缺失 → `401`，client 停止领取并退出（非 0 退出码）。
3. 校验请求体：未知字段 → `400 validation_error`；`capacity.free`、`running[]`、`finished[]` 形状非法 → `400`；结果体超 `maxResultBytes=262144` → `413 payload_too_large`。
4. 通过闸门才调用 `CMP-scheduler`；错误经统一信封返回，`code` 稳定、`message` 不含凭据与堆栈。
5. 响应回显 `X-Request-Id`（可选请求头）；未知响应字段由 client 忽略。

失败路径：

- 版本与凭据同时不合法：先回版本错误（`400`），不消耗鉴权查询。
- 同一 token 对应多个 `clientId`：启动配置校验阶段拒绝（配置错误），不在请求期猜测。
- 凭据出现在 URL、日志或错误体：视为缺陷，测试断言错误信封不包含 token。

## 4 不可变引用

- 契约：§3 通用约定（版本头、鉴权、常量、未知字段）、§4.1/§4.2 的错误码、§13 版本演进规则。
- 错误词汇与 HTTP 映射：[`CMP-kernel` §3.1](../../../../components/kernel/spec.md)（`unsupported_protocol`、`validation_error`、`payload_too_large`）。
- 凭据只从环境变量读取：[`CMP-config` §3.1](../../../../components/config/spec.md)。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-EXV-001` | `X-Executor-Protocol: 2` + 有效 Bearer 的三个端点各自返回 `200`，并回显 `X-Request-Id` |
| R2 | `TC-EXV-002` | 版本缺失/为 `1`/为字符串 `"2"` → `400 unsupported_protocol` 且不派发；请求体未知字段 → `400 validation_error` 且任务状态不变 |
| R3 | `TC-EXV-003` | 缺失/无效 Bearer → `401` 且不进入调度；错误信封不含 token；未知 token 不产生 client 记录 |
| N1 | `TC-EXV-004` | 结果体超过 `maxResultBytes` → `413 payload_too_large` 且任务不结算；同一任务随后可正常上报 |

## 6 覆盖边界

- 不覆盖业务派发、结算、制品下载的正确性（`SCN-0201`–`SCN-0204`）。
- 不覆盖多版本共存窗口与协商：契约 §13 明确不做兼容窗口。
- 不覆盖 client 侧退出码与信号处理的实现细节（client 工序）。
