---
layer: history
module: scheduler
status: frozen
updated: 2026-11-19
---

# 2026-11-19 派发合并事务 + 提交后唤醒

## 背景

0.6 起 `poll` 用 `run_node.task_id` 反查任务所属的 `runId`，写进下发给 client 的 `TaskRequest.runId`；缺了它，client 不写 attempt 归属与 run 注册表，运行中的会话观测（`/nodes/{id}/session`）与按 run 浏览文件都会 404。

派发原先把 `scheduler.enqueue`（提交后立刻 `notifyAll`）与「写 `run_node.task_id`」分成两个事务。被唤醒或恰好到达的长轮询会在这 1~3ms 的窗口内取走任务，`runIdForTask` 读到 null。2026-11-19 的 run 里 n1、n2 都丢了这个字段，n3 没丢——说明是时序竞态，不是逻辑分支。

## 决策

派发时把任务行、`run_node.task_id`、`workflow_run` 游标放进**同一个事务**，提交之后再唤醒 client：

- `scheduler.enqueue(input, { tx })`：传入调用方事务时任务插入加入该事务，且**不唤醒**；缺省路径（不传 `tx`）行为不变。
- `EnqueueResult` 增加 `clientIds`，供调用方在提交后唤醒。
- 新增 `scheduler.notifyClient(clientId)`。

## 被否决的方案

| 方案 | 否决赛由 |
|---|---|
| 只把 `notifyAll` 挪到 `task_id` 写入之后 | 不能消除竞态：恰好有一个新 poll 正在服务端执行时，它会在两个事务之间取走任务 |
| 在 poll 里对 `runId` 做同轮有限重试 | 只是收敛概率；且把「数据何时齐全」变成时间猜测 |
| 下发前校验字段不全就跳过本轮 | 需要新增 `deferred` 计数、短轮询与兜底判据，机制最重，收益与同轮重试相同 |
| `task` 表增加 `run_id` 列，入队时落库 | 同样能根治，但引入迁移，并把 run 归属写进调度器表；本次不需要动 schema |
| 跨组件共享同一连接/事务而不改契约 | 调度器的写入口被调用方事务支配，边界更糊；契约显式化后风险可控 |

## 影响

- `CMP-scheduler` 契约新增可选 `tx` 与 `notifyClient`；缺省路径不变，既有调用方与测试无需改动。
- `CMP-run` 派发事务边界变化：`enqueue` 从「事务外」变为加入派发事务。
- 唤醒丢失的后果由「任务丢失」降为「最迟等当前 poll 挂起到期（30s）被取走」；任务仍是 `queued`，不会丢。
- 不改表结构、不改执行面契约、不改 client。

## 验证

`tests/components/scheduler/service.test.ts`（`TC-EXD-030/031`）锁定「事务未提交不可见、回滚后不存在」「传 `tx` 不唤醒、`notifyClient` 才唤醒」；`tests/components/http-gateway/run-start.test.ts` 锁定「首节点与后继节点下发的任务都带 `runId`」。
