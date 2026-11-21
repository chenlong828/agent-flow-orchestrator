---
layer: works
module: expert
status: closed
updated: 2026-11-21
procedure: 2026-11-21-expert-workflow-filter
level: P2
---

# 结果：专家列表按工作流筛选

## 1 结论

`GET /api/v1/experts` 已支持可重复的 `workflowId` 过滤：前台选定一条或多条工作流后，只返回这些流程节点绑定过的专家；多个流程取并集，未绑定专家只在未传参数时出现。响应仍是现有专家卡片 DTO，`total` 为过滤后数量，`refCount` 仍按全部工作流计数。

实现分层：`CMP-http-gateway` 解析与校验 → `CMP-catalog` 组合「流程 → 专家 ID → 专家列表」→ `CMP-workflow` 只读 `workflow_expert_ref`、`CMP-expert` 只做 ID 候选集过滤。`CMP-expert` 不读工作流表，数据所有权未变。

## 2 变更清单

| 范围 | 变更 |
|---|---|
| `CMP-http-gateway` | `parseExpertListQuery` 解析可重复 `workflowId`、逐个 UUID 校验、去重；OpenAPI 增加数组查询参数；规格补充语义 |
| `CMP-catalog` | 新增 `ExpertListQuery`（`workflowIds`）；`listExperts` 先取流程专家 ID 集，空集直接返回空分页信封；`refCount` 逻辑不变 |
| `CMP-workflow` | `WorkflowRead.listExpertIdsByWorkflows`：`select distinct expert_id ... where workflow_id = any(...)`；空入参返回 `[]` |
| `CMP-expert` | `ExpertQuery.ids` 候选集过滤；store 追加 `e.id = any($n::uuid[])`；空候选集返回空页；分页/`total` 在 SQL 层完成 |
| `CMP-kernel` | `buildWhere` 的 `FilterField` 增加 `any`/`cast`，用于数组参数过滤；空数组不产生条件 |
| 契约与文档 | OpenAPI、expert/workflow/catalog/http-gateway 规格、`SCN-0001`、`REQ-0004`、工序 brief/proposal/review/result、roadmap |
| 测试 | kernel `buildWhere`、workflow 引用投影、catalog 组合、专家 HTTP `TC-EXP-002`、非法参数、OpenAPI 参数 |

无数据库迁移、无新增表/列/端点、无新依赖。

## 3 验证结果

| 命令/检查 | 结果 |
|---|---|
| `bun run typecheck` | 通过，无输出 |
| `bun test --max-concurrency=1` | 455 pass / 1 skip / 0 fail（456 个测试，54 个文件） |
| `bun run docs:index` | 已生成 18 个场景 |
| `bun run docs:check` | 场景索引已是最新：18 个场景 |
| `bun run quality:report` | 违规 0 条；仅报告 235 条；工具健康 8/8 |
| 本地服务重启 | `./scripts/start-dev.sh reload` 后 `/healthz` 返回 `ok/up`，`/openapi.yaml` 含 `workflowId` 数组参数 |
| 实测：不传过滤 | `GET /experts?limit=200` → 16 个专家 |
| 实测：单流程 | `GET /experts?workflowId=fec3f253-…` → 7 个专家（故障修复流程绑定的专家） |
| 实测：非法 UUID | `GET /experts?workflowId=bad` → 400 `validation_error`，`details.field="workflowId"` |
| 实测：未知工作流 | `GET /experts?workflowId=0191f2f0-…` → 200 `{items:[],total:0,limit:50,offset:0}` |

## 4 结论落点

| 内容 | 落点 |
|---|---|
| 需求 | [`REQ-0004`](../../requirements/REQ-0004-expert-workflow-filter.md)，`delivered` |
| 场景 | [`SCN-0001`](../../design/scenarios/agent-capability-assets/expert-capability-definition-and-assembly/expert-definition-and-assembly-management/scenario.md)，`R2` 扩展并转 `verified` |
| 契约 | [`openapi.yaml`](../../../src/components/http-gateway/openapi.yaml)、[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) §5.4 |
| 组件规格 | [`expert/spec.md`](../../design/components/expert/spec.md)、[`workflow/spec.md`](../../design/components/workflow/spec.md)、[`catalog/spec.md`](../../design/components/catalog/spec.md) |
| 排期 | [`roadmap.md`](../../plan/roadmap.md) 近期完成 |
| 评审 | [`review.md`](./review.md)，blocker 0 / decision 2 / hold 1 |

## 5 偏差与说明

- `SCN-0001` 原先因覆盖范围标 `designed`；本次 `R1`/`R2`/`R3`/`N1` 均通过（`TC-EXP-001`～`TC-EXP-004`），按场景 `verified` 判据转 `verified`，删除/引用保护/启停仍按覆盖边界不纳入本场景。
- 工作区另有本次工序开始前就存在的未提交改动（`scripts/seed.ts`、`tests/scripts/seed.test.ts`），未纳入本工序的变更与提交。
