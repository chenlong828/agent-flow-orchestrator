---
layer: history
module: workflow
status: frozen
updated: 2026-11-02
---

# 评审与裁决

## 决论

**通过。** P2；用户已接受“视口随工作流定义同一 JSON 保存”的方案。

## Blocker

无。已核对：`workflow_definition.graph` 的 JSONB check 不拒绝额外键；现有定义路由不限制 graph 内部字段；详情读取不重新解析 graph，因此旧数据缺少 `viewport` 不会失败。

## Decision now

- **视口属于定义内容，而不是独立端点/列**。理由：当前 UI 是显式保存，整图保存已具备 `revision`/`If-Match`；独立写入只会为展示状态增加第二写入口。pinning test：`TC-WFE-001` 保存后回读视口；`TC-WFE-002` 非法视口不保存。
- **`x/y` 语义定为画布滚动偏移，`zoom` 为缩放倍数**。理由：与编辑器滚动容器直接对应，避免“视口坐标”歧义。pinning test 同上。
- **DSL `layout.viewport` 与 `graph.viewport` 双向映射，导入不再丢弃布局**。pinning test：服务 DSL 往返测试。

## Verified sound

- 图校验入口：`collectGraph` 是保存和 validate 共用的形状闸门；新增字段只在此处识别，不影响既有字段错误。
- 存储：`insertDefinition` / `replaceGraph` 都序列化整个 `WorkflowGraph`，无需新增 SQL。
- 复制：`copy` 复用源 `graph`，视口随图复制，符合“复制只复制图”的既有语义。
- 详情：`WorkflowRead.get` 返回 `definition.graph`，无需改查询。
- API 计数：不新增 path/operation，`x-api-count` 保持 47；新增一个 schema `$ref` 需同步 OpenAPI 测试。

## Hold

- 平移/缩放自动保存（不点保存也恢复）：超出本次；若要做，另加轻量写入并避开整图 `If-Match`。
- 每个用户独立视口：当前无登录态，需要先有身份模型。
- 选中节点、Tab、DSL 格式等瞬时状态：不持久化。

## 开放问题

无阻塞项。UI 接入时需按 `graph.viewport` 保存/读取，并在保存前保留已加载的视口字段。
