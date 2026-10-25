---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# 结果：专家聚合写契约

## 结论

专家聚合写语义已回到 `CMP-expert`，BFF 不再需要编排“主体更新 + 两次装配”的多步事务：

- `POST /api/v1/experts` 接受可选的有序 `skillIds` / `toolIds`，创建根、五区子表与装配在同一事务完成，初始 `revision=1`。
- 新增 `PATCH /api/v1/experts/{id}`（`API-30`），可同时提交五区、人设、引用与两类装配；省略字段不变，数组字段传入即整体替换，空数组清空，一次事务只递增一次 `revision`。
- 保留 `PUT /experts/{id}`、`PUT /experts/{id}/skills`、`PUT /experts/{id}/tools`，既有调用方不受影响；`PUT /experts/{id}` 仍不覆盖已有装配。
- 装配目标存在性仍由数据库外键保证，store 把外键失败翻译为 `skillIds` / `toolIds` 字段错误；`CMP-expert` 不跨组件调用 Skill/工具服务。
- 未新增表、迁移、组件或数据所有权变化。

## 交付物

| 落点 | 内容 |
|---|---|
| [`src/components/expert/types.ts`](../../../src/components/expert/types.ts) | `UpdateExpertAggregate`、创建可选装配字段 |
| [`src/components/expert/service.ts`](../../../src/components/expert/service.ts) | `create` 同事务装配、`updateAggregate`、共用 `replaceSkills` / `replaceTools`、字段级外键错误 |
| [`src/components/expert/index.ts`](../../../src/components/expert/index.ts) | 导出聚合更新类型 |
| [`src/components/http-gateway/app.ts`](../../../src/components/http-gateway/app.ts) | POST 扩展、`PATCH /experts/{id}`、UUID 数组校验、`If-Match` |
| [`src/components/http-gateway/openapi.yaml`](../../../src/components/http-gateway/openapi.yaml) | `API-30`、`ExpertAggregatePatch`、创建装配字段与说明 |
| [`docs/design/components/expert/spec.md`](../../design/components/expert/spec.md) | 聚合写契约、领域类型、方法表、验证口径 |
| [`docs/design/components/http-gateway/spec.md`](../../design/components/http-gateway/spec.md) | 30 个业务端点、`API-30`、专家请求字段、编排表 |
| [`docs/design/architecture.md`](../../design/architecture.md) | 端点数 29 → 30，专家 8 → 9 |
| [`README.md`](../../../README.md) | 端点数与测试数 |
| [`docs/plan/roadmap.md`](../../plan/roadmap.md) | 工序收口记录 |
| [`tests/components/expert/service.test.ts`](../../../tests/components/expert/service.test.ts) | 创建装配、聚合更新、回滚、空 patch、旧 revision |
| [`tests/components/http-gateway/expert.test.ts`](../../../tests/components/http-gateway/expert.test.ts) | POST 装配、PATCH 正反例 |
| [`tests/components/http-gateway/openapi.test.ts`](../../../tests/components/http-gateway/openapi.test.ts) | 31 operations / 49 schemas / 300 `$ref` 结构断言 |

## 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `./.local/bun/bun run typecheck` | 通过 |
| 全量测试 | `./.local/bun/bun test --max-concurrency=1` | 197 pass / 0 fail / 1933 expect |
| OpenAPI | `./.local/bun/bun test tests/components/http-gateway/openapi.test.ts` | 6 pass；31 operations、49 schemas、300 个可解析 `$ref` |
| 真实 API 冒烟 | 启动 `PORT=3100 bun run src/main.ts`，创建 Harness/Skill/工具/专家 → 聚合 PATCH → 清理 | `PATCH` 返回 `revision=2`，`skills=[]`、`tools=[]`，主体字段更新成功 |

冒烟覆盖的聚合语义：

- 创建时 `skillIds` / `toolIds` 与根同事务写入，`skillCount=1`、`toolCount=1`。
- `PATCH` 只提交 `duty` 与两个空数组时，主体更新、装配清空，`revision` 从 1 到 2。
- 删除顺序与引用保护一致：先删专家，再删工具/Skill/Harness。

## 边界与后续

- `refCount` 仍为 B1 固定 0；没有工作流节点引用。
- 聚合 PATCH 不接收 `enabled`，启停仍走 `PATCH /experts/{id}/enabled`，避免把状态语义混进聚合写。
- 列表读模型不在本工序范围；专家列表的 Skill 预览由 `2026-10-25-list-read-model` 单独收口。
