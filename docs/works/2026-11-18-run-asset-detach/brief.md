---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-run-asset-detach
level: P1
---

# 工序：运行终态脱钩，允许删除历史 run 引用的资产

> 用户裁决（2026-11-18）：选方案 A「快照 + 物理删除」。终态 run 不再用外键钉住工作流、Harness、专家；历史 run 的展示靠 run 自己的快照。活跃 run 仍由外键保护。

## 1 背景

用户反馈：已经运行结束的任务只是归档资料，但它在界面上绑定的工作流、专家、技能、Harness 都无法删除，哪怕是测试目的建的数据，不合理。

这不是 UI 权限，而是数据库把「终态 run 的历史引用」当成了活引用：

- 本地开发库当前 34 条 run，其中 33 条 `done`；7 个工作流、1 个 Harness、14 个专家被这些 run 引用。
- `workflow_run.workflow_id`、`workflow_run.harness_id`、`workflow_run.instance_id`、`run_node.expert_id` 都是 `ON DELETE RESTRICT`（[0002_workflow_run.sql](../../../db/migrations/0002_workflow_run.sql)）。
- 删除带 run 的工作流会被 `workflow_run_workflow_id_fkey` 拦下；`deleteWorkflow` 没有把外键错误翻译成 409（[service.ts](../../../src/components/workflow/service.ts)），界面拿到 500。
- Harness 的引用检查只查工具，不查 run（[references.ts](../../../src/components/catalog/references.ts)），409 的 `references` 是空数组；专家只被终态 run 引用时同样 409 + 空列表。
- 技能/工具没有直接指向 run 的外键，但被专家装配引用；链路是 workflow → expert → skill/tool，所以整条链都删不掉。

这是 [OQ-30](../../plan/open-questions.md) 记录的 Harness 问题，只是范围比它大。

## 2 范围

| 做 | 不做 |
|---|---|
| `workflow_run` / `run_node` 增加历史快照列；run 进入 `done` 时在同一事务把活跃外键置空 | 不做 run 记录保留期、归档清理与配额（`OQ-27`） |
| 迁移 `0013`：加列、回填、终态脱钩、check 约束、索引 | 不做 `instance` 删除入口；`workflow_run.instance_id` 仍是 `RESTRICT` |
| `RunSummary` / `RunDetail` / `RunNodeView` 增加名字与冻结图字段 | 不做软删除、回收站或资产恢复 |
| 删除工作流补 `ReferenceGuard` 与 409；修 500；Harness/专家 409 列出活跃 run | 不做技能包文件 GC；删除技能仍按现有包清理规则 |
| 新增 `RunReferenceReader` 端口，组合根合成定义引用与活跃 run 引用 | 不改执行面契约 `executor-http-v3`；不改 client |
| 组件规格、架构文档、场景断言、OpenAPI、迁移与测试 | UI 运行页改用 `RunDetail.graph` 与名字字段属于 UI 仓库的配套改动，本工序只出契约 |

## 3 定级

**P1**：改核心表 `workflow_run` / `run_node` 的 schema 与删除语义，改 `RunDetail` / `RunSummary` / `RunNodeView` 公共契约，跨 `CMP-run`、`CMP-workflow`、`CMP-harness`、`CMP-expert`、`CMP-catalog`、`CMP-kernel`、`CMP-http-gateway`。

## 4 验收标准

1. 迁移后，终态 run 的 `workflow_id` / `harness_id` 为 null，`run_node.expert_id` 为 null；`workflow_ref_id` / `harness_ref_id` / `*_name` / `expert_name` 已回填；活跃 run 保留活跃外键。
2. 删除只被终态 run 引用的工作流、Harness、专家返回 204；对应历史 run 的详情仍返回启动时的 `workflowName` / `harnessName` / `graph` / `expertName`。
3. 删除被活跃 run（`created` / `running` / `waiting_confirm` / `waiting_resume`）引用的工作流、Harness、专家返回 409 `referenced`；`details.references` 至少包含 `type="run"` 的条目；不再返回 500 或空 references。
4. `workflow_run` 的 check 约束拒绝任何 `state='done'` 但活跃外键非空的写入/更新。
5. run 启动时写入快照；`finishRun` 是唯一终态入口，取消、失败、重启补结算、超时失败都走同一条脱钩逻辑。
6. `GET /api/v1/runs/{id}` 与列表返回新增字段；`workflowId` 过滤仍按启动时工作流 ID 生效（即使工作流已删除）。
7. 被当前工作流节点引用的专家仍返回 409 `referenced`（`type="workflow"`）；技能/工具仍按专家装配保护，不受本次改动放宽。
8. 迁移、组件测试、HTTP 契约测试、`bun run typecheck`、`bun run quality:report` 通过。

