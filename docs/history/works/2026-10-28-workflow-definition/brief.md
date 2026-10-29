---
layer: history
module: workflow
status: frozen
updated: 2026-10-29
---

# 工序：工作流定义基础数据（B3）

## 需求与背景

- 关联场景：
  - [SCN-0101 工作流组合管理](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-portfolio-management/scenario.md)
  - [SCN-0102 工作流编辑与校验](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-editing-and-publishing/scenario.md)
  - [SCN-0103 工作流定义交换](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-definition-exchange/scenario.md)
- 现状：B1 只覆盖 Harness / 工具 / Skill / 专家资产注册，没有工作流定义组件、表或端点；架构见 [architecture.md](../../../design/architecture.md)。
- 本轮目标：B3 工作流的领域对象、聚合关系、操作关系与存储方向已冻结；继续执行实现，交付三张表、`CMP-workflow`、10 个 HTTP 端点、OpenAPI 与契约测试。
- 版本/发布讨论结论：工作流版本对当前阶段过重；接受“不做按创建时定义复现”，运行锁与复制也可以后置。决策见 [单定义决策](../../../history/decisions/2026-10-28-workflow-definition-single-definition.md) 与 [只存 graph 决策](../../../history/decisions/2026-10-29-workflow-definition-graph-only.md)。

## 本轮已确认

| 决策 | 结论 |
|---|---|
| 范围 | 只做 B3 工作流定义；B4 实例/执行另立 |
| 定义模型 | 一个工作流只有一份当前定义；不做工作流版本 |
| 复现要求 | 不要求实例按创建时定义复现；重跑使用当前定义 |
| B4 控制 | 运行锁/复制可后置，甚至可以先不做；不做实例快照 |
| 图存储 | 只存 `graph`（JSONB）；不存 `behavior`，版本快照不做 |
| 专家引用 | 引用只针对当前定义；用规范化投影支持删除保护与引用计数 |
| 保存校验 | 只拦形状错误；语义问题给警告，不阻断保存 |
| 发布 | 完全取消；不保留 `publishedAt/by`，不提供发布/版本端点 |
| 复制 | 复制图，节点 ID 保留；名称冲突自动后缀 |
| 类型 | `type` 作为自由文本标签，不参与图校验 |
| DSL | `dslVersion` 是 DSL 格式版本，继续保留；不导出工作流版本 |

## 范围

本轮做（P1 已冻结）：

- 已完成领域对象、关系、不变量、操作与存储方向；
- 已产出架构规格、组件规格、契约与数据库修改设计；
- 已实现 `db/migrations/0005_workflow.sql`、`CMP-workflow`、`catalog`/`expert`/`kernel` 增量、10 个 HTTP 端点与 OpenAPI；
- 已补图形状/语义、CRUD/复制、DSL、引用保护、HTTP 与 schema 测试。

本轮不做：

- 不搬迁任何旧数据；本工序只新增三张表，不搬历史工作流。
- 不做工作流版本、发布快照、版本列表、回滚；
- 不做 B4 实例、NodeRun、运行锁、实例快照；
- 不做 UI；`agent-flow-ui` 不在本仓库范围。

## 验收标准

1. [domain-model.md](domain-model.md) 写清已确认部分、候选部分与未确认部分，不把候选写成冻结契约。
2. 场景卡与新结论一致；`SCN-0102` 已改为编辑与校验，发布/版本不进入当前范围。
3. P1 架构规格写清 `CMP-workflow` 的模块边界、数据所有权、契约、错误模式、冷热路径与验证计划。
4. P1 冻结前不写数据库修改与实现代码；冻结后按任务表执行。（已满足）
5. 文档改动通过 `docs:check`；实现阶段通过 `typecheck` 与测试。
6. 实现交付三张表、10 个端点、OpenAPI 与工作流契约测试；验证记录见 [result.md](result.md)。

## 任务表

