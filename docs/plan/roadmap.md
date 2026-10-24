---
layer: plan
module: global
status: current
updated: 2026-10-25
---

# 路线图

## 里程碑

| 里程碑 | 内容 | 状态 | 关联 |
|---|---|---|---|
| M0 | 项目初始化：技能安装、五态文档树、git 仓库 | 已完成（2026-10-23） | `history/decisions/2026-10-23-project-init.md` |
| M1 | 需求来源裁定：确认与 `agent-flow-ui` 的关系及需求以什么为准 | 待排 | `open-questions.md` OQ-2 |
| M2 | 架构规格：运行形态、ACP 执行模型、模块切分；技术栈 D0 已定（Bun + PostgreSQL），按 P1 与人确认后冻结 | 待排 | `open-questions.md` OQ-1；`design/architecture.md` |
| M3 | 首批需求与场景：从已裁定的需求来源提炼 `REQ` / `SCN` | 待排 | `requirements/`、`design/scenarios/` |
| M4 | 首个可运行工序：最小端到端链路 + 验收场景（B1 资产注册中心为其前置，已完成） | 待排 | `works/` |

## 工序与依赖

- 一个 `REQ` 同一时刻只允许一个在飞工序；开工 = 建 `docs/works/<工序>/` + 写 `brief.md` 并引 `REQ-xxxx`。
- M1、M2 只产出裁定与规格，不写实现代码；M2 是 P1，人参与切分与契约评审后才可编码。
- 无用户旅程的技术债 / 文档活走旁路，不进 `requirements/`。
- B1 是基础设施工序（无 UI 改动、`OQ-2` 未裁定），按旁路处理，不建 `REQ`/`SCN`，`brief.md` 为锚点；追溯方式已在 `implementation-plan.md` §9 落为默认旁路。
- 已知欠账：无 CI 门禁、无文档校验脚本。首个 P3 工序补，不早于 M2。

## 近期完成

- `2026-10-24-db-backend-infra`：B1 资产注册中心（Harness/工具/Skill/专家）已完成。29 个业务端点 + `/healthz`、16 张表迁移、种子与测试已交付；用户直接要求实现，`T-B1-D05` 门据此通过。结论见 [`result.md`](../works/2026-10-24-db-backend-infra/result.md)，契约见 [`http-gateway/spec.md`](../design/components/http-gateway/spec.md) 与 [`openapi.yaml`](../design/components/http-gateway/openapi.yaml)。
- 下一跳仍是 M2（运行形态与 ACP 执行模型）与 M4（最小端到端链路）；B1 只覆盖控制面资产注册，不包含工作流与运行实例。