## 5 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-DET-01` | design | global | 本 brief 与设计提案、方案取舍 | 完成 |
| `T-DET-02` | change | platform | 迁移 `0013`：快照列、回填、终态脱钩、check、索引 | 完成 |
| `T-DET-03` | change | run | `start` 写快照；`finishRun` 脱钩；类型/读模型/`RunReferenceReader` | 完成 |
| `T-DET-04` | change | workflow / harness / expert | 删除 guard、活跃 run 409、工作流删除 500 修复、组合根合成 guard | 完成 |
| `T-DET-05` | change | http-gateway | `RunDetail` / `RunSummary` / `RunNodeView` 字段、OpenAPI、409 文档 | 完成 |
| `T-DET-06` | docs | global | run/workflow/harness/expert/catalog/kernel/http-gateway 规格、architecture、场景断言、决策记录 | 完成 |
| `T-DET-07` | verify | run / workflow / harness / expert / http | 迁移、组件、契约、架构约束测试与质量报告 | 完成 |
| `T-DET-08` | change | UI（跨项目） | 运行页改用 `RunDetail.graph` 与名字字段；删除前提示历史 run 影响 | 待开始（本仓库外） |

## 6 装载清单

- 现行契约：[`run/spec.md`](../../design/components/run/spec.md)、[`workflow/spec.md`](../../design/components/workflow/spec.md)、[`harness/spec.md`](../../design/components/harness/spec.md)、[`expert/spec.md`](../../design/components/expert/spec.md)、[`catalog/spec.md`](../../design/components/catalog/spec.md)、[`kernel/spec.md`](../../design/components/kernel/spec.md)、[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)、[`architecture.md`](../../design/architecture.md)
- run：[`core.ts`](../../../src/components/run/core.ts)、[`store-run-write.ts`](../../../src/components/run/store-run-write.ts)、[`store-run-read.ts`](../../../src/components/run/store-run-read.ts)、[`store-node-write.ts`](../../../src/components/run/store-node-write.ts)、[`store-view.ts`](../../../src/components/run/store-view.ts)、[`queries.ts`](../../../src/components/run/queries.ts)、[`types.ts`](../../../src/components/run/types.ts)、[`store-types.ts`](../../../src/components/run/store-types.ts)、[`advance.ts`](../../../src/components/run/advance.ts)
- 删除与引用：`src/components/workflow/service.ts`、`src/components/harness/service.ts`、`src/components/expert/write.ts`、`src/components/catalog/references.ts`、`src/core/kernel/ports.ts`、`src/main.ts`
- 数据库：[`0001_baseline.sql`](../../../db/migrations/0001_baseline.sql)、[`0002_workflow_run.sql`](../../../db/migrations/0002_workflow_run.sql)
- HTTP：[`openapi.yaml`](../../../src/components/http-gateway/openapi.yaml)、`src/components/http-gateway/routes/run.ts`
- 场景：[`SCN-0101`](../../design/scenarios/workflow-orchestration/workflow-definition/workflow-portfolio-management/scenario.md)、[`SCN-0301`](../../design/scenarios/workflow-orchestration/workflow-execution/run-start-and-node-advance/scenario.md)、[`SCN-0001`](../../design/scenarios/agent-capability-assets/expert-capability-definition-and-assembly/expert-definition-and-assembly-management/scenario.md)

## 7 领取的开放问题

| 编号 | 说明 |
|---|---|
| `OQ-30` | 删除 Harness 与运行记录的冲突；本工序把范围扩大到工作流/专家，结论落地后关闭 |
| `OQ-27` | 归档保留期与清理；本工序不做，保持待定 |

## 8 待定

| 项 | 说明 |
|---|---|
| UI 删除确认文案 | 删除只被终态 run 引用的资产时，是否在 UI 提示影响条数；由 UI 仓库定，本仓库只提供契约 |
| 历史 run 的专家 ID 审计 | 不加 `expert_ref_id`：`graph_snapshot` 的节点仍保留启动时 `expertId`，展示用 `expertName`；若审计需要稳定列，另立工序 |
| `instance` 删除 | 当前没有删除入口；若将来加，需同样做终态脱钩，另立工序 |
