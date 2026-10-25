---
layer: design
module: agent-capability-assets
status: designed
updated: 2026-10-25
flow: FLOW-EXP-ASSEMBLY-001
scenario: SCN-0001
domain: 智能体能力资产
valueStream: 专家能力定义与装配
title: 专家定义与装配管理
entries:
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-expert
    path: src/components/expert/service.ts
    symbol: createExpertService
  - component: CMP-catalog
    path: src/components/catalog/index.ts
    symbol: createCatalog
docs:
  - path: docs/design/components/expert/spec.md
    heading: 3.2 方法契约
  - path: docs/design/components/http-gateway/spec.md
    heading: 5.4 专家
  - path: docs/design/components/catalog/spec.md
    heading: 3.1 方法契约
tests:
  - role: R1
    id: TC-EXP-001
  - role: R2
    id: TC-EXP-002
  - role: R3
    id: TC-EXP-003
  - role: N1
    id: TC-EXP-004
externalRefs:
  - path: src/components/http-gateway/openapi.yaml
    anchor: createExpert
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: listExperts
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: patchExpertAggregate
    kind: openapi-operation
---

# 专家定义与装配管理

## 1 场景与价值

外部客户端在「智能体能力资产」中定义专家，并把 Skill、工具作为可复用能力装配到专家上。该场景支撑「专家能力定义与装配」价值流：专家能被创建、检索并一次保存装配，列表能直接支撑选择与导航。

本场景只覆盖当前 B1 已实现的子流程；删除、引用保护、完整 CRUD 尚未全部纳入本场景的 3 正 1 反，因此状态为 `designed`，不是 `verified`。

## 2 入口

入口与文档锚点以本文件 frontmatter 的 `entries`、`docs`、`externalRefs` 为准，索引由这些字段生成，不在正文重复路径。

- HTTP 入口：`CMP-http-gateway` 的 `createHttpApp`，承载 `/api/v1/experts` 相关端点。
- 领域入口：`CMP-expert` 的 `createExpertService`，负责专家聚合写。
- 读模型入口：`CMP-catalog` 的 `createCatalog`，负责列表预览与详情组合。

## 3 运行序

流程定义：`FLOW-EXP-ASSEMBLY-001`。

1. 客户端调用 `POST /api/v1/experts`，一次提交专家字段、`skillIds` 和 `toolIds`；服务端在同一事务创建专家与装配，返回 `201` 和初始 `revision=1`。
2. 客户端调用 `GET /api/v1/experts?q=...`；列表项直接返回按装配顺序的前 3 个 `{id,name}` Skill 预览，不要求逐条拉详情。
3. 客户端携带 `If-Match` 调用 `PATCH /api/v1/experts/{id}`，提交需要修改的字段和/或装配数组；服务端在同一事务更新，只递增一次 `revision`。
4. 流程结束时调用 `DELETE /api/v1/experts/{id}` 清理测试数据；删除不属于本试点 3 正 1 反的验收断言。

## 4 失败路径

- 创建时 `skillIds` 或 `toolIds` 指向不存在的目标：整批失败，专家根不留下；对应 `N1`。
- `PATCH` 缺少 `If-Match`：返回 `428`；旧 revision 返回 `409`。
- 列表或详情资源不存在：返回 `404`；这些错误路径不在本试点 3 正 1 反内，后续补测。

## 5 不可变引用

外部客户端把后端 REST API 视为不可变契约。本场景通过 `externalRefs` 指向实际 OpenAPI 文档的 operation：

- `createExpert`
- `listExperts`
- `patchExpertAggregate`

引用只记录路径和 operationId，不复制请求/响应字段；OpenAPI 的破坏性变更必须走契约决策，不能静默改。

## 6 测试映射

测试 ID 在测试标题中稳定存在，索引生成器会校验：

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-EXP-001` | 创建专家时带有序装配，创建与装配一次返回 |
| R2 | `TC-EXP-002` | 列表按装配顺序返回前 3 个 Skill 预览 |
| R3 | `TC-EXP-003` | 聚合 PATCH 只改提交字段并一次递增 `revision` |
| N1 | `TC-EXP-004` | 装配目标不存在时返回 400，专家根回滚 |

## 7 覆盖边界

- 当前场景覆盖创建、列表和聚合更新；删除、引用保护、启停等子流程尚未进入本场景的 3+1。
- CRUD 是运行序步骤，不拆成多个业务场景；后续只有在某个子流程形成独立流程定义和独立场景集合时，才评估升层。
- 索引中引用的是文档章节、代码导出符号、测试 ID 和 OpenAPI operationId，不使用行号。
