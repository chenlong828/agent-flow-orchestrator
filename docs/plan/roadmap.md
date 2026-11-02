---
layer: plan
module: global
status: current
updated: 2026-11-02
---

# 路线图

## 里程碑

| 里程碑 | 内容 | 状态 | 关联 |
|---|---|---|---|
| M0 | 项目初始化：技能安装、五态文档树、git 仓库 | 已完成（2026-10-23） | `history/decisions/2026-10-23-project-init.md` |
| M1 | 项目边界：本仓库只提供 HTTP API，不做 UI；UI 为独立项目 | 已关闭（2026-10-25） | `history/decisions/2026-10-25-project-boundary-and-open-questions.md` |
| M2 | 架构规格：运行形态、ACP 执行模型、模块切分；技术栈 D0 已定（Bun + PostgreSQL），仅在实际运行需求出现时启动 | 待排（按需启动） | `design/architecture.md` |
| M3 | 首批需求与场景：按实际需求提炼 `REQ` / `SCN` | 格式试点（2026-10-25） | `design/scenarios/`、`history/works/2026-10-25-scenario-index-pilot/` |
| M4 | 首个可运行工序：最小端到端链路 + 验收场景（B1 资产注册中心为其前置，已完成） | 待排 | `works/` |

## 工序与依赖

- 一个 `REQ` 同一时刻只允许一个在飞工序；开工 = 建 `docs/works/<工序>/` + 写 `brief.md` 并引 `REQ-xxxx`。
- M2 只产出裁定与规格，不写实现代码；M2 是 P1，人参与切分与契约评审后才可编码。
- 无用户旅程的技术债 / 文档活走旁路，不进 `requirements/`。
- B1 是基础设施工序（无 UI 改动；UI 为独立项目），按旁路处理，不建 `REQ`/`SCN`，`brief.md` 为锚点；追溯方式已在 `implementation-plan.md` §9 落为默认旁路。
- 已知欠账：无 CI 门禁；文档校验目前只有场景索引（`docs:check`），完整文档树校验待补。

## 近期完成

