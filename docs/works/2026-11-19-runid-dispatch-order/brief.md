---
layer: works
module: scheduler
status: active
updated: 2026-11-19
---

# 修复：派发时 runId 丢失（任务行与 run_node.task_id 不同步可见）

## 现象

运行中节点的会话观测返回 `session_not_linked`，运行文件面同样不可用，结算后才恢复。

## 根因

`run.dispatch` 先 `scheduler.enqueue`（提交后立即 `notifyAll`），再用另一个事务写 `run_node.task_id`；被唤醒或恰好到达的 poll 在窗口内取走任务，`runIdForTask` 读到 null，client 侧 attempt 与 run 注册表都没有 `runId`。

## 方案（已确认：B1+）

任务行与 `run_node.task_id`、`workflow_run` 游标放进**同一个事务**，提交之后才唤醒客户端：

- `scheduler.enqueue` 增加可选 `{ tx }`：传入时任务插入跑在调用方事务内且不通知，返回 `clientIds`。
- `scheduler.notifyClient(clientId)`：由调用方在提交后唤醒。
- 缺省调用（不传 `tx`）行为不变，现有调用方与测试无需改动。

## 非目标

- 不改 `task` / `run_node` 表结构。
- 不改 client 代码、执行面契约版本、OpenAPI。
- 不引入“下发前校验/跳过本轮”的状态机。

## 验收标准

1. 事务未提交时，其他连接查不到该任务；回滚后任务行不存在。
2. `run` 派发完成后立即 poll，任务自带 `runId`。
3. 提交后才通知：通知不会早于任务可见。
4. 既有调度/运行/网关测试全绿；`bun run typecheck`、`bun test`、`bun run quality:report` 通过。

## 任务表

| ID | 类型 | 组件 | 状态 | 说明 |
|---|---|---|---|---|
| T1 | change | CMP-scheduler | done | `enqueue` 支持外部事务与 `clientIds`；新增 `notifyClient` |
| T2 | change | CMP-run | done | `dispatch` 合并事务，提交后通知 |
| T3 | test | CMP-scheduler / CMP-run | done | 可见性、回滚、runId 断言 |
| T4 | ops | 运行服务 | done | 重启 3100 并验证 `/healthz`、`/openapi.yaml` |

## 装载清单

`src/components/scheduler/{types,enqueue,service}.ts`、`src/components/run/dispatch-ops.ts`、`tests/components/{scheduler,run}/*`。
