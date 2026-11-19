---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-run-asset-detach
level: P1
---

# 结果：运行终态脱钩，历史 run 不再阻止删除资产

## 1 结论

按方案 A「快照 + 物理删除」完成。run 进入 `done` 时在同一事务把活跃外键置空，历史展示改读 run 自己的快照；工作流、Harness、专家只在被**未终态 run** 或当前定义/装配引用时阻止删除。

- 终态 run 不再持有 `workflow_id` / `harness_id` / `run_node.expert_id`，删除对应资产后仍能读到 `workflowName` / `harnessName` / `graph` / `expertName`。
- 工作流删除补上 `ReferenceGuard` 与 409 映射，修掉原先的 500；活跃 run 的 409 `references` 含 `type="run"`。
- 迁移 `0013` 已在本地开发库应用：34 条 run 全部终态脱钩，`workflow_ref_id` / `harness_ref_id` / `*_name` 回填完整；192 条 `run_node` 的 `expert_id` 全部为空，11 条 `confirm` 节点的 `expert_name` 按设计为 null。

## 2 变更清单

| 范围 | 变更 |
|---|---|
| 迁移 | `db/migrations/0013_run_asset_snapshot.sql`：快照列、回填、终态脱钩、`workflow_run_history_detached` check、索引 |
| `CMP-run` | `start` 冻结工作流/Harness 名与 ref ID，并把插入窗口的工作流/Harness 外键冲突映射为 404；`createNode` 冻结 `expert_name`；`finishRun` 脱钩 run 与全部节点；`RunSummary`/`RunDetail`/`RunNodeView` 读模型；`RunReferenceReader` |
| 删除 guard | `CMP-workflow` 新增 `ReferenceGuard` 预检与 409；`CMP-harness`/`CMP-expert` 换用合成 guard；`CMP-catalog` 增加 `workflow` 分支；组合根合成定义引用与活跃 run 引用 |
| 契约 | OpenAPI：`RunSummary.workflowName`/`harnessName`、`RunDetail.graph`、`RunNodeView.expertName`、`ReferenceItem.type=run`、删除端点描述 |
| 测试 | `tests/db/schema.test.ts`、`tests/components/platform/db.test.ts`、`tests/components/http-gateway/openapi.test.ts`、`tests/components/http-gateway/run-asset-detach.test.ts`、`tests/helpers/app.ts` |
| 文档 | run/workflow/harness/expert/catalog/kernel/http-gateway 规格、architecture、SCN-0101、SCN-0301、OQ-30、决策记录 |

## 3 验证结果

| 命令/检查 | 结果 |
|---|---|
| `bun run typecheck` | 通过，无输出 |
| `bun test --max-concurrency=1` | 431 pass / 1 skip / 0 fail（432 个测试，52 个文件） |
| `bun run docs:check` | 场景索引已是最新：17 个场景 |
| `bun run quality:report` | 违规 0 条；仅报告 225 条；工具健康 8/8 |
| `bun run db:migrate` | applied=1 skipped=12；`0013_run_asset_snapshot.sql` 已应用 |
| 开发库核对 | 34 条 run 全部 `workflow_id`/`harness_id` 为空，`workflow_ref_id`/`harness_ref_id` 非空；192 条 `run_node.expert_id` 全为空；11 条 `confirm` 节点 `expert_name` 为 null |
| 3100 重启 | `bun run scripts/start-bg.ts reload` 成功；`/healthz` 返回 `{"status":"ok","database":"up"}`；`/openapi.yaml` 已包含 `workflowName` / `expertName` / `graph` |

新增测试断言：

- 终态 run 后删除工作流/专家/Harness 均 204，`GET /runs/{id}` 仍返回快照名与冻结图；DB 行活跃外键为空、快照列完整。
- 活跃 run 时删除工作流/Harness 返回 409 `referenced`，`details.references` 含 `type="run"` 的 runId；工作流删除不再 500。
- `workflow_run_history_detached` 拒绝把终态 run 的 `workflow_id` 改回非空。

## 4 结论落点

| 文档 | 落点 |
|---|---|
| 运行组件 | [`run/spec.md`](../../design/components/run/spec.md)：数据列、快照不变量、终态脱钩、`RunReferenceReader`、验证计划 |
| 工作流 | [`workflow/spec.md`](../../design/components/workflow/spec.md)：删除 guard、未终态 run 409、允许依赖 `ReferenceGuard` |
| Harness / 专家 | [`harness/spec.md`](../../design/components/harness/spec.md)、[`expert/spec.md`](../../design/components/expert/spec.md)：删除保护加入未终态 run |
| 引用 | [`catalog/spec.md`](../../design/components/catalog/spec.md)、[`kernel/spec.md`](../../design/components/kernel/spec.md)：guard 合成、`RunReferenceReader`、`Reference.type=run` |
| HTTP | [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)、[`openapi.yaml`](../../../src/components/http-gateway/openapi.yaml) |
| 架构 | [`architecture.md`](../../design/architecture.md)：端口合成、数据所有权、`0013` 记录 |
| 场景 | [`SCN-0101`](../../design/scenarios/workflow-orchestration/workflow-definition/workflow-portfolio-management/scenario.md)、[`SCN-0301`](../../design/scenarios/workflow-orchestration/workflow-execution/run-start-and-node-advance/scenario.md) |
| 开放问题 | [`OQ-30`](../../plan/open-questions.md) 已关闭 |
| 决策 | [`2026-11-18-run-history-asset-detach`](../../history/decisions/2026-11-18-run-history-asset-detach.md) |

## 5 偏差与待定

| 项 | 说明 |
|---|---|
| UI 运行页 | `T-DET-08` 未开始：UI 必须改用 `RunDetail.graph` 与 `workflowName`/`harnessName`/`expertName`，否则删除工作流后运行页仍会按 `workflowId` 回查 404。本仓库只出契约 |
| `OQ-27` | 归档保留期与清理仍未定，不在本工序 |
| `instance` 删除 | 当前没有删除入口；将来若加，需要相同的终态脱钩，另立工序 |
| 质量 WARN | `workflow_run` 24 列、`run_node` 可空比例 58.8% 属仅报告阈值，不是违规；由后续表宽/字段治理决定是否收敛 |
