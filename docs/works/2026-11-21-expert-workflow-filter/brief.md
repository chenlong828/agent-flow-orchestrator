---
layer: works
module: expert
status: closed
updated: 2026-11-21
procedure: 2026-11-21-expert-workflow-filter
level: P2
---

# 工序：专家列表按工作流筛选

## 1 背景与需求

专家管理页目前只有搜索与启停筛选。用户要求提供按流程查询专家的 API：前台选定一条或多条流程后，只列出这些流程节点绑定过的专家，便于查询与过滤。需求卡见 [`REQ-0004`](../../requirements/REQ-0004-expert-workflow-filter.md)。

现状：

- `GET /api/v1/experts` 只接受 `q`、`enabled`、`limit`、`offset`、`sort`。
- 专家到流程的绑定存在 `workflow_expert_ref`（`workflow_id`、`node_id`、`expert_id`），由 `CMP-workflow` 唯一拥有；专家组件不允许直读工作流表。
- `CMP-catalog` 负责跨资产读组合，已经通过 `WorkflowRead.countByExperts` 计算专家 `refCount`。
- 网关规格原先明确「B1/B3 不提供专家工作流节点引用明细」；本次只补「按流程过滤专家列表」，不补节点明细。

## 2 范围

| 做 | 不做 |
|---|---|
| `GET /experts` 增加可重复的 `workflowId` 查询参数，多个取并集 | 不新增 `/workflows/{id}/experts` 端点 |
| 复用现有专家列表 DTO 与分页信封 | 不返回节点名/节点类型/节点顺序，不在卡片上附带流程 |
| `CMP-workflow` 增加按工作流批量取专家 ID 的只读方法 | 不改 `workflow_expert_ref` schema、不新增反向写入口 |
| `CMP-catalog` 组合「流程 → 专家 ID → 专家列表」，由 `CMP-expert` 做 ID 集过滤 | 不让 `CMP-expert` 直读 `workflow_expert_ref` |
| OpenAPI、组件规格、场景、需求卡、测试 | 不改 UI、client、运行编排、`refCount` 口径 |

## 3 定级

**P2**：兼容性公共契约变更（新增查询参数）、跨 `CMP-workflow` / `CMP-expert` / `CMP-catalog` / `CMP-http-gateway` 四个组件；不改表结构、数据所有权、分层依赖或热路径资源语义。

设计取舍与确认记录见 [`proposal.md`](./proposal.md)。

## 4 验收标准

1. 不传 `workflowId` 时，`GET /api/v1/experts` 的响应与当前契约一致；现有测试不回归。
2. 传一个 `workflowId` 时，只返回该工作流节点绑定过的专家；`total` 是过滤后的数量。
3. 传多个 `workflowId` 时取并集；同一专家被多个流程引用只出现一次；与 `q`、`enabled`、`sort`、`limit`/`offset` 叠加生效。
4. 未绑定任何流程的专家只在未传 `workflowId` 时出现。
5. 非法 `workflowId` 返回 400 `validation_error`，`details.field="workflowId"`；格式合法但不存在的工作流返回空列表。
6. 专家列表项字段、`refCount`（仍按全部工作流计数）不变。
7. `bun run typecheck`、相关组件测试、HTTP 契约测试、`bun run docs:check` 通过；OpenAPI 与实现一致。

## 5 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-EWF-01` | design | global | brief 与设计提案、需求卡、定级 | 完成 |
| `T-EWF-02` | change | workflow | `WorkflowRead.listExpertIdsByWorkflows` 与 store 查询 | 完成 |
| `T-EWF-03` | change | expert/catalog | 专家查询 `ids` 过滤；catalog 组合流程过滤与空集 | 完成 |
| `T-EWF-04` | change | http-gateway | 查询参数解析、校验、OpenAPI、网关规格 | 完成 |
| `T-EWF-05` | verify | global | 组件/HTTP/OpenAPI 测试、场景断言、`docs:check` | 完成 |
| `T-EWF-06` | close | global | review、result、roadmap、归档准备 | 完成 |

## 6 装载清单

- `docs/requirements/REQ-0004-expert-workflow-filter.md`
- `docs/works/2026-11-21-expert-workflow-filter/proposal.md`
- `src/components/workflow/{types.ts,store.ts,read.ts}`
- `src/components/expert/{types.ts,store.ts}`
- `src/components/catalog/{types.ts,expert.ts}`
- `src/components/http-gateway/{queries.ts,openapi.yaml,spec.md}`
- `tests/components/{workflow,expert,catalog,http-gateway}`
