---
layer: history
module: global
status: frozen
updated: 2026-10-25
---

# 2026-10-25 文档树增加 playbook 方法层

## 背景

B1 收口时连续遇到两个同类问题：专家聚合写被拆成多个端点，迫使 BFF 编排事务；列表导航字段缺失，迫使 BFF 逐条拉详情。两个问题都已按后端契约修复，但“什么时候应补后端契约、什么时候才轮到 BFF”的判断只留在工序结果里，下一次仍要重新推导。

现有文档层各有明确职责：`design/` 是现行系统真相，`works/` 是一次性过程，`history/` 是冻结记忆，`plan/` 是调度。它们都不适合承载“脱离本次工序、可复用的设计判断”。因此新增一个独立的方法层，而不是把规则塞进组件规格或工序结果。

## 决策

1. **在 `docs/` 顶层新增 `playbook/`**：只放可复用的设计判断，一份 playbook 对应一类问题；它不是生命周期状态，不参与“五态”的路径状态推导。
2. **首份 playbook 限定范围**：`backend-contract-boundaries.md`，只处理后端在 UI/BFF 接缝上的聚合写、读模型与边界判定；组件拆分、依赖与数据所有权仍归 `arch-design-spec`，不在 playbook 重写。
3. **playbook 使用自己的 frontmatter**：`layer: playbook`，`status: draft / current / deprecated`，`module` 标识主题；废弃后移入 `history/playbooks/`。
4. **playbook 不是硬门禁**：它是评审参考，不是第二套规格；规则若需要强制执行，升级到技能。与现行组件规格冲突时，以现行规格为准。
5. **上游技能暂不修改**：`doc-layout-spec` 仍由 `~/skills/af-dev-skill` 管理，项目不直接改 `.agents/skills/` 正文。当前把 `playbook/` 作为项目本地扩展，在 `AGENTS.md` 与 `docs/README.md` 标注；本迭代多次复用后再统一合并到上游技能。

## 被否决的方案

- **作为第六种生命周期状态**：会破坏“位置即状态”的五态模型；playbook 没有需求、执行、归档那样的生命周期。
- **放进 `design/playbooks/`**：`design/` 的权威是当前系统真相，playbook 是可跨工序复用的方法，二者生命周期不同。
- **继续只写在 `works/*/result.md`**：结果文件绑定具体工序，无法作为下一次的判断入口。
- **直接编辑已安装的 `doc-layout-spec`**：违反“技能正文不手改；升级 = 覆盖同名目录”的项目约束。

## 后果

- `docs/playbook/backend-contract-boundaries.md` 以 `draft` 状态存在，引用两个工序结果作为证据，但不复制其过程叙述。
- `docs/README.md` 的结构与阅读顺序增加方法层；`AGENTS.md` 文档纪律注明这是项目本地扩展。
- 上游 `doc-layout-spec` 合并前，`layer: playbook` 只在项目内有效；合并后删除本地补注，以技能为准。
- 本次不新增代码、端点、表或迁移。
