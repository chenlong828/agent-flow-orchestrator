---
layer: works
module: global
status: active
updated: 2026-11-10
procedure: 2026-11-10-node-registry-implementation
level: P2
---

# 工序：节点登记与执行面凭据落库（实现）

## 1 范围

**背景**：`2026-11-10-harness-node-registry` 完成第一期设计（Harness 即节点目录、`API-41`、派生状态、门禁），用户 2026-11-10 确认 P2；同日追加裁决「执行面 token 落库，明文入库、详情可读回」（`OQ-23` 关闭，见 [`2026-11-10-executor-client-token.md`](../../history/decisions/2026-11-10-executor-client-token.md)）。

**本轮做**：

- 基线表加 `harness.client_id`、`harness.client_token`（可空、唯一、表级 check），直接改 `0001_baseline.sql`，重建开发库，不写增量迁移。
- `CMP-harness`：`bindClient`/`unbindClient`、`getByClientId`、`NodeDirectory` 与 `ExecutorAuthenticator` 实现；`HarnessSummary.clientId`、`HarnessDetail.clientToken`。
- `CMP-kernel`：`BindingConflictError`、`NodeDirectory`、`ExecutorAuthenticator` 端口。
- `CMP-catalog`：`clientId` / `clientToken` 投影。
- `CMP-http-gateway`：`API-41 PATCH /harnesses/{id}/client`、`HarnessClientBinding`、错误映射与 `openapi.yaml`。
- 测试、规格与决策记录同步；`SCN-0206` 补登记/轮换/解绑与 `401` 失败路径。

**本轮不做**：

- 不实现执行面三端点（`EXE-01`–`EXE-03`）、`CMP-scheduler`、`CMP-instance`、`task`/`task_attempt` 表。
- 不实现 Harness 派生态 `health`/`lastHeartbeatAt`（依赖调度器 `presence` 读，随调度层工序落地）；当前仍返回列内历史值。
- 不改 `executor-http-v2`、client 实现、外部 UI。
- 不新增管理面鉴权（凭据可读回的风险已由用户接受，见决策记录 §4）。
- 场景 `SCN-0206` 仍为 `draft`：派发门禁与 presence 断言依赖未实现的调度层。

## 2 输入与约束

- [`harness/spec.md`](../../design/components/harness/spec.md) §2–§3.3、§7；[`kernel/spec.md`](../../design/components/kernel/spec.md) §3.1、§3.7–§3.9；[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) §4.1、§5.1、§7。
- [`2026-11-10-harness-node-registry.md`](../../history/decisions/2026-11-10-harness-node-registry.md)、[`2026-11-10-executor-client-token.md`](../../history/decisions/2026-11-10-executor-client-token.md)。
- `executor-http-v2`：无注册/心跳；`Bearer <token>` 语义不变。
- 凭据不得进入日志、错误 `details`、commit、文档、对话记录（AGENTS.md 安全边界）。
- 本地验收统一 `3100` 端口（`config/local.toml`），改完立即重启并验证 `/healthz` 与 `/openapi.yaml`。

## 3 交付物

| 交付物 | 状态 |
|---|---|
| 基线表 `client_id` / `client_token` + 唯一索引 + check | 完成 |
| `CMP-harness` 登记/解绑/凭据/端口实现与测试 | 完成 |
| `CMP-kernel` 错误与端口 + 测试 | 完成 |
| `CMP-http-gateway` `API-41` + DTO + `openapi.yaml` + 测试 | 完成 |
| 规格增量（harness/kernel/catalog/config/scheduler/gateway/architecture） | 完成 |
| 决策记录（凭据落库）与 `OQ-23` 关闭 | 完成 |
| `SCN-0206` 场景增量 | 完成（仍 `draft`） |

## 4 任务表

| ID | 类型 | 组件 | 状态 | 出口 |
|---|---|---|---|---|
| `T-NODE-03` | change | `CMP-harness`、`CMP-kernel`、`CMP-catalog`、`CMP-http-gateway`、`CMP-config` | 完成 | 表、端点、端口实现、测试与契约资产一致 |

## 5 验收标准

1. 登记 `{clientId, token}` 后详情回读两者且 `revision+1`；列表不含凭据。
2. 同一 `clientId` 或同一 token 被第二个 Harness 使用返回 `409 binding_conflict`；凭据冲突不回显 token。
3. 解绑清空两者且幂等；轮换后旧 token 解析为 `null`、新 token 生效。
4. `create`/`update` 不接受 `clientId`/`token`；缺 `If-Match` 428、缺 token 400、解绑带 token 400。
5. `NodeDirectory` 与 `ExecutorAuthenticator` 的语义符合 kernel 规格，且可由假实现替换。
6. `bun run check` 通过；`/openapi.yaml` 的 operation 数与 `http-gateway/spec.md` 一致；`3100` 端口实测与测试结论一致。

## 6 裁决

- 2026-11-10 用户确认 P2，并选择凭据「明文入库、详情可读回」（选项 C）与「设计更新 + 直接实现」。
- 派生 `health`/`lastHeartbeatAt` 明确延后到调度层工序，本工序不引入调度器依赖。
