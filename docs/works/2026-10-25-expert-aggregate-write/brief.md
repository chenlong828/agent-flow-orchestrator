---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# 专家聚合写契约

## 背景

外部 UI 的专家保存是一个聚合动作：一次提交五区字段、人设、引用、有序 Skill 装配和有序工具装配。B1 当前把专家主体与两类装配拆成 `PUT /experts/{id}`、`PUT /experts/{id}/skills`、`PUT /experts/{id}/tools` 三次写操作，每次独立事务、独立递增 `revision`，创建也不接收装配。调用方（BFF）因此必须编排多步事务和补偿，失败会留下半套专家。

用户已确认：把专家聚合写语义补回 `CMP-expert`，不让 BFF 承担领域事务。

## 目标

1. `CMP-expert.create` 支持可选的有序 `skillIds` / `toolIds`，创建与装配在同一事务、初始 `revision=1`。
2. 新增 `CMP-expert.updateAggregate`：可选字段 + 可选有序 `skillIds` / `toolIds`，同一事务、只递增一次 `revision`。
3. HTTP 增加 `PATCH /api/v1/experts/{id}`，必须带 `If-Match`；`POST /experts` 接受 `skillIds` / `toolIds`。
4. 保留既有 `PUT /experts/{id}`、`PUT /experts/{id}/skills`、`PUT /experts/{id}/tools` 作为全量/专用入口。
5. 同步组件规格、HTTP 契约、OpenAPI、README/架构端点数与测试。

## 范围

**做：**

- `src/components/expert` 的领域类型、服务、store 复用与事务。
- `src/components/http-gateway/app.ts` 的新端点与字段校验。
- `src/components/http-gateway/openapi.yaml` 的 PATCH 路径、请求 schema 与说明。
- 组件规格、HTTP 规格、架构端点计数、README、roadmap。
- 领域与 HTTP 契约测试。

**不做：**

- 不新增数据库表或迁移；复用 `expert`、`expert_persona`、`expert_ref`、`expert_skill`、`expert_tool`。
- 不新增 `CMP-expert-assembly` 组件；装配仍属于专家聚合。
- 不改 Skill/工具自身契约，不改 B1 范围外的运行时字段。
- 不删除或废弃既有端点和字段。
- 不改外部 UI 项目。

## 改动级别与确认门

**P1**：改专家聚合的公共写契约、跨表事务与外部 REST 端点；不改组件切分和数据所有权。

- 2026-10-25 用户已确认“聚合保存采用 PATCH、创建接受装配”，同意直接执行。
- 实现顺序：先规格与领域，再 HTTP/OpenAPI，最后验证与文档收口。

## 任务表

| ID | 类型 | 组件 | 状态 | 产出 |
|---|---|---|---|---|
| `T-EXP-AGG-01` | design/change | `CMP-expert` | done | 聚合类型、create 装配、updateAggregate、事务与错误 |
| `T-EXP-AGG-02` | change | `CMP-http-gateway` | done | POST 字段扩展、PATCH 路由、传输校验、OpenAPI |
| `T-EXP-AGG-03` | docs | `global` | done | expert/http/architecture/README/roadmap 同步 |
| `T-EXP-AGG-04` | verify | `global` | done | 领域/HTTP 测试、typecheck、全量测试、真实 API 冒烟 |

## 验收标准

- `POST /experts` 携带 `skillIds` / `toolIds` 时，创建与装配同事务；任一目标不存在或重复，专家不留下。
- `PATCH /experts/{id}` 省略字段不变、数组出现即整体替换、空数组清空；成功只递增一次 `revision`。
- 缺 `If-Match` 返回 428；旧 revision 返回 409；未知字段返回 400。
- 既有 `PUT /experts/{id}` 全量更新仍不会覆盖已有装配；`PUT /experts/{id}/skills` / `/tools` 行为不变。
- OpenAPI PATCH 与请求 schema 有说明，所有 operation 的 summary/description 仍完整。
- `bun test --max-concurrency=1` 与 `bun run typecheck` 通过；真实 API 冒烟能完成一次聚合创建与聚合更新。