| ID | 类型 | 组件 | 状态 | 装载清单 |
|---|---|---|---|---|
| T-WF-01 | design | global | 已完成 | 本 brief、[domain-model.md](domain-model.md)、三个 B3 场景、B1 领域对象与架构 |
| T-WF-02 | docs | scenarios | 已完成 | [SCN-0101](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-portfolio-management/scenario.md)、[SCN-0102](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-editing-and-publishing/scenario.md)、[SCN-0103](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-definition-exchange/scenario.md) |
| T-WF-03 | design | `CMP-workflow` | 已完成 | 本 brief、[domain-model.md](domain-model.md)、[architecture.md](architecture.md)、[component-spec.md](component-spec.md)、[schema.md](schema.md)、catalog / expert / kernel 规格 |
| T-WF-04 | design | `CMP-workflow` + `CMP-http-gateway` | 已完成 | [architecture.md](architecture.md)、[contract.md](contract.md)、现有 OpenAPI、错误映射 |
| T-WF-05 | review | global | 已完成 | [architecture.md](architecture.md)、[component-spec.md](component-spec.md)、[contract.md](contract.md)、[schema.md](schema.md)、[review.md](review.md)、场景走查、任务拆分 |
| T-WF-06 | implementation | `CMP-workflow` 等 | 已完成 | P1 冻结后的任务清单、[result.md](result.md) |

## 开放问题

1. **DSL schema**：`dslVersion: 1` 的机器可读资产为 `src/components/workflow/dsl.schema.json`；服务端运行时仍以 `graph.ts` 为校验源。
2. **删除与专家保护**：B4 实例引用是否阻止删除工作流；运行中实例仍需要专家时，当前定义已移除专家的边界如何处理。
3. **B4 运行契约**：fan-out 任务清单格式与存放路径；评审回退是否/如何对外发布指令。
4. **场景路径**：`SCN-0102` 标题已改为“编辑与校验”，目录名仍是 `workflow-editing-and-publishing`；是否同步改名待整理。
5. **组件/聚合/表名**：`CMP-workflow`、单聚合、表名字段已由 P1 第二轮评审冻结。

## 确认记录

- 2026-10-28：确认本轮只做 B3 定义侧，不纳入 B4 实例对象。
- 2026-10-28：确认 `graph + behavior` 用 JSONB，专家引用单独做规范化投影。
- 2026-10-28：确认不做工作流版本；接受不做按创建时定义复现；运行锁/复制可后置。
- 2026-10-28：确认保存只拦形状错误，语义问题给警告。
- 2026-10-28：专家引用只针对当前定义；工作流版本取消后不再有版本级引用范围问题。
- 2026-10-28：确认完全取消发布；不保留 `publishedAt/by`，不提供发布/版本端点。
- 2026-10-28：确认复制图与行为、保留节点 ID；名称冲突规则待定。
- 2026-10-28：确认现在回写 SCN-0101/0102/0103 三个场景；`SCN-0102` 改为编辑与校验。
- 2026-10-29：P1 第一轮评审通过——确认 B3 边界、`CMP-workflow` 数据所有权方向、JSONB + 专家引用投影、单定义/无版本/无发布、保存形状校验；其中“复制图+行为”已被后续“只存 graph”决策取代。
- 2026-10-29：`type` 作为自由文本标签，不参与图校验。
- 2026-10-29：B3 定义只存 `graph`，砍掉 `behavior`；专家输出、fan-out 任务清单、评审回退发布指令归 B4/workspace。
- 2026-10-29：导入 DSL 时缺失专家清空 `expertId` 并给警告；不保留悬空专家引用。
- 2026-10-29：确认 `start`/`end`/`agent`/`review`/`fanout`/`fanin` 必填专家，`confirm` 禁止。
- 2026-10-29：确认名称大小写不敏感唯一，`type` 标签可改。
- 2026-10-29：确认复制名称冲突自动追加 ` (2)`…` (99)`，超出 409。
- 2026-10-29：确认 JSON 导入、YAML 只导出。
- 2026-10-29：接受“保存缺失专家 400、导入清空并 warning”的不对称。
- 2026-10-29：确认低并发 MVP 不增加专家删除相关锁/串行化/自动重试；保留 revision + If-Match；专家删除由 FK 兜底。
- 2026-10-29：第二轮评审通过并冻结；开始实现 B3 工作流定义。
- 2026-10-29：实现完成：三表、`CMP-workflow`、catalog/expert/kernel 增量、10 个端点、OpenAPI 与测试；验证见 [result.md](result.md)。
- 待确认：B4 运行契约、场景目录改名。
