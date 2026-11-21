---
layer: works
module: expert
status: closed
updated: 2026-11-21
procedure: 2026-11-21-expert-workflow-filter
level: P2
---

# 设计提案：专家列表按工作流筛选（P2）

## 1 变更说明

在 `GET /api/v1/experts` 上增加可重复的 `workflowId` 查询参数：

- 不传：保持现在的全量专家列表。
- 传一个或多个：只返回这些工作流节点绑定过的专家；多个工作流取并集，同一专家只出现一次。
- 与 `q`、`enabled`、`sort`、`limit`、`offset` 同时生效，`total` 为过滤后的总数。
- 响应 DTO 不变；`refCount` 仍统计该专家被多少个工作流引用，不因本次筛选收窄。

示例：

```http
GET /api/v1/experts?workflowId=0191f2f0-7a5e-7c3b-9d1a-3f2b4c5d6e7f&sort=name:asc
GET /api/v1/experts?workflowId=<wf-1>&workflowId=<wf-2>&enabled=true&limit=50
```

## 2 契约 diff

| 位置 | 当前 | 变更后 |
|---|---|---|
| `GET /experts` 查询参数 | `q`、`enabled`、`limit`、`offset`、`sort` | 增加可重复的 `workflowId`（UUID） |
| 响应 `ExpertList` | 专家卡片分页列表 | 不变 |
| `ExpertListItem.refCount` | 引用该专家的去重工作流数 | 不变，仍按全部工作流计数 |
| 专家详情、写端点、工作流端点 | — | 不变 |

错误与边界：

- `workflowId` 非 UUID 或空字符串：`400 validation_error`，`details.field="workflowId"`。
- 同一个 `workflowId` 重复传：去重后按一次处理。
- 格式合法但不存在的工作流 ID：空列表，不返回 404；查询参数只做过滤，不承担资源定位。
- 未绑定任何流程的专家：只在未传 `workflowId` 时出现；不增加 `unbound` 之类的特殊值（`REQ-0004` 非目标）。
- 过滤后无结果：正常 200 空分页信封，保留请求的 `limit`/`offset`。

## 3 组件与数据流

```text
HTTP GET /experts?workflowId=...
  └─ CMP-http-gateway：解析、去重、UUID 校验
       └─ CMP-catalog.listExperts(ExpertListQuery)
            ├─ WorkflowRead.listExpertIdsByWorkflows(workflowIds)   // workflow_expert_ref，distinct
            └─ ExpertRead.list(ExpertQuery + ids)                  // expert 表按 ID 集过滤并分页
```

### 3.1 `CMP-workflow`

- 新增只读方法：`listExpertIdsByWorkflows(workflowIds: string[]): Promise<string[]>`。
- 数据源：`workflow_expert_ref`，`select distinct expert_id ... where workflow_id = any($1::uuid[])`。
- 不解析 `workflow_definition.graph`，避免与引用投影口径分叉；`workflow_expert_ref` 本来就是可重建投影。
- 不新增写入口、不改 schema；空入参直接返回 `[]`。

### 3.2 `CMP-expert`

- `ExpertQuery` 增加内部过滤字段 `ids?: string[]`，语义为「只在这些专家 ID 内查询」；空数组返回空页。
- store 在 SQL 层追加 `e.id = any($n::uuid[])`，分页与 `total` 由数据库按过滤后集合计算，不在内存截断。
- 组件仍不感知「工作流」概念，也不读工作流表；`ids` 只是通用候选集。

### 3.3 `CMP-catalog`

- 新类型 `ExpertListQuery = Omit<ExpertQuery, "ids"> & { workflowIds?: string[] }`；`CatalogRead.listExperts` 接收它。
- 有 `workflowIds` 时先取专家 ID 集，再调用 `ExpertRead.list`；ID 集为空时直接返回空分页信封，不再查专家表。
- 现有 `countByExperts`、Skill 预览组合、`refCount` 逻辑不变。
- 这是 L2 读组合，跨资产翻译留在 catalog，不下沉到 expert，也不在 HTTP 路由里拼装。

### 3.4 `CMP-http-gateway`

- `parseExpertListQuery` 用 `searchParams.getAll("workflowId")`，逐个 `assertUuid`，去重后传入 catalog。
- OpenAPI 增加 `workflowId` 数组查询参数（`style: form`、`explode: true`），operation 数量与 ID 不变。
- 网关规格 §5.4 的查询参数表与说明同步更新。

## 4 兼容与回滚

- 只做加法：旧调用方不传 `workflowId`，SQL 与响应与现状一致。
- 无迁移、无新表、无新端点；回滚只需移除参数解析、catalog 分支、workflow 读方法和对应文档/测试。
- `workflow_expert_ref` 是现有唯一绑定来源；本次不改变它的重建时机，因此不需要回填。

## 5 测试计划

| 层 | 用例 |
|---|---|
| `CMP-workflow` | `listExpertIdsByWorkflows` 返回去重专家 ID；空入参返回空数组；未知工作流返回空数组 |
| `CMP-catalog` | 单流程/多流程并集/未绑定专家只在全量/空集分页信封；`q`、`enabled` 叠加 |
| `CMP-http-gateway` | `workflowId` 单值、重复值、多个值；非法 UUID 400 且 `details.field`；未知工作流空列表；不传时全量不回归 |
| OpenAPI | `listExperts` 含 `workflowId` 数组参数，operation 数与 API 计数不变 |
| 场景 | `SCN-0001` 的 `R2` 断言扩展为「列表预览 + 按流程过滤」 |

## 6 风险与待定

- 读放大：每次带过滤的列表多一条 `workflow_expert_ref` 查询；当前规模可接受，沿用 `OQ-7` 的批量优化待定，不提前加缓存。
- `ids` 集规模：当前为单工作流/少量工作流，专家数量小；若未来单次筛选命中上千专家，再评估改为 join 或临时表。
- 工作流不存在时返回空列表而不是 404：这是列表过滤语义，非资源定位；前端下拉只列已有流程，不依赖 404 提示。

## 7 确认记录

- 2026-11-21：用户选择「扩展 `GET /experts` 加 `workflowId` 过滤」「只返回专家列表、复用现有卡片 DTO」「支持多个 `workflowId` 取并集，未绑定专家只在全部显示」。
- 2026-11-21：按 P2 处理；实现完成后走人工最终确认与合并门，见 `review.md`/`result.md`。
