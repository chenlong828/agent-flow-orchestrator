---
layer: history
module: workflow
status: frozen
updated: 2026-10-29
---

# 工作流定义领域对象模型（B3）

> 本文固化已确认部分；对象命名、聚合边界、表名与操作契约仍需 P1 评审。标记“候选”的内容不作为冻结契约。

## 1 范围

- 覆盖：工作流组合、当前定义编辑、结构校验、DSL 导出/导入、专家引用保护。
- 不覆盖：工作流版本、发布快照、版本列表、回滚、节点行为配置、B4 实例/执行、运行锁、实例快照、UI。
- 关联场景：[SCN-0101](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-portfolio-management/scenario.md)、[SCN-0102](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-editing-and-publishing/scenario.md)、[SCN-0103](../../../design/scenarios/workflow-orchestration/workflow-definition/workflow-definition-exchange/scenario.md)。

## 2 已确认决策

| 决策 | 结论 |
|---|---|
| 定义模型 | 一个工作流只有一份当前定义 |
| 工作流版本 | 不做 |
| 复现要求 | 不要求按创建时定义复现；重跑使用当前定义 |
| B4 控制 | 运行锁/复制可后置，甚至可以先不做；不做实例快照 |
| 图存储 | `graph` 用 JSONB；不存 `behavior` |
| 专家引用 | 只针对当前定义；规范化投影 |
| 保存校验 | 只拦形状错误；语义问题给警告 |
| 发布 | 完全取消；不保留 `publishedAt/by`，不提供发布/版本端点 |
| 复制 | 复制图，节点 ID 保留；名称冲突自动后缀 |
| DSL | `dslVersion` 是格式版本，保留；不导出工作流版本；JSON 导入，YAML 只导出 |
| 运行产物 | 专家输出、fan-out 任务清单、回退发布指令属 B4/workspace，不写定义 |

## 3 对象集

对象概念已收敛；命名与聚合边界待 P1 确认。

| 对象 | 类型 | 职责 | 状态 |
|---|---|---|---|
| `Workflow` | 聚合根 | 身份、名称/类型标签/描述、`revision`、审计字段 | 已确认方向 |
| `WorkflowDefinition` | 1:1 子实体 | 当前唯一可编辑定义，只含 `graph` | 候选；P1 确认 |
| `WorkflowGraph` | 值对象 | `stages + nodes + edges` 的组合 | 候选；P1 确认 |
| `Stage` | 实体 | 阶段分组、说明、布局 | 候选；P1 确认 |
| `Node` | 实体 | 节点类型、专家绑定、阶段归属、布局 | 候选；P1 确认 |
| `Edge` | 值对象 | `seq` / `rollback` 边 | 候选；P1 确认 |
| `WorkflowExpertRef` | 读投影 | 当前定义中的专家引用，供删除保护/`refCount` | 已确认方向；表设计待 P1 |

明确不要：`WorkflowVersion`、`versionNo`、`versionLabel`、`baseVersionId`、`latestVersionId`、版本列表、发布快照、版本级专家引用、`NodeBehavior`、实例快照。

辅助对象（非核心）：`WorkflowDsl`（导出/导入投影）、`ValidationReport`（瞬态）、`WorkflowSummary/Detail`（读投影）。模板与导入审计可后置。

## 4 关系

```
Workflow 1──1 WorkflowDefinition 1──1 WorkflowGraph
WorkflowGraph 1──N Stage / Node / Edge
Node N──1 Stage（可选）
Edge N──1 Node（from / to）
Node N──1 Expert（逻辑引用）
Workflow 1──N WorkflowExpertRef N──1 Expert
```

删除规则（候选）：

- 删除 `Workflow` 级联 `WorkflowDefinition` 与 `WorkflowExpertRef`；
- 删除 `Stage` 只把节点 `stageId` 置空，不删除节点；
- 删除 `Node` 删除相关 `Edge`；
- 删除 `Expert` 前检查 `WorkflowExpertRef`，有引用返回 409；
- B4 实例引用是否阻止删除工作流，待 B4 设计。

## 5 不变量

已确认：

