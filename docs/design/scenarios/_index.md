---
layer: design
module: global
status: current
generated: true
updated: 2026-10-25
---

# 业务场景索引

> 生成物，不手改。修改场景后运行 `bun run docs:index`；校验运行 `bun run docs:check`。

共 1 个场景。

## 智能体能力资产

### 专家能力定义与装配

| 场景 | 状态 | 流程设计 | 代码入口 | 文档 | 测试 | 外部引用 |
|---|---|---|---|---|---|---|
| [SCN-0001 专家定义与装配管理](agent-capability-assets/expert-capability-definition-and-assembly/expert-definition-and-assembly-management/scenario.md) | designed | [scenario.md#3 运行序](agent-capability-assets/expert-capability-definition-and-assembly/expert-definition-and-assembly-management/scenario.md#3-运行序) | `CMP-http-gateway src/components/http-gateway/app.ts#createHttpApp`<br>`CMP-expert src/components/expert/service.ts#createExpertService`<br>`CMP-catalog src/components/catalog/index.ts#createCatalog` | [docs/design/components/expert/spec.md#3.2 方法契约](../components/expert/spec.md#32-方法契约)<br>[docs/design/components/http-gateway/spec.md#5.4 专家](../components/http-gateway/spec.md#54-专家)<br>[docs/design/components/catalog/spec.md#3.1 方法契约](../components/catalog/spec.md#31-方法契约) | `R1 TC-EXP-001` POST 可带有序装配，创建与装配一次返回<br>`R2 TC-EXP-002` GET 列表返回前 3 个 Skill 预览，按装配顺序<br>`R3 TC-EXP-003` PATCH 聚合更新只改提交字段并一次递增 revision；缺 If-Match 428、旧版本 409<br>`N1 TC-EXP-004` POST 装配目标不存在返回 400，专家根回滚 | `src/components/http-gateway/openapi.yaml#createExpert`<br>`src/components/http-gateway/openapi.yaml#listExperts`<br>`src/components/http-gateway/openapi.yaml#patchExpertAggregate` |
