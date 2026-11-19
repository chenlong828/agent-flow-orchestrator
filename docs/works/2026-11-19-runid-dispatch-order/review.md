---
layer: works
module: scheduler
status: closed
updated: 2026-11-19
---

# 评审：派发合并事务 + 提交后唤醒（P1）

## 走查

1. **正常流程**：`start` / `advance` → `dispatch` 打开事务 → `enqueue({ tx })` 插 task → 写 `run_node.task_id` → 写 `workflow_run` 游标 → 提交 → `notifyClient` → client poll 取到任务，`runId` 非空。
2. **失败流程**：事务内任一步失败 → 任务行与节点回填一起回滚，client 什么也没收到，run 停在原状态；没有「任务已下发但节点没有 taskId」的半成品。
3. **唤醒丢失**：`notifyClient` 在事务外执行；漏调时任务仍是 `queued`，最迟在客户端当前长轮询挂起到期（30s）后被取走，不丢任务。
4. **并发**：同一 run 的派发在 `withLock` 内单飞；事务内写表顺序为 `task` → `run_node` → `workflow_run`，与既有事务一致，无新增锁顺序。
5. **既有调用方**：不传 `tx` 时 `enqueue` 行为完全不变（自开事务 + `notifyAll`），本地探针与既有测试不受影响。

## 四档裁决

- **Blocker**：0
- **Decision now**：1 — `enqueue` 的契约形状（可选 `tx` + `clientIds` + `notifyClient`），已落 `docs/design/components/scheduler/spec.md` 与 `TC-EXD-030/031`，冻结后再改同属 breaking change。
- **Verified sound**：`dispatch` 的事务内写序、失败回滚、唤醒丢失的降级、缺省路径兼容；证据为 `TC-EXD-030/031`、`run-start` 的 `runId` 用例与全量 426 pass。
- **Hold**：1 — 历史 attempt 缺 `runId` 的兜底反查（`findSession` 退化查询），不阻塞本次，转 `plan/open-questions.md`。

## 结论

**通过**。合并门：blocker 已清零；decision 已落文档与测试；hold 已转出。
