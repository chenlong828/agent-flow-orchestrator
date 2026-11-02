---
layer: history
module: workflow
status: frozen
updated: 2026-11-02
---

# 结果：工作流视口持久化

## 结论

T-WF-110 完成。画布视口作为 `WorkflowGraph.viewport` 随当前定义存入现有 `workflow_definition.graph` JSONB；详情回读、DSL 导入/导出和复制均保留视口。没有新增表、列或端点，没有数据库迁移。

## 交付

| 文件 | 变化 |
|---|---|
| [`src/components/workflow/graph.ts`](../../../../src/components/workflow/graph.ts) | 新增 `Viewport`；`WorkflowGraph.viewport`；`collectGraph` 校验 |
| [`src/components/workflow/service.ts`](../../../../src/components/workflow/service.ts) | DSL `layout.viewport` 双向映射 |
| [`src/components/workflow/types.ts`](../../../../src/components/workflow/types.ts)、[`index.ts`](../../../../src/components/workflow/index.ts) | 导出 `Viewport` |
| [`src/components/http-gateway/openapi.yaml`](../../../../src/components/http-gateway/openapi.yaml) | `WorkflowGraph.viewport` 复用 `WorkflowLayoutViewport` |
| [`tests/components/workflow/graph.test.ts`](../../../../tests/components/workflow/graph.test.ts) | 视口保留与非法值 |
| [`tests/components/workflow/service.test.ts`](../../../../tests/components/workflow/service.test.ts) | 保存/回读、DSL 往返、复制、导入非法视口 |
| [`tests/components/http-gateway/workflow.test.ts`](../../../../tests/components/http-gateway/workflow.test.ts) | HTTP 保存/回读、400、DSL 往返、复制 |
| [`tests/components/http-gateway/workflow-scenarios.test.ts`](../../../../tests/components/http-gateway/workflow-scenarios.test.ts) | `TC-WFE-001` 视口回读；`TC-WFE-002` 非法视口 400 |
| [`docs/design/components/workflow/spec.md`](../../../../docs/design/components/workflow/spec.md)、[`http-gateway/spec.md`](../../../../docs/design/components/http-gateway/spec.md) | 现行契约同步 |
| [`SCN-0102`](../../../../docs/design/scenarios/workflow-orchestration/workflow-definition/workflow-editing-and-publishing/scenario.md) | 运行序与测试映射同步 |
| [`2026-10-29-workflow-viewport-persistence.md`](../../../../docs/history/decisions/2026-10-29-workflow-viewport-persistence.md) | 决策记录 |

## 验收

2026-10-29 执行：

```bash
./node_modules/.bin/tsc --noEmit
bun test
bun run scripts/scenario-index.ts --check
git diff --check
```

- 类型检查：通过。
- 全量测试：249 pass / 0 fail，30 个测试文件，2403 个断言。
- 场景索引：4 个场景，最新。
- `git diff --check`：通过。
- 运行中冒烟（`:3100`）：创建 → 保存 `viewport={x:123,y:45,zoom:0.7}` → 详情回读一致 → DSL `layout.viewport` 一致 → 删除 204；`/openapi.yaml` 的 `WorkflowGraph.viewport` 指向 `WorkflowLayoutViewport`。

## 行为口径

- `graph.viewport={x,y,zoom}` 可选；`x/y` 是画布滚动偏移（CSS 像素），`zoom` 是缩放倍数且大于 0。
- `PUT /api/v1/workflows/{id}/definition` 整图替换，视口随图保存；省略即清空；仍使用 `revision`/`If-Match`。
- `GET /api/v1/workflows/{id}` 返回 `graph.viewport`。
- DSL 导出 `layout.viewport`，导入落库；复制保留。
- 非法视口：未知字段/非对象为 `graph_shape`，缺字段/非有限数字/`zoom <= 0` 为 `invalid_layout`；HTTP 统一 400。
- 视口变化递增 `revision`，与内容保存共用一把锁；未实现滚动自动保存与每用户视口。

## 遗留

- 若 UI 改为平移/缩放自动保存，应另立轻量写入，避免整图 `If-Match` 冲突；本次不做。
- 每用户视口需要登录/身份模型；当前无登录态，按工作流全局保存。
- 旧工作流没有 `viewport` 时字段省略，由 UI 使用默认视口。
