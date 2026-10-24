---
layer: plan
module: global
status: current
updated: 2026-10-25
---

# 开放问题

本表只收跨工序疑问；需求请建 `requirements/REQ-xxxx.md`。工序领取时在 `brief.md` 记编号；有结论后写去向（转 REQ / 落 `history/decisions/`），条目不删除。

当前无开放问题。OQ-1～OQ-4 已于 2026-10-25 关闭归档，条目保留供追溯，结论见 [项目边界与早期开放问题归档](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。

| # | 问题 | 结论 / 去向 |
|---|---|---|
| OQ-1 | **技术栈与运行形态**：编排服务用什么语言 / 运行时？执行器内嵌单进程，还是独立 worker / 容器池？ | 已关闭（2026-10-25）：技术栈为 Bun + PostgreSQL；运行形态与 ACP 执行模型不属于当前需求，未来按实际工序另立设计。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-2 | **与 `agent-flow-ui` 的关系**：它是本项目的需求来源与验收蓝本，还是仅同期演示？需求、术语、边界以哪一边为准？ | 已关闭（2026-10-25）：`agent-flow-ui` 是独立项目；本仓库不提供 UI、不以其为需求来源或验收前置，只按 REST 契约交互。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-3 | **对外形态与契约**：本项目以 HTTP API / CLI / 库三种形态中的哪些对外？UI 是否直接消费？契约版本由谁定义？ | 已关闭（2026-10-25）：只提供 HTTP API（`/api/v1` + `/healthz`），不提供 CLI、库或 UI；契约由本仓库维护，UI 是否消费由独立项目决定。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-4 | **首个交付范围**：M4 的最小端到端链路选哪条业务流（工作流定义 → 装配 → 运行 → 观测）？ | 已关闭（2026-10-25）：B1 已完成；首个端到端流程等实际需求出现后另立 `REQ`/工序，不作为当前开放问题。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
