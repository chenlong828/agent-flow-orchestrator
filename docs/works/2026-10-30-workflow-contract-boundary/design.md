---
layer: works
module: workflow
status: closed
updated: 2026-10-30
---

# 设计：工作流契约边界收敛

## 1 职责边界

- 后端：结构、ID/引用、拓扑、专家绑定一致性。
- 前端：`layout` / `viewport` 的画布语义。
- REST 的 `layout` / `viewport` 只要求是 JSON 对象；字段不解释、原样存取。
- 详细 `x/y/width/height/zoom` 结构留在 `dsl.schema.json`，供 UI 生成画布类型。
- 删除 OpenAPI 的 `WorkflowLayout`、`WorkflowLayoutViewport` 组件。

## 2 校验分层

| 层 | 内容 | 失败 |
|---|---|---|
| 结构 | JSON 形状、必填、类型、ID 唯一、边端点存在 | 400 `graph_shape` / `invalid_layout` |
| 拓扑 | start/end、seq 链、可达、环、fanout/fanin、rollback | 400 `broken_chain` 等 |
| 专家绑定 | 必填/禁止、专家存在/启用 | 缺失或必填未绑定 400；停用 warning |
| 展示 | layout / viewport | 只要求对象，不校验字段 |

导入例外：`expertId` 可以为空；不存在的专家清空并 warning；禁止绑定（confirm 带专家）仍 400。导入后的图再次保存时按严格绑定校验。

## 3 操作语义

| 操作 | 结构/拓扑 | 专家绑定 |
|---|---|---|
| `POST /workflows` | 400 | 必填必须有专家；缺失 400；停用 warning |
| `PUT /workflows/{id}/definition` | 400 | 同上 |
| `POST /workflows/{id}/validate` | `errors` | 缺失/未绑定 `errors`；停用 `warnings` |
| `POST /workflows/{id}/copy` | 源图 400 | 源图缺失/未绑定 400；停用 warning |
| `POST /workflows/import` | 400 | 允许空绑定；缺失专家清空 + warning；非法绑定 400 |
| `GET /workflows/{id}/dsl` | 400 | 允许空绑定；缺失/非法绑定 400；停用允许 |

创建、复制响应增加 `warnings`；保存、导入已有 `warnings`。

## 4 错误契约

多字段图校验 400：

```json
{
  "error": {
    "code": "validation_error",
    "details": {
      "issues": [{"code": "...", "path": "...", "message": "..."}],
      "fieldErrors": [{"field": "...", "reason": "code: message"}]
    }
  }
}
```

- `issues` 为新结构化入口；`fieldErrors` 保留兼容。
- 路径统一数组下标：`graph.nodes[1].id`、`graph.edges[0].to`。
- 单字段 `ValidationError` 仍用 `details.field/reason`，本轮不扩大到全局错误 DTO。
- `ValidationReport` 结构不变；`expert_missing`、拓扑问题进 `errors`，`expert_disabled` 进 `warnings`。

## 5 创建契约

`POST /api/v1/workflows` 请求增加必填 `graph`；空图、结构/拓扑/绑定错误 400。成功返回 `{id, revision:1, warnings}`。数据库不加迁移；旧空图/非法图仍可读，但保存、复制、导出拒绝。

## 6 OpenAPI 与 DTO

- `WorkflowSort` 改为 `name:asc|desc`、`updatedAt:asc|desc`，默认 `updatedAt:desc`。
- `WorkflowStage` 增加 `description` 和透明 `layout`；`WorkflowNode` 增加透明 `layout`。
- `WorkflowGraph.viewport` 改为透明对象。
- `WorkflowSummary` / `WorkflowDetail` 增加 `updatedBy: string | null`。

## 7 测试计划

- 图解析：layout/viewport 任意对象透传；非对象 400；路径下标。
- 创建：无 graph/空图/拓扑/缺专家 400；合法 201；停用 warning。
- 保存/复制/导出：空图、拓扑、缺专家 400；停用 warning。
- 导入：空图/拓扑 400；缺失专家清空 + warning；导入后保存 400。
- 错误：`issues` 与 `fieldErrors` 同时存在；validate 用 errors/warnings。
- OpenAPI：排序 enum/default、透明 layout/viewport、stage.description、updatedBy。
- 场景：SCN-0101/0102/0103 的 3 正 1 反同步。

## 8 回滚

单 commit，无数据库迁移；revert 恢复旧创建契约和旧 warning 行为。创建契约破坏性变更，发布前需与 UI 同步。
