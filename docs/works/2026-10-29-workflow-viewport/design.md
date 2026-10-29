---
layer: works
module: workflow
status: closed
updated: 2026-10-29
---

# 影响规格：工作流视口持久化

## 1 变更说明

当前 `workflow_definition.graph` 已保存节点/阶段布局，但顶层画布视口只存在于 DSL 的 `layout.viewport`，导入时被丢弃，导出也不返回。编辑器重新打开工作流时无法恢复缩放与滚动位置。

本次把视口作为 `WorkflowGraph` 的可选展示字段，与图结构一起存入现有 JSONB。一个工作流仍只有一份当前定义、一次详情读取。

## 2 契约 diff

```ts
type WorkflowViewport = {
  x: number;
  y: number;
  zoom: number;
};

type WorkflowGraph = {
  stages: Stage[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: WorkflowViewport;
};
```

- `x`、`y`：画布容器滚动偏移，单位 CSS 像素，可为负。
- `zoom`：画布缩放倍数，有限且大于 0。
- 未知字段、非对象：`400 validation_error`，错误码 `graph_shape`；缺字段、非有限数字、`zoom <= 0`：错误码 `invalid_layout`。
- `PUT /workflows/{id}/definition` 仍要求 `If-Match`；整图替换，省略 `viewport` 即无视口。
- `GET /workflows/{id}`、保存响应、复制/导入结果中的详情通过 `graph.viewport` 返回。
- DSL：`graph.viewport` ↔ `layout.viewport`；DSL 顶层 `layout` 的其他字段不进入 graph。
- `WorkflowSummary`、列表接口、执行语义不变。

## 3 数据与迁移

- 存储：继续使用 `workflow_definition.graph` JSONB；现有 check 只约束 `stages/nodes/edges` 为数组，不拒绝额外键。
- 迁移：无。
- 回滚：去掉 `viewport` 校验/映射即可；已写入的 JSONB 字段由旧代码读取时为额外数据，保存时需先移除。回滚前应确认没有依赖该字段的客户端。

## 4 影响面

| 位置 | 变化 |
|---|---|
| `src/components/workflow/graph.ts` | 新类型、解析与校验、DSL 映射所需导出 |
| `src/components/workflow/types.ts` / `index.ts` | 导出 `WorkflowViewport` |
| `src/components/workflow/service.ts` | DSL 导入/导出映射；详情原样返回 graph |
| `src/components/http-gateway/openapi.yaml` | `WorkflowGraph.viewport` 复用现有 `WorkflowLayoutViewport` |
| 测试 | 图校验、服务保存/回读、DSL 往返、复制、HTTP 400 |
| 文档 | 组件规格、网关规格、SCN-0102、决策记录 |

不改 `src/components/http-gateway/app.ts`：现有定义路由已经把 `body.graph` 原样交给服务。

## 5 测试计划

| 验收 | 测试 |
|---|---|
| 保存/回读视口 | `tests/components/workflow/service.test.ts`、HTTP `TC-WFE-001` |
| 非法视口 400 且不保存 | `tests/components/workflow/graph.test.ts`、HTTP `TC-WFE-002` |
| DSL 往返与复制 | `tests/components/workflow/service.test.ts`、HTTP 工作流测试 |
| OpenAPI 契约 | `tests/components/http-gateway/openapi.test.ts` |
| 全量回归 | `bun test`、`tsc --noEmit`、`docs:check` |