- `2026-10-30-quality-refactor`：代码质量基线从 80 条违规降到 0，组件与 service/store 工厂完成结构拆分；迁移历史拍扁为单一 `0001_baseline.sql`。`bun run check` 273 pass、`quality:gate` 通过。结论见 [`result.md`](../history/works/2026-10-30-quality-refactor/result.md)。
- `2026-10-30-workflow-contract-boundary`：工作流契约边界收敛——创建必须提交合法图，拓扑/绑定错误阻断写入，`layout` / `viewport` 归前端并透明持久化；评审 blocker 0 / decision 3 / hold 0。结论见 [`result.md`](../history/works/2026-10-30-workflow-contract-boundary/result.md)。
- `2026-10-29-workflow-viewport`：画布视口作为 `WorkflowGraph.viewport` 随当前定义保存，详情、DSL 往返与复制均保留；不新增表、列或端点。结论见 [`result.md`](../history/works/2026-10-29-workflow-viewport/result.md)。
- `2026-10-29-tech-debt-cleanup`：架构护栏、死代码与网关拆分；`app.ts` 从 845 行降到 122 行，47 个业务端点不变，6 项 hold 已转 `open-questions`。结论见 [`result.md`](../history/works/2026-10-29-tech-debt-cleanup/result.md)。
- `2026-10-28-skill-package`：Skill 原地重建为 zip 包 + 数据库 brief + 草稿保存，15 个 Skill 端点；当时的 4 个迁移后续已由质量重构拍扁为单一基线。结论见 [`result.md`](../history/works/2026-10-28-skill-package/result.md)。
- `2026-10-24-db-backend-infra`：B1 资产注册中心（Harness/工具/Skill/专家）已完成。29 个业务端点 + `/healthz`、16 张表迁移、种子与测试已交付（后续专家聚合工序补到 30 个业务端点）；用户直接要求实现，`T-B1-D05` 门据此通过。结论见 [`result.md`](../history/works/2026-10-24-db-backend-infra/result.md)，契约见 [`http-gateway/spec.md`](../design/components/http-gateway/spec.md) 与 [`openapi.yaml`](../../src/components/http-gateway/openapi.yaml)。
- `2026-10-25-api-swagger`：在 B1 上补 `GET /docs` Swagger UI 与 `GET /openapi.yaml`，静态资源 vendor，不改业务端点与数据库。结论见 [`result.md`](../history/works/2026-10-25-api-swagger/result.md)。
- `2026-10-25-runtime-openapi-export`：把 OpenAPI 资产从 `docs/design/` 移入 `CMP-http-gateway`，补齐 30 个 operation 与 48 个 schema 的说明，运行时 `/docs`、`/openapi.yaml` 不变。结论见 [`result.md`](../history/works/2026-10-25-runtime-openapi-export/result.md)。
- `2026-10-25-core-config`：把配置从 `CMP-platform` 拆到 `CMP-config`，支持 `default.toml` / `local.toml` / `process.env` 合并与校验；组件数 8 → 9，默认端口仍为 3000。结论见 [`result.md`](../history/works/2026-10-25-core-config/result.md)。
- `2026-10-25-expert-aggregate-write`：专家创建即装配、`PATCH /experts/{id}` 聚合部分更新；一次事务、一次 `revision`，保留原 `PUT` 与装配端点。结论见 [`result.md`](../history/works/2026-10-25-expert-aggregate-write/result.md)。
- `2026-10-25-list-read-model`：列表直接补 `SkillListItem.triggers`、`ExpertListItem.skills`（前 3 个 `{id,name}`）、`ToolListItem.description`；不引入 BFF 富化或前端 N+1。结论见 [`result.md`](../history/works/2026-10-25-list-read-model/result.md)。
- `2026-10-26-skill-contract-v2`：Skill 契约拆成管理面与编排面——`description`（1–400）合并原 `summary` + `triggers`，新增 `GET /skills/{id}/document` 输出 markdown 全文（ETag/304）；迁移删除 `skill_trigger`，业务端点 30 → 31。展示端重构不在本仓库；后续 Skill 包工序已把写路径改为 zip 包 + 草稿。结论见 [`result.md`](../history/works/2026-10-26-skill-contract-v2/result.md)。
- `2026-10-28-workflow-definition`：B3 工作流定义已实现——三张表、`CMP-workflow`、catalog/expert/kernel 增量、10 个 HTTP 端点、OpenAPI 与契约测试；B4 运行/实例与 UI 未做。结论见 [`result.md`](../history/works/2026-10-28-workflow-definition/result.md)。
- `2026-10-25-scenario-index-pilot`：建立首个场景「智能体能力资产 / 专家能力定义与装配 / 专家定义与装配管理」，分配 `TC-EXP-001`～`TC-EXP-004`，新增场景索引生成器与 `docs:index` / `docs:check`。场景保持 `designed`，未宣称完整 CRUD 验收。结论见 [`result.md`](../history/works/2026-10-25-scenario-index-pilot/result.md)。
- 2026-11-02：`docs/works/` 中已收口的 `2026-10-25-scenario-index-pilot`、`2026-10-26-skill-contract-v2`、`2026-10-28-skill-package`、`2026-10-29-tech-debt-cleanup`、`2026-10-29-workflow-viewport`、`2026-10-30-workflow-contract-boundary`、`2026-10-24-agentflow-execution-concept` 已整目录归档到 `history/works/`，frontmatter 改为 `frozen`；其中概念工序原在 result 中记为「不归档」，本次按 `doc-layout-spec` 生命周期统一归档，失效说明见其 result。归档件只作历史证据，不作设计依据。
- 后续不预置 M2/M4 的答案；实际运行需求出现时再启动对应工序。B1+B3 覆盖控制面资产注册与工作流定义，B4 运行实例仍未开始。早期开放问题已关闭；当前只有 6 项 hold，见 [`open-questions.md`](open-questions.md)。
