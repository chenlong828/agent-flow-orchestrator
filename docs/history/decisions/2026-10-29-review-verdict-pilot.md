---
layer: history
module: global
status: frozen
updated: 2026-10-29
---

# 2026-10-29 评审四档裁决本地试点

## 背景

两个已发生的评审格式互不相同：`history/works/2026-10-28-workflow-definition/review.md` 是「评审什么 / 已确认 / 走查 / 冻结门槛」，`history/works/2026-10-28-skill-package/design-review.md` 是「结论 / 审视依据 / 阻塞项 B1–B8」。workflow 评审的「已确认」表写了 11 条决策，无一条测试引用；走查全部是 `[x]` 勾选，不区分「查过没问题」与「已改」。评审有方案级结论（通过 / 有条件通过 / 重新设计 / 阻塞），但没有每条发现的处置档位与证据标准（RFC 草案 v0.1，2026-10-29）。

## 决策

1. **直接修改本地 `.agents/skills/`（git 跟踪副本）试点**：用户 2026-10-29 授权，不再经 `docs/playbook/` 过渡。改动三处：`arch-design-spec` 第 8 步（四档定义与证据规则、按定级裁剪）、`dev-execution-spec` 验收节（交付前裁决与合并门）、`doc-layout-spec` works 节（`review.md` 具名对象）。
2. **四档不是五档**：blocker / decision now / verified sound / hold；RFC 的 polish 并入 hold——两者去向相同（待办 / issue），solo + agent 形态下区分不改变动作。
3. **按定级裁剪**：P1 四档齐全 + 冻结前 breaking change 审查；P2 至少 blocker、decision now、verified sound；P3 免评审文件，commit message 一行裁决。
4. **与上游分叉**：`~/skills/af-dev-skill` 仍是 v0.1 未动；本次改动只在本仓库副本，`AGENTS.md` 已标注。试点收口后决定回灌上游（升 v0.2）或回滚。

## 被否决的方案

- **直接升上游 v0.2**：证据规则是否可执行未验证，绕过项目「范围与决策（试行）」的观察回路。
- **经 `docs/playbook/` 过渡（RFC 5.8）**：多一层间接；git 跟踪副本直接改效果等价且可 diff，用户拍板选后者。
- **polish 独立成第五档**：与 hold 去向相同，独立档位增加「模板过半填 N/A」的形式主义风险。
- **新增 review-verdict-spec 第六技能**：裁决依附评审步骤，不构成独立流程。

## 后果与评估判据

- 本地 `.agents/skills/` 与上游 v0.1 分叉；下次升级覆盖前必须 diff 核对本段改动是否已回灌。
- 试点对象：下一个 P1 工序设计冻结评审，加一次合并 / 发布前裁决。连续 2 个工序满足以下判据则回灌上游：blocker 100% 有复现或测试映射；decision 100% 落文档 + pinning test；hold 100% 转出；review 不超过 2 页。
- 失败判据（回滚，只保留 verified sound 一节）：评审时长增加超过 50% 而 blocker 质量不变；所有发现都是 blocker；模板过半填 N/A；pinning test 只是给现有测试换个名字。
- 本次不新增代码、端点、表或迁移。
