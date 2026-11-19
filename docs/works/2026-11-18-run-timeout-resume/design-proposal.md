---
layer: works
module: run
status: closed
updated: 2026-11-18
procedure: 2026-11-18-run-timeout-resume
level: P1
---

# 设计提案：超时节点继续跑（同一 task 重开 attempt）

> 用户裁决（2026-11-18）：不做新 visit / 新 task / TTL / 次数上限。超时只加一个中间态；续跑把同一个 task 从 `done(timeout)` 重开为下一 attempt，写 `resume_session_id`，run_node 回到 `dispatched`，client 用同一 session 继续。

## 1 结论

1. client 上报 `timeout` 且带 `sessionId` 时，`CMP-run` 不再结算为终态，而是把 `run_node` 与 `workflow_run` 置 `waiting_resume`；scheduler 的 task 仍是 `done(timeout)`。
2. 人工调用 `POST /api/v1/runs/{id}/nodes/{nodeId}/resume`：
   - `CMP-scheduler` 的 `resumeTask(clientId, taskId, sessionId)` 把**同一个 task** 从 `done(timeout)` 改回 `queued`，`attempt+1`，写 `resume_session_id`，清空 `outcome/error/finished_at/dispatched_at/cancel_requested_at`；
   - `CMP-run` 把同一 `run_node` 行改回 `dispatched`（`visit` 不变），run 改回 `running`。
3. client 下一次 poll 拿到的还是同一个 `taskId`，只是 `attempt` 变了；`TaskRequest.resumeSessionId` 让 client 走 `session/resume`，继续同一 session。
4. 日志键 `(run_id, node_id, visit, attempt)` 因 `attempt+1` 天然不冲突；旧超时日志保留，新 attempt 另存一份。
5. 基础代码继续可用：`advance`、节点结算、结果信号、归档都不改语义；只多一个中间态和一个重开口。

## 2 现状