- 一个工作流恰好一份当前定义；
- 节点/阶段 ID 在工作流内唯一；边端点必须存在；边 kind 只能是 `seq` / `rollback`；
- `confirm` 不绑专家；
- 保存只阻断形状错误：ID 重复、边端点不存在、类型/kind 非法、阶段引用不存在；
- 缺开始/结束、单主链破坏、专家未绑、回退目标不合法属于语义问题，保存时给警告；
- 专家引用投影只反映当前定义；可从图重建；
- 删除专家只检查当前定义；`refCount` 按不同工作流数统计。

候选（P1 确认）：

- `Workflow` 作为唯一聚合根，一个 `revision` / `If-Match`；
- 每个节点最多一条 `seq` 出边；review/confirm 最多一条 `rollback` 出边；回退目标必须是前序节点；
- fanout/fanin 一对一；阶段归属可选；布局不参与执行；
- 导入时结构校验从严；缺失专家清空绑定并给警告；
- 语义问题在 B4 运行前必须被严格拦截。

## 6 操作

| 操作 | 读取 | 写入 | 状态 |
|---|---|---|---|
| 创建工作流 | 无 | Workflow + Definition（空图） | 候选 |
| 复制工作流 | 源 Workflow + Definition | 新 Workflow + Definition + ExpertRef | 已确认：复制图，节点 ID 保留；名称冲突自动后缀 |
| 保存定义 | Workflow/Definition | Definition + ExpertRef + `Workflow.revision` | 候选；`If-Match` |
| 校验定义 | Definition | 无 | 候选；返回结构/语义报告 |
| 导出 DSL | Definition | 无 | 候选；`dslVersion` 保留 |
| 导入 DSL | DSL | Workflow + Definition + ExpertRef | 候选；总是新建；缺失专家清空并警告 |
| 删除工作流 | Workflow | Workflow/Definition/Ref | 候选；B4 引用后置 |
| 专家删除保护 | ExpertRef | 无 | 候选；跨组件 |
| 发布 | — | — | 不做；不提供发布/版本端点 |
| 版本读取/列表/回滚 | — | — | 不做 |

保存定义的事务（候选）：校验 `revision` → 形状校验 → 替换 `graph` → 重建 `workflow_expert_ref` → `Workflow.revision + 1`。并发保存旧 revision 返回 409。

## 7 存储方向

已确认：`graph` 用 JSONB；专家引用用规范化投影；不存 `behavior`。

候选表：

```text
workflow
  id, name, type, description, revision,
  created_at, updated_at, created_by, updated_by

workflow_definition
  workflow_id PK, graph jsonb,
  updated_at, updated_by

workflow_expert_ref
  workflow_id, node_id, expert_id
```

说明：

- `workflow_expert_ref` 是派生投影，可从 `graph` 重建；
- 不建 `workflow_version`；
- `dslVersion` 是 DSL 格式版本，不是工作流版本；
- 表名、字段、索引、约束待 P1 设计；本文不构成建表方案。

## 8 B4 边界

- B4 实例直接使用当前定义；不存实例快照；
- 不要求复现；重跑使用当前定义；
- 运行中修改定义可能影响后续节点；这是已接受的代价；
- 运行锁/复制可后置，甚至先不做；
- 专家输出、fan-out 任务清单、评审回退的对外指令属 B4/workspace；定义只描述图和边；
- B4 运行前应严格检查图结构、专家存在/启用；
- 删除工作流是否被实例引用阻止、运行中实例仍需要专家时如何保护，均留给 B4。

## 9 未确认/待设计

1. **DSL JSON Schema**：`dslVersion: 1` 的正式结构；已由 `src/components/workflow/dsl.schema.json` 提供，导入运行时以 `graph.ts` 校验。
2. **导入严格度**：完整拓扑校验；除缺失专家外，其他引用缺失如何处理。
3. **删除与专家保护**：B4 实例引用；运行中实例仍需要已移除专家的边界。
4. **B4 运行契约**：fan-out 任务清单格式与存放路径；评审回退是否/如何对外发布指令。
5. **场景路径**：`SCN-0102` 标题已改为“编辑与校验”，目录名仍是 `workflow-editing-and-publishing`；是否同步改名待整理。
6. **组件/聚合/表名**：`CMP-workflow`、单聚合、表名字段仍需 P1 评审确认。

## 10 下一步

1. 场景卡与决策记录已按“只存 graph”回写；
2. 做 P1 第二轮评审：完整规格、契约、schema、走查、任务拆分；
3. 冻结后再写数据库修改与实现代码。
