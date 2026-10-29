---
layer: design
module: global
status: current
generated: true
updated: 2026-10-30
---

# 业务场景索引

> 生成物，不手改。修改场景后运行 `bun run docs:index`；校验运行 `bun run docs:check`。

共 4 个场景。

## 智能体能力资产

### 专家能力定义与装配

| 场景 | 状态 | 流程设计 | 代码入口 | 文档 | 测试 | 外部引用 |
|---|---|---|---|---|---|---|
| [SCN-0001 专家定义与装配管理](agent-capability-assets/expert-capability-definition-and-assembly/expert-definition-and-assembly-management/scenario.md) | designed | [scenario.md#3 运行序](agent-capability-assets/expert-capability-definition-and-assembly/expert-definition-and-assembly-management/scenario.md#3-运行序) | `CMP-http-gateway src/components/http-gateway/app.ts#createHttpApp`<br>`CMP-expert src/components/expert/service.ts#createExpertService`<br>`CMP-catalog src/components/catalog/index.ts#createCatalog` | [docs/design/components/expert/spec.md#3.2 方法契约](../components/expert/spec.md#32-方法契约)<br>[docs/design/components/http-gateway/spec.md#5.4 专家](../components/http-gateway/spec.md#54-专家)<br>[docs/design/components/catalog/spec.md#3.1 方法契约](../components/catalog/spec.md#31-方法契约) | `R1 TC-EXP-001` POST 可带有序装配，创建与装配一次返回<br>`R2 TC-EXP-002` GET 列表返回前 3 个 Skill 预览，按装配顺序<br>`R3 TC-EXP-003` PATCH 聚合更新只改提交字段并一次递增 revision；缺 If-Match 428、旧版本 409<br>`N1 TC-EXP-004` POST 装配目标不存在返回 400，专家根回滚 | `src/components/http-gateway/openapi.yaml#createExpert`<br>`src/components/http-gateway/openapi.yaml#listExperts`<br>`src/components/http-gateway/openapi.yaml#patchExpertAggregate` |

## 工作流编排

### 工作流定义

| 场景 | 状态 | 流程设计 | 代码入口 | 文档 | 测试 | 外部引用 |
|---|---|---|---|---|---|---|
| [SCN-0101 工作流组合管理](workflow-orchestration/workflow-definition/workflow-portfolio-management/scenario.md) | verified | [scenario.md#3 运行序](workflow-orchestration/workflow-definition/workflow-portfolio-management/scenario.md#3-运行序) | `CMP-http-gateway src/components/http-gateway/app.ts#createHttpApp`<br>`CMP-workflow src/components/workflow/service.ts#createWorkflowService`<br>`CMP-catalog src/components/catalog/index.ts#createCatalog` | [docs/design/components/workflow/spec.md#3 公共契约](../components/workflow/spec.md#3-公共契约)<br>[docs/design/components/http-gateway/spec.md#5.6 工作流](../components/http-gateway/spec.md#56-工作流) | `R1 TC-WFP-001` 列表筛选与详情返回当前定义和节点/阶段计数<br>`R2 TC-WFP-002` 复制只复制图，节点/阶段/边 ID 保留且源不变<br>`R3 TC-WFP-003` 更新元数据与删除按 revision 生效<br>`N1 TC-WFP-004` 重名创建与缺失 If-Match 被拒绝 | `src/components/http-gateway/openapi.yaml#listWorkflows`<br>`src/components/http-gateway/openapi.yaml#createWorkflow`<br>`src/components/http-gateway/openapi.yaml#copyWorkflow`<br>`src/components/http-gateway/openapi.yaml#updateWorkflow`<br>`src/components/http-gateway/openapi.yaml#deleteWorkflow` |
| [SCN-0102 工作流编辑与校验](workflow-orchestration/workflow-definition/workflow-editing-and-publishing/scenario.md) | verified | [scenario.md#3 运行序](workflow-orchestration/workflow-definition/workflow-editing-and-publishing/scenario.md#3-运行序) | `CMP-http-gateway src/components/http-gateway/app.ts#createHttpApp`<br>`CMP-workflow src/components/workflow/service.ts#createWorkflowService`<br>`CMP-catalog src/components/catalog/index.ts#createCatalog` | [docs/design/components/workflow/spec.md#5 领域不变量](../components/workflow/spec.md#5-领域不变量)<br>[docs/design/components/http-gateway/spec.md#5.6 工作流](../components/http-gateway/spec.md#56-工作流) | `R1 TC-WFE-001` 保存有效图递增 revision 并回读阶段/节点/边/布局/视口<br>`R2 TC-WFE-002` 形状错误（含非对象视口）返回 400 且不保存<br>`R3 TC-WFE-003` 拓扑问题阻断保存，validate 统一返回 errors<br>`N1 TC-WFE-004` 保存缺失专家返回 400 且整事务回滚 | `src/components/http-gateway/openapi.yaml#saveWorkflowDefinition`<br>`src/components/http-gateway/openapi.yaml#validateWorkflow` |
| [SCN-0103 工作流定义交换](workflow-orchestration/workflow-definition/workflow-definition-exchange/scenario.md) | verified | [scenario.md#3 运行序](workflow-orchestration/workflow-definition/workflow-definition-exchange/scenario.md#3-运行序) | `CMP-http-gateway src/components/http-gateway/app.ts#createHttpApp`<br>`CMP-workflow src/components/workflow/service.ts#createWorkflowService`<br>`CMP-catalog src/components/catalog/index.ts#createCatalog` | [docs/design/components/workflow/spec.md#3 公共契约](../components/workflow/spec.md#3-公共契约)<br>[docs/design/components/http-gateway/spec.md#5.6 工作流](../components/http-gateway/spec.md#56-工作流) | `R1 TC-WFX-001` 导出 JSON 含 DSL 结构且不含内部字段<br>`R2 TC-WFX-002` YAML 与 JSON 结构等价且保持数组顺序<br>`R3 TC-WFX-003` 导入总是新建，idMap 恒等，缺失专家清空并给 warning<br>`N1 TC-WFX-004` 导入未知字段与空图被拒绝且不落库 | `src/components/http-gateway/openapi.yaml#exportWorkflowDsl`<br>`src/components/http-gateway/openapi.yaml#importWorkflow` |
