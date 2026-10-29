---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-10-29
flow: FLOW-WF-PORTFOLIO-001
scenario: SCN-0101
domain: 工作流编排
valueStream: 工作流定义
title: 工作流组合管理
entries:
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-workflow
    path: src/components/workflow/service.ts
    symbol: createWorkflowService
  - component: CMP-catalog
    path: src/components/catalog/index.ts
    symbol: createCatalog
docs:
  - path: docs/design/components/workflow/spec.md
    heading: 3 公共契约
  - path: docs/design/components/http-gateway/spec.md
    heading: 5.6 工作流
tests:
  - role: R1
    id: TC-WFP-001
  - role: R2
    id: TC-WFP-002
  - role: R3
    id: TC-WFP-003
  - role: N1
    id: TC-WFP-004
externalRefs:
  - path: src/components/http-gateway/openapi.yaml
    anchor: listWorkflows
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: createWorkflow
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: copyWorkflow
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: updateWorkflow
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: deleteWorkflow
    kind: openapi-operation
---

# 工作流组合管理

## 1 场景与价值

编排者需要先找到、创建或整理工作流，才能进入编辑或运行。本场景覆盖工作流组合的读与生命周期动作：列表、检索、详情、新建、复制、改名、改类型、删除。它不覆盖图编辑、DSL 交换、版本/发布和运行。

结果：一个工作流记录被找到、创建、复制、更新或删除。

当前没有工作流版本：工作流只有一份当前定义；复制是普通作者操作，不是版本。B3 已实现组合管理，入口和测试以本文件 frontmatter 为准。

## 2 入口

入口与文档锚点以本文件 frontmatter 的 `entries`、`docs`、`externalRefs` 为准，索引由这些字段生成，不在正文重复路径。

- HTTP 入口：`CMP-http-gateway` 的 `createHttpApp`。
- 领域入口：`CMP-workflow` 的 `createWorkflowService`。
- 读模型入口：`CMP-catalog` 的 `createCatalog`，列表/详情经工作流读契约组合。

## 3 运行序

流程定义：`FLOW-WF-PORTFOLIO-001`。

1. 列表、检索、详情：按类型、名称过滤；详情返回当前定义、节点数和阶段数；不返回工作流版本、发布状态；B4 前不提供 `lastRun`。
2. 新建：从空白创建当前定义；名称、类型必填，描述可省略；初始 `revision=1`，图为空。
3. 复制：以现有工作流生成新工作流；复制图，节点/阶段/边 ID 保留；原工作流不变；默认名为 `{源名称} 副本`。
4. 改名、改类型、改描述：按 `revision`/`If-Match` 更新元数据；类型可改。
5. 删除：B3 没有实例引用时允许；B4 引入实例后，被引用工作流删除返回 `409`。
6. 结束：返回工作流记录或删除结果。

失败路径：

- 详情不存在：`404`。
- 类型非法或必填缺失：`400`。
- 名称大小写不敏感重复：`409 name_conflict`。
- `If-Match` 缺失：`428`；旧 `revision`：`409`。
- 复制名称冲突：自动追加 ` (2)`…` (99)`；仍冲突返回 `409`。
- 删除被实例引用：`409`，B4 后补。

## 4 不可变引用

外部客户端把后端 REST API 视为不可变契约。本场景通过 `externalRefs` 指向 OpenAPI operation：

- `listWorkflows`
- `createWorkflow`
- `copyWorkflow`
- `updateWorkflow`
- `deleteWorkflow`

引用只记录路径和 operationId，不复制请求/响应字段；OpenAPI 的破坏性变更必须走契约决策。

## 5 测试映射

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-WFP-001` | 列表按名称/类型过滤；详情返回当前图、节点/阶段计数，不返回版本/发布字段 |
| R2 | `TC-WFP-002` | 复制图，节点/阶段/边 ID 保留；源工作流 revision 不变 |
| R3 | `TC-WFP-003` | 改名/改类型按 revision 生效；删除后详情 404 |
| N1 | `TC-WFP-004` | 大小写不敏感重名 409；缺 `If-Match` 428 |

实例引用删除保护是 B4 扩展，不在当前 3+1 内。

## 6 覆盖边界

- 不覆盖图编辑、DSL 交换、版本/发布和运行；图编辑与校验在 `SCN-0102`，交换在 `SCN-0103`。
- 删除保护只在 B4 有实例后生效；B3 只验证无引用删除。
- 复制范围已定：只复制图，节点 ID 保留；名称冲突自动后缀，最多 99 次。
