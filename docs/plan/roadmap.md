---
layer: plan
module: global
status: current
updated: 2026-10-23
---

# 路线图

## 里程碑

| 里程碑 | 内容 | 状态 | 关联 |
|---|---|---|---|
| M0 | 项目初始化：技能安装、五态文档树、git 仓库 | 已完成（2026-10-23） | `history/decisions/2026-10-23-project-init.md` |
| M1 | 需求来源裁定：确认与 `agent-flow-ui` 的关系及需求以什么为准 | 待排 | `open-questions.md` OQ-2 |
| M2 | 架构选型与规格：技术栈、运行形态、模块切分，按 P1 与人确认后冻结 | 待排 | `open-questions.md` OQ-1；`design/architecture.md` |
| M3 | 首批需求与场景：从已裁定的需求来源提炼 `REQ` / `SCN` | 待排 | `requirements/`、`design/scenarios/` |
| M4 | 首个可运行工序：最小端到端链路 + 验收场景 | 待排 | `works/` |

## 工序与依赖

- 一个 `REQ` 同一时刻只允许一个在飞工序；开工 = 建 `docs/works/<工序>/` + 写 `brief.md` 并引 `REQ-xxxx`。
- M1、M2 只产出裁定与规格，不写实现代码；M2 是 P1，人参与切分与契约评审后才可编码。
- 无用户旅程的技术债 / 文档活走旁路，不进 `requirements/`。
- 已知欠账：无 CI 门禁、无文档校验脚本。首个 P3 工序在技术栈确定后补，不早于 M2。

## 当前在飞

无。
