---
layer: history
module: workflow
status: frozen
updated: 2026-11-02
---

# 工序：工作流契约边界收敛与严格保存

## 背景

前端审视工作流 API 后反馈 8 项问题；同时暴露出 `layout` / `viewport` 归谁所有、保存是否允许拓扑 warning、创建是否落空图等边界不清。经逐项确认，本轮把后端边界收敛为：结构、引用、拓扑、专家绑定归后端；画布布局归前端并原样透传。

## 已确认边界

| 决策 | 结论 |
|---|---|
| 后端职责 | 校验 JSON 结构、ID/边引用、拓扑、专家绑定；不解释 layout/viewport |
| 拓扑失败 | 创建/保存/复制/导入 400，不再只给 warning |
| 空图 | 保存/导入/导出/复制都拒绝 |
| 创建 | `POST /workflows` 必须同时提交合法 graph，不再先落空图 |
| 导入空专家 | 允许 `expertId` 为空；导入时清空不存在的专家并 warning；保存/创建必须绑定 |
| 布局契约 | REST 的 layout/viewport 为透明对象；详细结构留在 `dsl.schema.json` |
| 错误结构 | 多字段图校验 400 增加 `details.issues`，保留 `fieldErrors` |
| 路径 | 统一用数组下标；不引入 locator；改图后重新校验 |
| 原子保存 | 元数据 + 图仍两次写，不新增聚合端点 |
| 兼容 | 旧空图/非法图可读，但保存/复制/导出拒绝；不做数据迁移 |

## 非目标

- 不修改 `agent-flow-ui`；
- 不新增数据库表、列或迁移；
- 不新增原子保存端点、draft 状态、per-user 视口；
- 不清理既有非法工作流数据；
- 不把 layout/viewport 的详细结构塞回 REST OpenAPI。

## 任务表

| ID | 类型 | 组件 | 状态 | 说明 |
|---|---|---|---|---|
| T-WF-111 | change | `CMP-workflow` / `CMP-http-gateway` | done | 契约边界收敛、严格校验、创建带图、错误与 OpenAPI 同步 |
| T-WF-112 | test | `CMP-workflow` / `CMP-http-gateway` | done | 场景与契约测试同步，随 T-WF-111 完成 |

## 验收

- 创建/保存/复制/导入的空图、拓扑问题均 400，且不落库；
- 创建必须提交 graph；合法创建返回 revision 1 与 warnings；
- 导入缺失专家清空 + warning，导入后保存 400 直到绑定；
- layout/viewport 任意对象透传，不再按 x/y/zoom 校验；
- 多字段 400 同时有 `issues` 与 `fieldErrors`，路径全部数组下标；
- `WorkflowSort` 文档与运行时一致；列表/详情含 `updatedBy`；
- 全量测试、类型检查、场景索引、运行中冒烟通过。
