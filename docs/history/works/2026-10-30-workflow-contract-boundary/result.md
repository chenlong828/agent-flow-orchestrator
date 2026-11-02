---
layer: history
module: workflow
status: frozen
updated: 2026-11-02
---

# 结果：工作流契约边界收敛

## 结论

T-WF-111 已完成。后端边界收敛为“结构、引用、拓扑、专家绑定归后端；`layout` / `viewport` 归前端并透明持久化”；创建必须同时提交合法图，拓扑/绑定错误阻断写入，导入允许空专家绑定但保存前必须补齐。评审裁决：blocker 0 / decision 3（已落测试）/ hold 0。

## 验收结果

| 验收项 | 结果 |
|---|---|
| 创建必须提交合法图；空图、拓扑、缺失专家 400 | 通过 |
| 保存/复制/导出拒绝空图、拓扑或绑定错误；停用专家 warning | 通过 |
| 导入允许空专家；缺失专家清空 + warning；导入后保存 400 | 通过 |
| `layout` / `viewport` 任意对象透传；`zoom=0` 不再拒绝 | 通过 |
| 多字段 400 同时有 `details.issues` 与 `details.fieldErrors`；路径为数组下标 | 通过 |
| `WorkflowSort` 使用冒号语法，`-updatedAt` 400 | 通过 |
| `WorkflowSummary` / `WorkflowDetail` 含 nullable `updatedBy` | 通过 |
| 类型检查、全量测试、场景索引、OpenAPI、冒烟 | 通过 |

验证命令与结果：

- `./node_modules/.bin/tsc --noEmit`：通过；
- `/tmp/bun-test.kZVlXF/bun-darwin-aarch64/bun test`：273 pass / 0 fail / 2493 assertions；
- `bun run scripts/scenario-index.ts --check`（用同一 Bun 二进制）：索引最新；
- `git diff --check`：无输出；
- `http://127.0.0.1:3100`：`/healthz` 正常，`/openapi.yaml` 已加载新排序/透明布局/创建响应；端到端冒烟通过并清理测试数据。

## 结论落点

| 内容 | 落点 |
|---|---|
| 边界、操作矩阵、测试计划 | [design.md](design.md) |
| 四档评审 | [review.md](review.md) |
| 冻结决策 | [2026-10-30-workflow-contract-boundary.md](../../../history/decisions/2026-10-30-workflow-contract-boundary.md) |
| 工作流组件现行契约 | [workflow/spec.md](../../../design/components/workflow/spec.md) |
| HTTP 现行契约 | [http-gateway/spec.md](../../../design/components/http-gateway/spec.md) |
| 场景运行序与测试 | [SCN-0101](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-portfolio-management/scenario.md)、[SCN-0102](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-editing-and-publishing/scenario.md)、[SCN-0103](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-definition-exchange/scenario.md) |
| DSL 详细布局结构 | [dsl.schema.json](../../../../src/components/workflow/dsl.schema.json) |

## 变更清单

- `src/components/workflow/graph.ts`：移除布局字段校验；拆分拓扑/绑定；路径下标；`issues` 错误。
- `src/components/workflow/service.ts`：创建带图；严格写入；导入/导出例外；`updatedBy` 映射。
- `src/components/workflow/types.ts`、`index.ts`：类型与导出同步。
- `src/core/kernel/errors.ts`：`MultiFieldValidationError` 兼容扩展。
- `src/components/http-gateway/*`：创建/复制响应、字段白名单、OpenAPI。
- `tests/*`：图、服务、HTTP、场景、OpenAPI 契约测试。
- `docs/*`：工序文档、决策、组件规格、场景。

## 未决/后续

- 旧空图/非法图不迁移；保存/复制/导出会拒绝，读取保持可用。
- UI 发布前需适配创建必须提交 graph、创建/复制返回 `{id,revision,warnings}`。
- 未新增原子保存端点；元数据与图仍两次写，UI 需处理部分成功与 revision。
