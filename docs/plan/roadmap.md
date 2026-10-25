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
| M1 | 项目边界：本仓库只提供 HTTP API，不做 UI；UI 为独立项目 | 已关闭（2026-10-25） | `history/decisions/2026-10-25-project-boundary-and-open-questions.md` |
| M2 | 架构规格：运行形态、ACP 执行模型、模块切分；技术栈 D0 已定（Bun + PostgreSQL），仅在实际运行需求出现时启动 | 待排（按需启动） | `design/architecture.md` |
| M3 | 首批需求与场景：按实际需求提炼 `REQ` / `SCN` | 待排 | `requirements/`、`design/scenarios/` |
| M4 | 首个可运行工序：最小端到端链路 + 验收场景（B1 资产注册中心为其前置，已完成） | 待排 | `works/` |

## 工序与依赖

- 一个 `REQ` 同一时刻只允许一个在飞工序；开工 = 建 `docs/works/<工序>/` + 写 `brief.md` 并引 `REQ-xxxx`。
- M2 只产出裁定与规格，不写实现代码；M2 是 P1，人参与切分与契约评审后才可编码。
- 无用户旅程的技术债 / 文档活走旁路，不进 `requirements/`。
- B1 是基础设施工序（无 UI 改动；UI 为独立项目），按旁路处理，不建 `REQ`/`SCN`，`brief.md` 为锚点；追溯方式已在 `implementation-plan.md` §9 落为默认旁路。
- 已知欠账：无 CI 门禁、无文档校验脚本。首个 P3 工序补，不早于 M2。

## 近期完成

- `2026-10-24-db-backend-infra`：B1 资产注册中心（Harness/工具/Skill/专家）已完成。29 个业务端点 + `/healthz`、16 张表迁移、种子与测试已交付（后续专家聚合工序补到 30 个业务端点）；用户直接要求实现，`T-B1-D05` 门据此通过。结论见 [`result.md`](../works/2026-10-24-db-backend-infra/result.md)，契约见 [`http-gateway/spec.md`](../design/components/http-gateway/spec.md) 与 [`openapi.yaml`](../../src/components/http-gateway/openapi.yaml)。
- `2026-10-25-api-swagger`：在 B1 上补 `GET /docs` Swagger UI 与 `GET /openapi.yaml`，静态资源 vendor，不改业务端点与数据库。结论见 [`result.md`](../works/2026-10-25-api-swagger/result.md)。
- `2026-10-25-runtime-openapi-export`：把 OpenAPI 资产从 `docs/design/` 移入 `CMP-http-gateway`，补齐 30 个 operation 与 48 个 schema 的说明，运行时 `/docs`、`/openapi.yaml` 不变。结论见 [`result.md`](../works/2026-10-25-runtime-openapi-export/result.md)。
- `2026-10-25-core-config`：把配置从 `CMP-platform` 拆到 `CMP-config`，支持 `default.toml` / `local.toml` / `process.env` 合并与校验；组件数 8 → 9，默认端口仍为 3000。结论见 [`result.md`](../works/2026-10-25-core-config/result.md)。
- `2026-10-25-expert-aggregate-write`：专家创建即装配、`PATCH /experts/{id}` 聚合部分更新；一次事务、一次 `revision`，保留原 `PUT` 与装配端点。结论见 [`result.md`](../works/2026-10-25-expert-aggregate-write/result.md)。
- `2026-10-25-playbook-method-layer`：新增项目本地方法层 `docs/playbook/`，首份 `backend-contract-boundaries.md` 以 `draft` 落地；上游 `doc-layout-spec` 暂不更新，待本迭代多次复用后统一合并。决策见 [`decision`](../history/decisions/2026-10-25-playbook-method-layer.md)，方法见 [`playbook`](../playbook/backend-contract-boundaries.md)。
- 后续不预置 M2/M4 的答案；实际运行需求出现时再启动对应工序。B1 只覆盖控制面资产注册，不包含工作流与运行实例。早期开放问题已关闭，见 [`open-questions.md`](open-questions.md)。
