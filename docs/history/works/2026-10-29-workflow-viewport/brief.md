---
layer: history
module: workflow
status: frozen
updated: 2026-11-02
---

# 工序：工作流视口持久化

## 目标

让编辑器保存的当前定义同时保存画布视口（x/y/zoom），重新打开工作流时由详情接口恢复；视口属于工作流展示结构，不参与执行语义。

## 非目标

- 不新增视口专用端点、表或列；复用 `workflow_definition.graph` JSONB。
- 不做每个用户独立视口；当前无登录态，视口按工作流全局保存。
- 不做平移/缩放自动保存；沿用现有“保存”按钮，随整图 `PUT` 提交。
- 不保存选中节点、当前 Tab、DSL 格式等瞬时编辑器状态。
- 不修改 `agent-flow-ui`。

## 范围与定级

- 改动级别：P2。兼容性契约新增；无数据库迁移、无新组件、无数据所有权变化。
- 人工确认：用户于 2026-10-29 接受“视口随工作流定义同一 JSON 保存”的方案。
- 影响场景：`SCN-0102` 工作流编辑与校验。

## 契约决定

- `WorkflowGraph` 增加可选 `viewport: {x,y,zoom}`；`x/y` 是画布容器的滚动偏移，`zoom` 是缩放倍数。
- `PUT /api/v1/workflows/{id}/definition` 以整图替换语义保存；省略 `viewport` 即清空。
- `GET /api/v1/workflows/{id}` 通过 `graph.viewport` 返回。
- DSL 的 `layout.viewport` 与 `graph.viewport` 双向映射；导入/导出不再丢弃视口。
- `viewport` 仅展示，不参与图语义校验；形状错误返回 `400`。

## 任务表

| ID | 类型 | 组件 | 状态 | 装载清单 |
|---|---|---|---|---|
| T-WF-110 | change | `CMP-workflow` | done | `src/components/workflow/graph.ts`、`types.ts`、`service.ts`、`index.ts`、`src/components/http-gateway/openapi.yaml`、`tests/components/workflow`、`tests/components/http-gateway/workflow*.test.ts`、`docs/design/components/workflow/spec.md`、`docs/design/components/http-gateway/spec.md`、`SCN-0102` |

## 验收标准

1. 保存带 `viewport` 的有效图后，详情回读的 `graph.viewport` 与保存值一致，`revision` 正常递增。
2. DSL 导出包含 `layout.viewport`，导入后落库；复制工作流保留视口。
3. 非法视口（未知字段、缺字段、非有限数字、`zoom <= 0`）返回 400，且不保存。
4. 既有工作流图校验、保存、复制、DSL 测试与全量类型检查不回归。
