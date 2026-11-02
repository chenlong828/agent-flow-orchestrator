---
layer: history
module: workflow
status: frozen
updated: 2026-11-02
---

# 评审与裁决：工作流契约边界收敛

## 评审范围

- `CMP-workflow`：图解析、拓扑/绑定校验、创建/保存/复制/校验/导入/导出、类型契约。
- `CMP-http-gateway`：创建/复制响应、字段白名单、OpenAPI、排序契约。
- `CMP-kernel`：`MultiFieldValidationError` 增加 `details.issues`，保留 `fieldErrors`。
- 文档：workflow/http-gateway 组件规格、SCN-0101/0102/0103、DSL schema 说明。
- 测试：图/服务工作流测试、HTTP 工作流测试、场景测试、OpenAPI 测试。

## 四档裁决

| 档位 | 数量 | 结论 |
|---|---:|---|
| blocker | 0 | 无阻断合入问题 |
| decision | 3 | 已落文档与 pinning test |
| hold | 0 | 无暂缓项 |

### decision 1：`layout` / `viewport` 归前端

- 决策：后端只要求 JSON 对象，不解释 `x/y/width/height/zoom`；REST OpenAPI 只声明透明对象，详细结构留在 `dsl.schema.json`。
- 落点：[决策记录](../../../history/decisions/2026-10-30-workflow-contract-boundary.md)、[workflow 规格](../../../design/components/workflow/spec.md)、[HTTP 规格](../../../design/components/http-gateway/spec.md)。
- pinning test：`graph.test.ts` 透明布局/视口用例；`workflow.test.ts` 保存/回读/DSL/复制；`openapi.test.ts` 透明 schema 断言。

### decision 2：拓扑与绑定错误阻断写入

- 决策：创建/保存/复制/导入遇到结构、引用、拓扑、必填/禁止绑定时 400；只有停用专家 warning。
- 落点：workflow 规格第 5 节、SCN-0102 运行序与失败路径。
- pinning test：`service.test.ts` 拓扑阻断、缺失专家回滚、停用警告；`workflow-scenarios.test.ts` TC-WFE-002/003/004。

### decision 3：导入允许空专家绑定

- 决策：导入允许 `expertId` 为空；缺失专家清空为 null 并 warning；禁止绑定仍 400；导入后保存必须补齐专家。
- 落点：workflow 规格第 5 节、SCN-0103 运行序。
- pinning test：`service.test.ts` 导入缺失专家清空后保存 400、再次绑定成功；`workflow-scenarios.test.ts` TC-WFX-003。

## 验收证据

| 检查 | 结果 |
|---|---|
| `tsc --noEmit` | 通过，无输出 |
| 全量测试 | 273 pass / 0 fail / 2493 assertions |
| 场景索引检查 | `4 个场景`，索引最新 |
| OpenAPI 结构 | 31 paths / 48 operations / 75 schemas / 467 refs，所有 `$ref` 可解析 |
| `git diff --check` | 无空白错误 |
| `:3100` 冒烟 | 创建、空图 400、保存透明视口、DSL、复制、排序、导入缺失专家 warning、未绑定保存 400 全部通过，测试数据已清理 |

## 保留事项

- 旧空图/非法图不迁移、不自动修复；只保证可读、写入/复制/导出被拒绝。属于已确认范围，不是 blocker。
- `POST /workflows` 改为必须提交 graph，是破坏性契约变更；已写入决策记录，UI 需在发布前同步。不是本仓库可单方验证的项，但不是 blocker。
- `layout` 顶层仍只承载 `viewport`；节点/阶段 `layout` 内部字段完全透明。属于当前 DSL 形状，不在本轮扩展。
