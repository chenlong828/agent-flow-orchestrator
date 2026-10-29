---
layer: history
module: workflow
status: frozen
updated: 2026-10-30
---

# 2026-10-30 工作流契约边界：结构/拓扑归后端，布局归前端

## 背景

工作流 API 审查发现：OpenAPI 与运行时排序不一致；stage/node layout 未进文档；错误结构两套；路径混用下标与节点 ID；拓扑 warning 与保存阻断不一致；导入/导出一致性不足。用户进一步明确：graph 内部的画布/布局属于前端 DSL，后端不应定义画布格式。

## 决策

1. **后端职责收敛为 B+**：校验 JSON 结构、ID/边引用、拓扑、专家绑定；`layout` / `viewport` 只做透明对象持久化，不校验字段。
2. **拓扑也阻断保存**：创建、保存、复制、导入遇到拓扑错误返回 400，不再以 warning 放行。
3. **空图拒绝**：创建必须同时提交合法 graph；保存/导入/导出/复制拒绝空图。
4. **导入是专家绑定例外**：允许 `expertId` 为空；不存在的专家清空并 warning；保存/创建仍要求必填专家。导入后的图再次保存时按严格绑定校验。
5. **REST 布局透明**：OpenAPI 只声明 `layout` / `viewport` 为对象；详细 x/y/width/height/zoom 结构留在 `dsl.schema.json`。
6. **错误结构兼容扩展**：多字段图校验 400 增加 `details.issues`，保留 `details.fieldErrors`；单字段错误不变。
7. **路径统一**：所有图校验路径用数组下标；不引入 locator；校验结果只对当前提交图有效。
8. **不做原子保存**：元数据与图仍两次写，不新增聚合端点。
9. **不做数据迁移**：旧空图/非法图可读，但保存、复制、导出拒绝，直到用户补成合法图。

## 被否决的方案

- 后端继续校验 `layout` / `viewport` 字段：与“布局归前端”冲突。
- 拓扑保持 warning：保存会产出无法执行的定义，与严格校验目标冲突。
- 保留空图占位：用户要求空图也拒绝，创建必须带合法 graph。
- 导入也拒绝缺失专家：用户明确导入默认空专家、保存再要求绑定。
- 新增原子保存端点：本轮保持两次写，避免扩大契约。
- 引入 locator：路径统一为下标即可；改图后重新校验。

## 后果

- `POST /workflows` 成为破坏性变更，UI 必须先准备合法 graph。
- 旧空图/非法图不能保存/复制/导出；读取不受影响。
- 导入可产生未绑定专家的定义；保存前必须补专家。
- `WorkflowLayout` / `WorkflowLayoutViewport` 从 REST OpenAPI 移除；DSL schema 保留。
- 拓扑 warning 改为 errors，SCN-0101/0102/0103 与测试需同步。

## 关联

- [工序 brief](../../works/2026-10-30-workflow-contract-boundary/brief.md)
- [2026-10-29 视口持久化决策](2026-10-29-workflow-viewport-persistence.md)
