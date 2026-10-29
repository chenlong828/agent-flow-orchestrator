---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-10-29
flow: FLOW-WF-AUTHORING-001
scenario: SCN-0102
domain: 工作流编排
valueStream: 工作流定义
title: 工作流编辑与校验
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
    heading: 5 领域不变量
  - path: docs/design/components/http-gateway/spec.md
    heading: 5.6 工作流
tests:
  - role: R1
    id: TC-WFE-001
  - role: R2
    id: TC-WFE-002
  - role: R3
    id: TC-WFE-003
  - role: N1
    id: TC-WFE-004
externalRefs:
  - path: src/components/http-gateway/openapi.yaml
    anchor: saveWorkflowDefinition
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: validateWorkflow
    kind: openapi-operation
---

# 工作流编辑与校验

## 1 场景与价值

编排者打开当前定义，编辑图与角色，保存并校验。结果：当前定义被保存，并返回结构/语义校验报告。

本场景不覆盖发布、工作流版本、节点行为配置和运行。当前没有工作流版本：保存的是唯一当前定义；结构错误阻断保存，语义问题只给警告。专家输出、fan-out 任务清单和评审回退指令属于 B4/workspace，不写定义。

B3 已实现图保存与校验，入口和测试以本文件 frontmatter 为准。

## 2 入口

入口与文档锚点以本文件 frontmatter 的 `entries`、`docs`、`externalRefs` 为准，索引由这些字段生成，不在正文重复路径。

- HTTP 入口：`CMP-http-gateway` 的 `createHttpApp`。
- 领域入口：`CMP-workflow` 的 `createWorkflowService`。
- 读模型入口：`CMP-catalog` 的 `createCatalog`，保存后回读详情。

## 3 运行序

流程定义：`FLOW-WF-AUTHORING-001`。

1. 打开当前定义：读取节点、边、阶段、布局和专家绑定。
2. 图编辑与角色装配：增删改节点、边、阶段、布局；绑定专家；confirm 不绑专家；保存时按 `revision`/`If-Match` 控制并发。
3. 保存与校验：保存只阻断形状错误；校验返回结构语义错误和警告。单主链、专家绑定、回退目标、fanout/fanin 配对等语义问题不阻断保存。
4. 结束：返回保存后的当前定义或校验报告。

失败路径：

- 形状错误（ID 重复、边端点不存在、类型/kind 非法、阶段引用不存在、专家 ID 格式非法）：`400`，保存被拒绝。
- 语义问题（缺开始/结束、单主链破坏、confirm 绑专家、回退目标不是祖先、fanout/fanin 不配对）：保存成功，返回警告。
- 保存时 `expertId` 在当前库不存在：`400`，整事务回滚；校验未保存草稿时只给警告。
- 专家停用：允许保存，校验给警告；B4 运行前严格拦截。
- 并发编辑：缺 `If-Match` 返回 `428`，旧 `revision` 返回 `409`。
- 没有发布/版本端点；重复保存按 `revision` 处理。

## 4 不可变引用

外部客户端把后端 REST API 视为不可变契约。本场景通过 `externalRefs` 指向 OpenAPI operation：

- `saveWorkflowDefinition`
- `validateWorkflow`

专家存在/启用状态经 `ExpertStatusReader` 只读端口查询，不在 HTTP 契约中新增字段。

## 5 测试映射

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-WFE-001` | 保存有效图返回 200、warning 为空、revision 递增；回读阶段/节点布局一致 |
| R2 | `TC-WFE-002` | 边端点缺失等形状错误返回 400，图与 revision 均未改变 |
| R3 | `TC-WFE-003` | 语义问题保存成功并返回 warning；validate 统一 200 报告 |
| N1 | `TC-WFE-004` | 保存缺失专家返回 400，整事务回滚 |

专家停用 warning 由服务测试覆盖，不占本场景 3+1；B4 运行前严格校验不在当前范围。缺失专家保存失败是 N1。

## 6 覆盖边界

- 不覆盖组合管理、DSL 交换和运行；组合管理在 `SCN-0101`，交换在 `SCN-0103`，运行在 B4。
- 不覆盖发布、工作流版本、版本列表和回滚；这些当前不做。
- 不覆盖节点行为配置；专家输出、fan-out 任务清单、评审回退发布指令归 B4/workspace。
- B4 运行前需要重新做结构、专家严格校验；本场景的保存校验不是运行门禁。
