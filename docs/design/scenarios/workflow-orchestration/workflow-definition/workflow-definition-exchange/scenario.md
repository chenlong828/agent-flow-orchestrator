---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-10-29
flow: FLOW-WF-EXCHANGE-001
scenario: SCN-0103
domain: 工作流编排
valueStream: 工作流定义
title: 工作流定义交换
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
    id: TC-WFX-001
  - role: R2
    id: TC-WFX-002
  - role: R3
    id: TC-WFX-003
  - role: N1
    id: TC-WFX-004
externalRefs:
  - path: src/components/http-gateway/openapi.yaml
    anchor: exportWorkflowDsl
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: importWorkflow
    kind: openapi-operation
---

# 工作流定义交换

## 1 场景与价值

编排者或外部工具把当前工作流定义导出为 DSL，供评审、备份或迁移；再把 DSL 导入为新工作流。结果：当前定义被导出或导入，结构、角色、阶段、布局可追溯。

DSL 只含结构、展示和布局，不含运行产物；也不含工作流版本。导入后直接得到当前定义，后续在 `SCN-0102` 校验，不经过发布。

B3 已实现 JSON 导出、YAML 导出和 JSON 导入，入口和测试以本文件 frontmatter 为准。

## 2 入口

入口与文档锚点以本文件 frontmatter 的 `entries`、`docs`、`externalRefs` 为准，索引由这些字段生成，不在正文重复路径。

- HTTP 入口：`CMP-http-gateway` 的 `createHttpApp`。
- 领域入口：`CMP-workflow` 的 `createWorkflowService`。
- 读模型入口：`CMP-catalog` 的 `createCatalog`，导入成功后回读详情。

## 3 运行序

流程定义：`FLOW-WF-EXCHANGE-001`。

1. 导出：导出当前定义；JSON 为权威格式，YAML 为无损渲染；包含元数据、阶段、节点、边和节点/阶段布局；不包含工作流内部 ID、revision、时间戳或工作流版本。
2. 外部评审或编辑：在系统外完成；YAML 注释不保证往返。
3. 导入（v1 只接受 JSON）：校验 `dslVersion`、未知字段、图规则、专家矩阵和阶段引用；总是新建工作流；节点/阶段/边 ID 原样保留，`idMap` 为恒等映射；缺失专家清空绑定并给警告。
4. 校验当前定义：走 `SCN-0102`，只保存和校验，不发布。
5. 结束：返回导出文件或导入结果与 ID 映射。

失败路径：

- 未知字段或不支持的 `dslVersion`：`400`。
- 坏边、单主链破坏、confirm 绑专家、fanout/fanin 不配对：`400`。
- 专家不存在：导入允许并给警告；B4 运行前严格拦截。
- 名称冲突：`409 name_conflict`；导入不覆盖已有工作流。
- 不支持的 YAML 导入：`400`，v1 只接受 JSON。

## 4 不可变引用

外部客户端把后端 REST API 视为不可变契约。本场景通过 `externalRefs` 指向 OpenAPI operation：

- `exportWorkflowDsl`
- `importWorkflow`

DSL 字段以工作流组件规格为准；引用只记录路径和 operationId，不复制字段。

## 5 测试映射

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-WFX-001` | JSON 导出含元数据、阶段、节点、边；不含 id/revision/时间戳 |
| R2 | `TC-WFX-002` | YAML 与 JSON 结构等价，数组顺序保持 |
| R3 | `TC-WFX-003` | 导入总是新建；idMap 恒等；缺失专家清空并 warning |
| N1 | `TC-WFX-004` | 未知字段与语义错误均 400，且不落库 |

## 6 覆盖边界

- 不覆盖图编辑和校验；由 `SCN-0102` 承接。
- 不覆盖运行；导入后的工作流进入 B4。
- 不覆盖工作流版本、发布、版本列表；这些当前不做。
- v1 不支持 YAML 导入；YAML 只用于导出评审。
