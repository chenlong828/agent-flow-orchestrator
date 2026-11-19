---
layer: history
module: run
status: frozen
updated: 2026-11-18
---

# 决策：运行终态脱钩，历史 run 不阻止删除资产

## 背景

终态 run 长期以 `workflow_run.workflow_id`、`harness_id`、`run_node.expert_id` 外键钉住工作流、Harness 与专家，导致测试期建的工作流/专家/Harness 只要跑过一次就永久不能删除；工作流删除还会因未映射的外键错误返回 500。`OQ-30` 记录了 Harness 这一条，实际覆盖全部资产。

2026-11-18 用户裁决：终态 run 只是归档资料，不应阻止删除；历史展示由 run 自己保存。方案选择「快照 + 物理删除」。

## 决策

1. **活跃引用与历史快照分离**：`workflow_run.workflow_id` / `harness_id`、`run_node.expert_id` 是活跃引用，只在 run 未终态时非空；`workflow_ref_id` / `harness_ref_id` / `workflow_name` / `harness_name` / `expert_name` 是启动时冻结的历史快照。
2. **终态脱钩**：`CMP-run.finishRun` 在置 `done` 的同一事务把该 run 的活跃外键与该 run 全部 `run_node.expert_id` 置空；`workflow_run_history_detached` check 约束兜底 run 根。
3. **外键保持 `RESTRICT`**：未终态 run 仍由数据库阻止删除，应用层 409 的 `references` 列出 `type="run"`；终态 run 已无外键，删除直接成功。不使用 `ON DELETE SET NULL` 或 trigger。
4. **引用检查合成**：`catalog` 继续提供定义侧引用，`CMP-run` 新增只读 `RunReferenceReader` 提供未终态 run 引用，组合根合成 `ReferenceGuard` 后注入删除服务。工作流删除补 guard 与 409，修掉 500。
5. **契约加法**：`RunSummary` 增加 `workflowName`/`harnessName`，`RunDetail` 增加 `graph`，`RunNodeView` 增加 `expertName`；`workflowId`/`harnessId` 仍为非空历史 ID。运行页应改读 `RunDetail.graph` 与快照名，不再按 `workflowId` 回查工作流。
6. **删除语义**：只被终态 run 引用的工作流/Harness/专家可物理删除；被未终态 run、当前工作流节点、专家装配或工具引用时仍返回 409 `referenced`。技能/工具链路不变。

## 被否决的方案

- **`ON DELETE SET NULL` + trigger 拦截活跃 run**：需要新增 trigger 机制与自定义错误码；应用层仍需解释 409，且 `SET NULL` 本身分不清活跃/终态。
- **去掉 run 侧外键**：活跃 run 失去数据库兜底，删除与启动并发时可能删掉正在用的资产；与既有「外键兜底并发窗口」口径冲突。
- **删除时由 run 组件脱钩**：脱钩与删除分两次写，失败会留下半脱钩；放进同一事务需要跨组件传事务，边界更重。
- **软删除**：用户选择物理删除；软删除只隐藏，不释放行与技能包，仍需 purge 工序。
- **保留 `RESTRICT`，只补全 409 references**：不满足「测试数据能删」的诉求。

## 后果与回滚

- `0013` 是只向前迁移：回填快照、终态行脱钩；回滚需要重新引入列并恢复外键，历史 run 的原始引用无法从快照恢复为可查询资产（资产可能已删除）。
- 删除只被终态 run 引用的资产是不可逆操作；历史 run 仍可读名称、图、专家名，但资产本身不再存在。
- `RunDetail.graph` 增大详情响应；当前图规模小，冷读可接受。
- UI 必须改用 `RunDetail.graph` 与名字字段，否则工作流删除后运行页仍会回查 404；UI 在独立仓库，属于配套改动。
- `workflow_run` 增至 24 列（质量报告 WARN，非违规）；`run_node` 可空列比例上升（WARN）。

## 落点

- 设计提案与验收：[`2026-11-18-run-asset-detach`](../../works/2026-11-18-run-asset-detach/design-proposal.md)
- 迁移：[`0013_run_asset_snapshot.sql`](../../../db/migrations/0013_run_asset_snapshot.sql)
- 契约：[`CMP-run`](../../design/components/run/spec.md)、[`CMP-workflow`](../../design/components/workflow/spec.md)、[`CMP-harness`](../../design/components/harness/spec.md)、[`CMP-expert`](../../design/components/expert/spec.md)、[`CMP-catalog`](../../design/components/catalog/spec.md)、[`CMP-kernel`](../../design/components/kernel/spec.md)
- 开放问题：`OQ-30` 已关闭；`OQ-27`（归档保留期/清理）仍待定。
