---
layer: works
module: global
status: active
updated: 2026-11-10
procedure: 2026-11-10-node-registry-implementation
---

# 结果：节点登记与执行面凭据落库

## 1 验收对照

| 判据（[`brief.md`](brief.md) §5） | 结果 | 证据 |
|---|---|---|
| 登记后详情回读 `clientId`/`clientToken` 且 `revision+1`；列表不含凭据 | 满足 | 服务测试「登记节点同时写入…详情回读、列表不返回凭据」；HTTP 测试「API-41 登记节点…」 |
| 同一 `clientId` / 同一 token 冲突 409，凭据不回显 | 满足 | 服务测试两条 + `BindingConflictError` 细节断言；HTTP 409 `binding_conflict` |
| 解绑清空且幂等；轮换后旧 token 失效、新 token 生效 | 满足 | 服务测试「解绑…幂等」「凭据解析…」；HTTP「API-41 轮换凭据复用同一入口」 |
| `create`/`update` 不接受凭据字段；428/400 语义 | 满足 | HTTP「API-41 冲突与校验…」；`PUT` 带 `clientId` → 400 |
| `NodeDirectory` / `ExecutorAuthenticator` 语义与 kernel 规格一致 | 满足 | kernel 规格 §3.8；服务测试「节点目录端口」「凭据解析」 |
| `bun run check` 通过；OpenAPI 与规格计数一致；3100 实测 | 满足 | 见 §2 |

## 2 验证记录

```bash
export PATH="$PWD/.local/bun:$PATH"
bun run db:init && bun run db:migrate && bun run db:seed   # 重建开发库：applied=1，种子 Harness 5
bun run check                                             # tsc --noEmit + bun test + docs:check
bun run quality:report                                     # 违规统计
```

- `bun run check`：typecheck 通过；**295 pass / 0 fail**（2718 个断言，32 个文件）；`docs:check` 场景索引最新。
- `bun run quality:gate`：违规 0（`handleHarness` 的 API-41 分支与 `setEnabled`/`bindClient` 重复写法已抽为 `handleHarnessCollection`、`handleClientBinding`、`applyRevisioned`）。
- 3100 端口实测（`config/local.toml`）：
  - `GET /healthz` → `{"status":"ok","database":"up"}`；`/openapi.yaml` 含 `API-41`。
  - `PATCH /api/v1/harnesses/{id}/client` 提交 `{clientId:"demo-node-01",token:"<演示 token>"}`（`If-Match: "1"`）→ 200，`revision=2`，详情回读 `clientId`/`clientToken`。
  - 第二个 Harness 用同一 `clientId` 登记 → 409 `{"code":"binding_conflict","details":{"field":"clientId","clientId":"demo-node-01"}}`。
  - `{clientId:null}` 解绑（`If-Match: "2"`）→ 200，`clientId=null`、`clientToken=null`、`revision=3`。
- 验收用 token 为一次性演示值，未回填到文档、日志或仓库；凭据字段在响应里按设计回显（本机调试用途）。

## 3 结论落点

| 结论 | 落点 |
|---|---|
| `harness.client_id` / `client_token` 列、唯一索引、表级 check | [`db/migrations/0001_baseline.sql`](../../../db/migrations/0001_baseline.sql) |
| `bindClient`/`unbindClient`、`getByClientId`、`NodeDirectory`/`ExecutorAuthenticator` 实现 | [`harness/spec.md`](../../design/components/harness/spec.md) §2–§3.3、§7；`src/components/harness/` |
| `BindingConflictError`、两个端口 | [`kernel/spec.md`](../../design/components/kernel/spec.md) §3.1、§3.7–§3.9 |
| `clientId`/`clientToken` 投影 | [`catalog/spec.md`](../../design/components/catalog/spec.md) §2 |
| `API-41`、`HarnessClientBinding`、`HarnessDetail.clientToken` | [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) §4.1、§5.1、§7；`src/components/http-gateway/openapi.yaml` |
| 凭据不再走配置 | [`config/spec.md`](../../design/components/config/spec.md) §3.1–§3.2、§7 |
| 鉴权改走 `ExecutorAuthenticator`、删除启动交集 | [`scheduler/spec.md`](../../design/components/scheduler/spec.md) §4.8、§5 |
| 登记/轮换/解绑与 401 路径 | [`SCN-0206`](../../design/scenarios/workflow-orchestration/execution-scheduling/executor-node-registry/scenario.md) |
| 端点计数 48、实施状态 | [`architecture.md`](../../design/architecture.md) §1、§6、§10 |
| 凭据落库决策、风险与复试条件 | [`2026-11-10-executor-client-token.md`](../../history/decisions/2026-11-10-executor-client-token.md) |

## 4 未完成与待办

1. **派生态 `health`/`lastHeartbeatAt`**：延后到调度层工序（`presence` 读）；当前对外仍取列内历史值（`review.md` `D-03`）。
2. **调度器侧门禁与执行面三端点**：`NodeDirectory.isDispatchable` 的调用方、`ExecutorAuthenticator` 的消费方（`EXE-01`–`EXE-03`）随 `CMP-scheduler` 落地。
3. **`SCN-0206` 转 `designed`**：待派发门禁与 presence 断言可写后补齐（`review.md` `H-01`）。
4. **凭据轮换审计**：当前只保留当前值，需要「谁在何时轮换」时另立设计（决策记录 §5）。
5. **生产前置**：产品端点暴露到非本机前必须补管理面鉴权或改哈希存储（决策记录 §4）。

## 5 裁决摘要

blocker 0 / decision 3（已落文档与测试）/ hold 3（已转出，不阻塞）。
