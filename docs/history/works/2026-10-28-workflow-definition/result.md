---
layer: history
module: workflow
status: frozen
updated: 2026-10-29
---

# 工作流定义基础数据（B3）实现结果

## 1 交付范围

P1 第二轮评审通过并冻结后，按 [brief.md](brief.md) 执行 B3 工作流定义；不包含 B4 实例/运行、UI、工作流版本/发布/快照。

| 交付物 | 位置 |
|---|---|
| 数据库修改脚本 | [`db/migrations/0005_workflow.sql`](../../../../db/migrations/0005_workflow.sql) |
| 工作流组件 | [`src/components/workflow/`](../../../../src/components/workflow/) |
| DSL JSON Schema 资产 | [`src/components/workflow/dsl.schema.json`](../../../../src/components/workflow/dsl.schema.json) |
| 四个工作流端点 + 六个子资源/导入端点 | [`src/components/http-gateway/app.ts`](../../../../src/components/http-gateway/app.ts) |
| 运行时 OpenAPI | [`src/components/http-gateway/openapi.yaml`](../../../../src/components/http-gateway/openapi.yaml) |
| 工作流组件规格 | [`docs/design/components/workflow/spec.md`](../../../design/components/workflow/spec.md) |
| 实现验证 | 本文件 |

## 2 实现口径

- 三张表：`workflow`、`workflow_definition`、`workflow_expert_ref`；`graph` 为 JSONB，不建版本、发布、behavior、实例表。
- 节点/阶段/边 ID 是工作流内稳定字符串；工作流根 ID 为 UUIDv7。
- 保存定义：形状错误 400 且不写；语义问题 200 + warnings；专家不存在 400 并整事务回滚；停用专家保留绑定并 warning。
- 导入：总是新建；形状/语义从严 400；缺失专家清空 `expertId` + warning；停用专家保留 + warning；名称冲突 409。
- 复制：只复制当前图，ID 原样保留；默认名 `{源名称} 副本`，冲突自动追加 ` (2)`…` (99)`。
- DSL：JSON 导入/导出；YAML 仅导出；节点/阶段 `layout` 只做展示；`dsl.schema.json` 提供机器可读结构，服务端运行时以 `graph.ts` 为校验源。
- 专家删除：`catalog` 的 `ReferenceGuard.check("expert")` 先查工作流引用，`workflow_expert_ref.expert_id` 的 `RESTRICT` 外键兜底并发窗口；FK 冲突按评审 D3 不重查 guard，返回空引用列表由客户端重读。

实现中新增了一个共享端口 `ExpertStatusReader`：工作流服务通过端口只读查询专家启停状态，用于 `expert_disabled` / `expert_missing` warning；由组合根注入 `ExpertRead`，工作流组件不导入专家组件、不直接读写 `expert` 表。`validate` 因此不再宣称“完全不读数据库”，而是“只读图与专家状态，不写数据库”。

## 3 验证结果

在 2026-10-29 执行：

```bash
bun test --max-concurrency=1
bun run typecheck
bun run docs:check
git diff --check
```

- 测试：246 pass / 0 fail（30 个测试文件，含 3 个场景 12 条旅程测试与 DSL schema 测试）。
- `tsc --noEmit`：通过。
- `docs:check`：场景索引最新。
- `git diff --check`：通过。

新增工作流测试覆盖：

- 图形状/语义与错误码；
- CRUD、revision 冲突、复制后缀；
- 保存 refs 重建、缺失/停用专家；
- DSL JSON/YAML 导出、导入清空缺失专家、导入 409、DSL schema 资产；
- 三场景 3 正 1 反旅程：组合管理、编辑校验、定义交换；
- catalog 工作流读与专家 `refCount`；
- 专家删除引用保护（服务与 HTTP）；
- schema 表/列与迁移记录。

## 4 未做与待定

- 未做 B4 实例、运行锁、NodeRun、实例快照、运行产物；工作流删除的 `referenced` 保护也等 B4 再定。
- 未做 UI；`agent-flow-ui` 是独立项目。
- `dsl.schema.json` 是外部工具消费的结构资产；服务端运行时仍以 `graph.ts` 为校验源，独立 schema 校验器不在当前实现。
- 场景目录 `workflow-editing-and-publishing` 仍保留旧目录名；场景卡标题已是“编辑与校验”，改名待整理。
- 本工序已收口；归档位置见文末说明。

## 5 任务对照

| 任务 | 状态 | 落点 |
|---|---|---|
| `T-WF-101` | 完成 | `0005_workflow.sql`、`tests/db/schema.test.ts` |
| `T-WF-102` | 完成 | `graph.ts`、`store.ts`、`tests/components/workflow/graph.test.ts` |
| `T-WF-103` | 完成 | `service.ts` CRUD/复制、`service.test.ts` |
| `T-WF-104` | 完成 | 保存定义、专家引用投影、专家缺失回滚 |
| `T-WF-105` | 完成 | `dsl.schema.json`、DSL 导出/导入、`dsl-schema.test.ts` |
| `T-WF-106` | 完成 | `WorkflowRead`、catalog 组合、专家 `refCount` |
| `T-WF-107` | 完成 | 10 个 HTTP 端点、OpenAPI、3+1 HTTP 测试 |
| `T-WF-108` | 完成 | `ReferenceOwner`/`Reference` 扩展、专家删除 guard |
| `T-WF-109` | 完成 | 三场景 `verified`、12 条旅程测试、本结果归档 |

B4 实例、运行锁、NodeRun、实例快照、运行产物与 UI 均未实现，保持原边界。

归档位置：`docs/history/works/2026-10-28-workflow-definition/`；frontmatter 已改为 `layer: history`、`status: frozen`，只作历史证据，不作现行设计依据。
