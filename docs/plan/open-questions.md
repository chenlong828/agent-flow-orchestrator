---
layer: plan
module: global
status: current
updated: 2026-10-29
---

# 开放问题

本表只收跨工序疑问；需求请建 `requirements/REQ-xxxx.md`。工序领取时在 `brief.md` 记编号；有结论后写去向（转 REQ / 落 `history/decisions/`），条目不删除。

当前无阻塞性开放问题；2026-10-29 技术债清理留下 7 项 hold，见下表 OQ-5～OQ-11。OQ-1～OQ-4 已于 2026-10-25 关闭归档，条目保留供追溯，结论见 [项目边界与早期开放问题归档](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。

| # | 问题 | 结论 / 去向 |
|---|---|---|
| OQ-1 | **技术栈与运行形态**：编排服务用什么语言 / 运行时？执行器内嵌单进程，还是独立 worker / 容器池？ | 已关闭（2026-10-25）：技术栈为 Bun + PostgreSQL；运行形态与 ACP 执行模型不属于当前需求，未来按实际工序另立设计。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-2 | **与 `agent-flow-ui` 的关系**：它是本项目的需求来源与验收蓝本，还是仅同期演示？需求、术语、边界以哪一边为准？ | 已关闭（2026-10-25）：`agent-flow-ui` 是独立项目；本仓库不提供产品 UI、不以其为需求来源或验收前置，只按 REST 契约交互。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-3 | **对外形态与契约**：本项目以 HTTP API / CLI / 库三种形态中的哪些对外？UI 是否直接消费？契约版本由谁定义？ | 已关闭（2026-10-25）：只提供 HTTP API（`/api/v1` + `/healthz`），不提供 CLI、库或产品 UI；Swagger UI 仅作为开发者文档；契约由本仓库维护，UI 是否消费由独立项目决定。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-4 | **首个交付范围**：M4 的最小端到端链路选哪条业务流（工作流定义 → 装配 → 运行 → 观测）？ | 已关闭（2026-10-25）：B1 已完成；首个端到端流程等实际需求出现后另立 `REQ`/工序，不作为当前开放问题。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-5 | **JSON 请求体上限**：是否设、设多少、超限返回 413 还是 400？ | 待定（2026-10-29 hold，T-DEBT-13）：等明确客户端约束与最大合法请求体后再定；本轮不预置数值。 |
| OQ-6 | **skill store**：是否补一个独立的 skill 读模型/store，还是继续由 catalog + 服务承担？ | 待定（2026-10-29 hold，T-DEBT-18）：等下次改 skill 写路径时评估，不单独为抽象而动。 |
| OQ-7 | **catalog N+1**：列表/引用投影是否需要在 B4 前批量化？ | 待定（2026-10-29 hold，T-DEBT-19）：等数据量或 B4 端点增长给出实际压力，再决定批量化或缓存。 |
| OQ-8 | **跨组件公共件**：`toIso`/`escapeLike`/分页是否抽到 `kernel` 或 `platform`？ | 待定（2026-10-29 hold，T-DEBT-20）：当前重复量小；等第三个使用点出现再评估，避免为少量重复扩权。 |
| OQ-9 | **`SkillService`/`SkillDraftService` 是否拆分**：按读/写/文件/发布拆，还是保持现状？ | 待定（2026-10-29 hold，T-DEBT-21）：拆分需重排事务与文件写入顺序；等有明确改动需求再做。 |
| OQ-10 | **请求上下文与结构化日志**：字段、采样、请求 ID 传播范围如何定？ | 待定（2026-10-29 hold，T-DEBT-22）：属于可观测性工序，先定日志契约再实现。 |
| OQ-11 | **`RevisionConflictError` 竞态兜底**：是否需要在唯一约束冲突时重试或转 409？ | 待定（2026-10-29 hold，T-DEBT-23）：无法稳定复现；等有失败样本再加测试与兜底。 |
