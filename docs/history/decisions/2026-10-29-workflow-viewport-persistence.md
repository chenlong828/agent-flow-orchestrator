---
layer: history
module: workflow
status: frozen
updated: 2026-10-29
---

# 2026-10-29 工作流视口随定义 JSONB 持久化

## 背景

UI 要求重新打开工作流时恢复画布缩放与滚动位置。此前 DSL 顶层已有 `layout.viewport={x,y,zoom}`，但定义保存只接受 `graph`，DSL 导入解析后被丢弃，导出也不返回；`WorkflowDetail` 没有视口。结果是视口只存在于编辑器内存，无法跨页面恢复。

本次确认视口属于工作流展示结构，不是运行状态，也不是每个用户的独立偏好。

## 决策

1. **视口放进 `WorkflowGraph.viewport`**：`{x,y,zoom}`，可选；与 `stages/nodes/edges` 一起存入现有 `workflow_definition.graph` JSONB。
2. **不新增表、列或端点**：复用 `PUT /api/v1/workflows/{id}/definition` 与 `GET /api/v1/workflows/{id}`；一次详情读取返回。
3. **整图替换语义**：保存时 `viewport` 随图提交；省略即清空；仍使用 `revision` + `If-Match`，保存成功 `revision` 递增。
4. **DSL 双向映射**：`WorkflowDsl.layout.viewport` ↔ `WorkflowGraph.viewport`；导入落库、导出带回。
5. **仅展示**：`x/y` 为画布滚动偏移（CSS 像素），`zoom` 为缩放倍数且大于 0；不参与图语义校验与执行。
6. **当前按工作流全局保存**：没有登录态，`X-Actor` 不是身份，因此不做每用户视口。
7. **复制保留视口**：复制复用整张 graph，节点/阶段/边 ID 与 `viewport` 一并保留。

## 被否决的方案

- **独立视口列或端点**：可以把视口写入从整图保存中拆开，支持每次滚动自动保存；但引入第二写入口、额外契约和迁移。当前 UI 是显式保存，收益不足。
- **只存浏览器 localStorage**：只恢复同一浏览器，不跨设备、不参与 DSL/复制；与“工作流展示结构”的定位不一致。
- **平移/缩放自动保存**：每次滚动都会递增定义 revision 并受 `If-Match` 约束，与节点编辑互相冲突；本次不做。若以后需要，另立轻量写入，不与整图保存混用。
- **把视口放进运行状态/behavior**：视口是编辑期展示状态，不是运行产物；放运行状态会破坏单定义边界。

## 后果

- 旧数据无 `viewport` 时字段省略，编辑器使用默认位置/缩放。
- 省略 `viewport` 的整图保存会清空视口；客户端保存前应保留已加载的视口。
- 视口变化会递增工作流 `revision`，与内容编辑共用同一并发锁。
- DSL 导入/导出不再丢弃视口；已有 DSL `layout` 结构不变。
- 每个用户独立视口、自动保存留作后续；当前无登录态时不做。

## 关联

- [工序 brief](../works/2026-10-29-workflow-viewport/brief.md)
- [影响规格](../works/2026-10-29-workflow-viewport/design.md)
- [单定义决策](2026-10-28-workflow-definition-single-definition.md)
- [只存 graph 决策](2026-10-29-workflow-definition-graph-only.md)
