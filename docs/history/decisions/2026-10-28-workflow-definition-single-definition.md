---
layer: history
module: workflow
status: frozen
updated: 2026-10-28
---

# 2026-10-28 工作流定义采用单定义模型，不做工作流版本

> 2026-10-29 后续决策：B3 当前定义只保留 `graph`，取消 `behavior`；本文中“graph + behavior”和“复制图+行为”的表述由 [只存 graph 决策](2026-10-29-workflow-definition-graph-only.md) 取代。

## 背景

B3 工作流定义先要支持组合管理、编辑校验和 DSL 交换。此前讨论过“一个草稿 + 多个不可变发布版本”的模型；它需要版本表、发布快照、版本并发、实例 pin 版本和历史专家引用保护。当前阶段没有 B4 实例执行，也不要求按实例创建时的定义复现，版本模型带来的复杂度大于收益。

用户明确：当前阶段暂时不考虑工作流版本；不要求复现，大模型专家每次执行本身也非精确一致；运行锁与复制已是高配，甚至可以不做。由此收敛为“单定义”模型。

## 决策

1. **一个工作流只有一份当前定义**：不做 `WorkflowVersion`、版本号、版本列表、从版本派生草稿。
2. **完全取消发布**：没有发布快照、没有 `publishedAt/by` 状态位、没有发布/版本端点；工作流始终是当前定义。
3. **专家引用只针对当前定义**：`WorkflowExpertRef` 只记录当前 `workflow + node + expert`；删除保护只查当前定义。
4. **图与行为使用 JSONB**：当前定义以 `graph + behavior` 整体保存；专家引用单独做规范化投影，供删除保护和引用计数。
5. **保存只拦形状错误**：ID/边端点/类型/阶段引用等形状错误阻断保存；缺开始/结束、单主链、专家绑定、行为完整性等语义问题给警告，不阻断保存。
6. **复制图与行为、保留节点 ID**：复制是普通作者操作，不是版本；节点 ID 在工作流内唯一，保留不冲突，fanout/fanin 引用无需重写。名称冲突规则待定。
7. **B4 不做复现**：实例直接使用当前定义；重跑使用当前定义；不做实例快照。运行锁/复制可后置，甚至可以先不做。
8. **DSL 格式版本保留**：`dslVersion` 表示 DSL 格式，不是工作流版本；导出/导入不携带工作流版本。

## 被否决的方案

- **工作流版本表**：能提供发布快照、回滚和实例 pin，但需要版本 schema、发布事务、版本并发和历史引用保护；当前没有复现需求，收益不足。
- **实例快照**：可以不做工作流版本又保留复现，但每个实例要存一份图和专家引用；当前明确不要求复现，暂不做。以后若要求复现，再按实例补，不回到工作流版本表。
- **运行锁 + 复制作为必选**：能避免运行中定义变化，但需要活跃实例 guard、启动/编辑竞态处理和复制 UX；当前接受“运行中改定义会影响后续节点”，因此后置。
- **全规范化图**：外键完整，但整图保存、版本快照和异构行为会产生大量表和复制；当前选择 JSONB + 专家引用投影。

## 后果

- 没有历史版本、回滚、版本审计；重跑使用当前定义。
- 运行中修改定义可能影响尚未执行的节点；这是已接受的代价。
- 删除专家只检查当前定义，历史引用问题消失；但 B4 运行中实例仍需要专家时，当前 guard 看不到实例引用，留给 B4。
- 删除工作流是否被 B4 实例引用阻止，留给 B4 设计。
- 场景卡已回写：`SCN-0101` / `SCN-0102` 移除版本/发布；`SCN-0102` 改为编辑与校验；`SCN-0103` 保留 `dslVersion`，不导出工作流版本。
- 新增 `CMP-workflow`、工作流表、专家引用 guard 与 catalog 读契约，仍属 P1，需设计评审后编码。

## 未决

- 工作流名称是否唯一、类型是否可改。
- 复制名称冲突如何生成新名称；图/行为复制与节点 ID 保留已定。
- `NodeBehavior` 字段集与 DSL JSON Schema。
- 导入的完整拓扑校验、缺行为/缺专家处理。
- B4 实例引用与活跃实例专家保护。
- `SCN-0102` 目录名是否从 `workflow-editing-and-publishing` 同步改为编辑与校验；标题已改。

## 关联

- [工序 brief](../works/2026-10-28-workflow-definition/brief.md)
- [领域对象模型](../works/2026-10-28-workflow-definition/domain-model.md)
- [SCN-0101](../../design/scenarios/workflow-orchestration/workflow-definition/workflow-portfolio-management/scenario.md)
- [SCN-0102](../../design/scenarios/workflow-orchestration/workflow-definition/workflow-editing-and-publishing/scenario.md)
- [SCN-0103](../../design/scenarios/workflow-orchestration/workflow-definition/workflow-definition-exchange/scenario.md)