| 事实 | 落点 |
|---|---|
| 超时结果当前直接终态 | [`results.ts`](../../../src/components/run/results.ts#L106)：`run_node=failed`、`run=done(failed)` |
| 节点已有 `task_id`、`session_id` | `run_node` 列；超时结果也写 `session_id`（2026-11-17 工序） |
| 续跑传输已存在 | `TaskRequest.resumeSessionId`、scheduler `task.resume_session_id`、client `session/resume` |
| 任务生命周期 | `task.state` 三值 `queued/dispatched/done`；`done` 目前不可再改变 |
| 日志键 | `run_artifact` 会话日志唯一键 `(run_id, node_id, visit, attempt)` |
| 结果接受 | scheduler `acceptResult` 目前不校验 attempt，`done` 任务直接 `accepted=false` |

## 3 方案

### 3.1 选型

| 方案 | 结论 |
|---|---|
| **同一 task 重开 attempt（选中）** | 不新增 visit/task/日志键；只加 `waiting_resume` 和 scheduler `resumeTask`；最贴近「任务继续跑」 |
| 新 task + `resumeSessionId`（前稿） | 会新增 taskId；日志键可用 attempt 1 相同的新 task 冲突，需新 visit 或改日志键；复杂 |
| 重开 run / 新 run | 破坏终态或产生新 runId/task-space；不选 |

### 3.2 状态

```ts
type RunState = "created" | "running" | "waiting_confirm" | "waiting_resume" | "done";
type RunNodeState =
  | "queued"
  | "dispatched"
  | "waiting_confirm"
  | "waiting_resume"
  | "succeeded"
  | "rejected"
  | "failed";
```

- `waiting_resume`：超时且 `session_id` 非空；无在跑任务、无 `finished_at`、不归档。
- 计入「同工作区同一时刻一个活跃 run」的唯一索引与 `start` 冲突判定。
- 续跑后同一 `run_node` 行回到 `dispatched`，`visit` 不变；`task_id` 不变。
- 再次超时回到 `waiting_resume`，可反复人工续跑；无 TTL、无次数上限。
- 等待期 `cancel` 允许：节点 `failed(cancelled)`、run `cancelled`；task 已 `done(timeout)`，无需取消在跑任务。

### 3.3 `CMP-scheduler` 新方法

```ts
type SchedulerService = {
  // ...现有方法
  /** 人工续跑：把 done(timeout) 的同一 task 重开为下一 attempt。 */
  resumeTask(clientId: string, taskId: string, resumeSessionId: string): Promise<TaskSnapshot>;
};
```

判定顺序：

1. `taskId` 不存在或不属于该 `clientId` → `TaskNotFoundError`。
2. 任务 `queued`/`dispatched` 且 `resume_session_id === resumeSessionId` → 幂等，返回当前快照。
3. 任务 `done` 且 `outcome=failed`、`error.class=timeout` → 同事务重开：
   - `state='queued'`、`attempt=attempt+1`、`resume_session_id=$3`；
   - `outcome=null`、`error=null`、`finished_at=null`、`dispatched_at=null`、`cancel_requested_at=null`；
   - `not_before=now`、`updated_at=now`。
4. 其余状态 → `InvalidStateError("task_not_resumable")`。
5. 重开后唤醒该 client 的 poll（与 `enqueue` 相同）。

重开不改快照的 `prompt`、`workspace_path`、`task_space_path`、`timeout_ms`、`skill_set`、`result_signal`；`attempt` 与 `resume_session_id` 是 attempt 级字段，允许变化。`S-05` 的「快照冻结」按这一口径解释。

### 3.4 结果防重

`acceptResult` 增加 attempt 级判定：

- 任务不存在/不属于 client → `TaskNotFoundError`；
- 任务已 `done` → `accepted=false`；
- `(taskId, attempt)` 没有 `task_attempt` 行，或该行 `settled_at` 非空 → `accepted=false`；
- 否则接受并结算。

这样才能保证：`done(timeout)` 被重开后，旧 attempt 的迟到/重复结果不会把 task 再结算一次；正常 `S-02` 重派时旧副本结果仍可按首份接受（旧 attempt 的 `task_attempt` 未结算）。

### 3.5 `CMP-run` 方法

```ts
type ResumeNodeInput = { runId: string; nodeId: string; actor: string | null };

type RunService = {
  // ...现有方法
  resumeNode(input: ResumeNodeInput): Promise<RunDetail>;
};
```

判定顺序（同一 run 单飞）：

1. run / node 存在；节点最新 visit。
2. 节点 `waiting_resume`；若已是 `dispatched`，返回当前详情（幂等）；其余 → `InvalidStateError("node_not_waiting_resume")`。
3. `run_node.task_id` 与 `session_id` 非空；否则 `InvalidStateError("task_missing")` / `"session_missing"`。
4. `instance.isDispatchable` 与 `harnessRead.get(run.harness_id).enabled`；不满足 → `InvalidStateError("instance_not_dispatchable")`。
5. `scheduler.resumeTask(run.client_id, taskId, sessionId)`。
6. 同一 DB 事务：`run_node` 同一行置 `dispatched`、清空 `error/message/finished_at`、`dispatched_at=now`；run 置 `running`。
7. 返回 `RunDetail`。

超时结果处理：`applyResult` 在 `status=timeout` 且 `sessionId` 非空时：

- `run_node` 置 `waiting_resume`，写 `error/message/session_id`，不改 `task_id`、`visit`、`finished_at`（保持 null）；
- run 置 `waiting_resume`，不改 `outcome/finished_at`；
- 不 advance、不归档。

无 `sessionId` 的 timeout 保持现有 `failed` + run 失败。

### 3.6 HTTP

```http
POST /api/v1/runs/{id}/nodes/{nodeId}/resume
```

- 无请求体；成功 `200`，返回 `RunDetail`。
- `404`：run/node 不存在。
- `409 invalid_state`：`node_not_waiting_resume` / `task_missing` / `session_missing` / `instance_not_dispatchable` / `task_not_resumable`。
- 无 TTL、无次数、无配置项。

### 3.7 prompt

不改。续跑复用原任务快照的 `prompt`；client 在 `session/resume` 后再次发送同一 prompt，模型依靠 session 里已有的上下文继续。不在 prompt 里注入 `[继续]` 块（避免改任务快照与客户端契约）。

## 4 状态机与时序

```text
dispatched ──timeout + sessionId──▶ waiting_resume
                                         │
                          resume API ────┼──▶ 同一 run_node: dispatched
                                         │     同一 task: done → queued, attempt+1
                                         │
                                         ├─ cancel ──▶ failed(cancelled) / run.cancelled
                                         └─（无 TTL；等待人工）
```

```text
client                         CMP-run                         scheduler
  │ P-02 timeout(sessionId) ─────▶ acceptResult
  │                               node/run = waiting_resume
  │
  │                        人工 POST .../resume
  │                               resumeTask(taskId, sessionId)
  │                               ─────────────────────────────▶ done → queued, attempt+1
  │                               run_node = dispatched / run = running
  │ ◀───────────────────────────── 同一 taskId + resumeSessionId
  │ session/resume + 原 prompt
  │ P-02 result(attempt+1) ──────▶ 正常结算
```

## 5 数据与迁移

新增 `db/migrations/0012_run_timeout_resume.sql`：

1. `workflow_run.state` check 加入 `waiting_resume`；
2. `run_node.state` check 加入 `waiting_resume`；
3. 重建 `workflow_run_active_instance_key`，活跃态包含 `waiting_resume`；
4. 不加列、不加表、不改 `task`/`task_attempt`/`run_artifact`。

## 6 组件改动点

| 组件 | 改动 |
|---|---|
| `CMP-scheduler` | `types.ts` 加 `resumeTask`；`service.ts` 实现与唤醒；`store.ts` 加 `reopen`/`findAttempt`；`result.ts` 加 attempt 防重 |
| `CMP-run` | `types.ts` 状态与方法；`results.ts` 超时分支；`commands.ts` `resumeNode`；`node-ops.ts`/`store-node-write.ts` 的 waiting/resume 写入；`store-run-read.ts` 活跃查询；`advance.ts` no-op；`queries.ts` 恢复扫描跳过；`service.ts` 暴露 |
| `CMP-http-gateway` | `routes/run.ts` 新路径；`openapi.yaml` path + 状态枚举；`RUN_STATES` 加值 |
| `CMP-platform` | 迁移 `0012`、迁移清单与 schema 测试 |
| UI（跨项目） | `waiting_resume` 展示与「继续执行」动作 |
| client | 无改动；复用 `resumeSessionId` / `session/resume` |

## 7 失败与边界

| 情形 | 行为 |
|---|---|
| 无 `sessionId` 的 timeout | 保持现状直接失败 |
| 等待期取消 | 节点 `failed(cancelled)`、run `cancelled`；无在跑任务 |
| 重复 `resume` | 节点已 `dispatched` 返回当前详情；scheduler `resumeTask` 幂等 |
| 重开后旧结果迟到 | `acceptResult` 按 attempt 已结算拒绝 |
| `session/resume` 失败 | client 报 `protocol_error`，按普通失败结算；节点不再等待 |
| 实例/节点不可派发 | `resume` 返回 409，不改节点状态 |
| 进程重启 | `waiting_resume` 持久化；不自动续跑/推进；等人工 |
| 等待期占工作区 | 无 TTL；同工作区新 run 返回 `run_conflict`，需续跑或取消 |
| `S-02` 未回报超时 | 无结果/`sessionId`，不在本方案 |
| `taskMaxAttempts` | 人工重开会递增 `attempt`，计入「未回报重派」预算；client 正常回报 timeout 时不受影响；未回报耗尽仍按现有 `dispatch_attempts_exhausted` 结算 |

## 8 测试计划

| 覆盖 | 用例 |
|---|---|
| 进入等待 | timeout + `sessionId` → node/run `waiting_resume`，不归档，`finished_at` 为空 |
| 不进等待 | 无 `sessionId` → 现状失败 |
| 重开 | `resumeTask` 同一 taskId：`attempt+1`、`state=queued`、`resume_session_id` 写入、快照字段不变 |
| 续跑 | `resumeNode` 后 run_node 同一行 `dispatched`、run `running`；poll 拿到同一 taskId + `resumeSessionId` |
| 防重 | 重开后旧 attempt 结果 `accepted=false`；新 attempt 正常接受 |
| 幂等 | 重复 resume / 重复 resumeTask 不重复递增 attempt |
| 取消 | 等待期取消 → cancelled，不归档 |
| 错误 | 无 session、task 非 timeout、实例不可派发、node 状态不符 |
| 重启 | `waiting_resume` 保持；`resumePending` 不自动续跑 |
| 契约 | OpenAPI path/枚举；`RunDetail` 状态字符串 |
| 迁移 | 状态 check 与活跃唯一索引包含 `waiting_resume` |

## 9 发布与回滚

- 顺序：迁移 `0012` → 后端 → UI。UI 未适配前 `waiting_resume` 会显示未知状态，需同批发布或先不上线。
- 回滚：回滚代码与迁移；已处于 `waiting_resume` 的记录需一次管理动作结算为 `failed`。无配置开关。
- 不做 TTL/次数，因此没有运行期开关。

## 10 开放问题

1. 无 TTL：等待 run 会一直占用工作区，直到续跑或取消；是否可接受（当前按用户要求不做）。
2. `taskMaxAttempts` 与人工重开共用 `attempt`：未回报预算会被人工续跑消耗；是否需要把两者拆开（当前不做）。
3. confirm 同 visit 日志覆盖：已有隐患，另立工序。
4. 续跑复用原 prompt 是否会让模型重复执行：当前按「同一任务继续」接受，靠 session 已有上下文；若实测重复严重，再评估注入 `[继续]` 块。
