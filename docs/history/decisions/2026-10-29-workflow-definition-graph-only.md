---
layer: history
module: workflow
status: frozen
updated: 2026-10-29
---

# 2026-10-29 工作流定义只存 graph，取消 behavior

## 背景

2026-10-28 的单定义决策把当前定义描述为 `graph + behavior` 两个 JSONB 块。继续讨论 behavior 时，用户提出它的定位是“暂存每个节点专家输出的信息，方便工作流确认进入下一个节点”，并指出真正需要与工作流交互的只有两处：

1. fan-out 时的任务清单列表放在哪里（一个固定格式的 task-db）；
2. 评审专家回退时，是否对外发布回退指令。

这两个点都是运行期产物/副作用，不是编辑期的图结构。专家输出、运行中的任务清单和回退指令写进定义会破坏“一个工作流只有一份当前定义”，并让一次运行修改定义。

## 决策

1. **B3 的 `WorkflowDefinition` 只存 `graph`**：`stages + nodes + edges` + 布局；不存 `behavior`，不建 `NodeBehavior` 对象，不提供 behavior 配置字段。
2. **DSL 不变**：仍只导出结构、角色、阶段、布局；不导出运行产物。
3. **复制只复制图**：节点 ID 保留，专家引用重建。
4. **运行产物归 B4/workspace**：
   - 专家输出、节点产物写 workspace；
   - fan-out 任务清单由 B4 定义固定格式与存放路径，不存定义；
   - 评审回退是否对外发布指令由 B4 控制，定义只保留 rollback 边。
5. **B4 运行前校验**：结构、专家存在/启用、运行所需产物由 B4 严格检查；B3 保存仍只拦形状错误。

## 被否决的方案

- **behavior 存节点静态配置**：最初设想为输入/输出/评审要点/fanout 配置；但用户澄清这些应由 workspace 承接，且 B4 未设计，字段集无法可靠冻结。
- **behavior 存专家输出**：会让运行写定义，破坏单定义与编辑并发，且实例间互相污染。
- **只保留两个交互字段**：会把 fan-out 任务清单/回退发布策略塞进定义；它们应按实例/运行配置处理，B3 不预留半套字段。

## 后果

- `workflow_definition` 只有 `workflow_id`、`graph`、`updated_at`、`updated_by`。
- `SCN-0102` 删除 behavior 配置步骤；`SCN-0101` 复制只复制图；`SCN-0103` 不再提“行为为空”。
- 保存/校验契约只处理图结构和专家绑定，不再有“行为不完整”语义警告。
- B4 需要单独设计 fan-out 任务清单格式/路径与评审回退发布策略；这是后续工序，不在 B3 补。
- 2026-10-28 决策中“graph + behavior”和“复制图+行为”的表述由本决策取代。

## 关联

- [单定义决策](2026-10-28-workflow-definition-single-definition.md)
- [工序 brief](../works/2026-10-28-workflow-definition/brief.md)
- [领域对象模型](../works/2026-10-28-workflow-definition/domain-model.md)
