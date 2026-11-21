---
layer: works
module: expert
status: closed
updated: 2026-11-21
procedure: 2026-11-21-expert-workflow-filter
level: P2
---

# 评审：专家列表按工作流筛选（P2）

## 1 结论

**通过**。blocker 0 / decision 2（已落实现与测试）/ verified sound 3 / hold 1（已转待定，不阻塞）。

## 2 裁决

### Decision now

| # | 决策 | 证据与落点 |
|---|---|---|
| D-1 | 格式合法但不存在的工作流返回空列表，不返回 404 | 列表过滤不是资源定位；`GET /experts?workflowId=<unknown>` 实测 `{items:[],total:0,limit:50,offset:0}`；HTTP 测试 `expert.test.ts` 覆盖 |
| D-2 | 流程到专家的翻译留在 `CMP-catalog`，`CMP-expert` 只接收候选 ID 集 | 保持「专家不读工作流表」的数据边界；`catalog/expert.ts` 先取 `WorkflowRead.listExpertIdsByWorkflows`，再调 `ExpertRead.list({ids})`；架构测试通过 |

### Verified sound

| 区域 | 查了什么 / 怎么查 | 结果 |
|---|---|---|
| 契约兼容性 | 不传 `workflowId` 时 `parseExpertListQuery`、catalog、SQL 的路径 | 与现状一致；原有专家 HTTP 用例与全量测试通过 |
| 并集与去重 | 多个 `workflowId`，含同一 ID 重复传入 | `catalog` 测试与 HTTP `TC-EXP-002` 覆盖；同一专家只出现一次 |
| 分页与组合筛选 | `workflowId` + `q`/`enabled`/`sort`/`limit` | `total` 为过滤后数量；空集保留请求分页；HTTP 用例覆盖 |

### Hold

| # | 事项 | 为什么不阻塞 |
|---|---|---|
| H-1 | 按流程过滤多一次 `workflow_expert_ref` 读；若单次命中专家很多，可改 join/临时表 | 当前数据规模小；与 `OQ-7` 的 catalog 批量优化同一类问题，不在本次扩范围 |

## 3 未采纳方案

- 新增 `GET /workflows/{id}/experts`：用户已选扩展专家列表；新增端点会给前台增加第二个列表契约。
- 在专家列表项附带 `workflows` 让前端本地过滤：列表需多带全量引用信息，且与「按流程查询」的服务端过滤语义重复。
- `CMP-expert` 直接 join `workflow_expert_ref`：违反数据所有权与架构测试，未采纳。
