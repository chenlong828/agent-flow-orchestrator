---
layer: works
module: global
status: active
updated: 2026-10-26
---

# Skill 契约 v2：description 合并与全文文档输出

## 需求与背景

- 用户的判断：skill 的数据要分两个面——**给人看、方便管理**的，与**给 orchestrator 用、组装 skill** 的；现在两者混在同一份 DTO 里，而编排侧缺"一份完整 skill 文本"。
- 现状：`summary`（≤200 字简介）与 `triggers`（有序关键词）各承担一半"何时用"；服务端 `q` 只搜 `name`（[store.ts:56-59](../../../src/components/skill/store.ts#L56-L59)）。正文拆在五章 + 踩坑 + 引用，没有任何端点输出完整文本，拼接顺序只写在代码常量 `SECTION_KINDS`（[service.ts:43](../../../src/components/skill/service.ts#L43)）。
- 决定：`summary` 与 `triggers` 二合一，以路由（trigger）语义为主；新增 skill 全文文档输出。

## 范围

本轮做：

- `description` 取代 `summary` 与 `triggers`，1–400 字，语义为"何时使用 / 何时不适用"。
- 列表、详情、创建/更新 DTO 同步换字段；`q` 覆盖 `name` 与 `description`。
- 新增 `GET /api/v1/skills/{id}/document`，输出 `text/markdown`（frontmatter + 五章 + 踩坑 + 引用）。
- 迁移 `0005`：新增 `skill.description`、回填、删 `skill.summary`、删 `skill_trigger`。
- 规格同步：`skill`、`catalog`、`http-gateway` 三份。

本轮不做（理由见提案第 9 节）：

- 五章、踩坑、引用的存储收敛——子表保留，契约层先与存储解耦。
- `version` 与 `revision` 合并、批量文档导出、`/api/v2` 路径版本化。
- 不涉及展示端仓库与展示形态（tab、抽屉布局等）；跨项目只按 REST 契约交互，本仓库只提供数据。

## 定级与确认门

**P1**：破坏性公共契约（删字段、删表）+ schema 变更 + 跨项目消费方。

- 人参与契约定义：2026-10-26 已确认（见确认记录），契约冻结。
- P1 门已通过，可进入实现；编码阶段不再改契约。

## 验收标准

- 契约：OpenAPI 与三份组件规格不再出现 `summary` / `triggers`；请求带这两个字段返回 400。
- 数据：迁移后 `description` 由原 `summary`（+ 触发词）回填，长度 1–400；`skill_trigger` 表不存在。
- 文档端点：完整文档、空踩坑/引用整节省略、`If-None-Match` 命中 304、资产不存在 404。
- 测试：`bun test tests/components/skill tests/components/http-gateway` 全绿；`bun run typecheck` 通过。

## 任务表

| ID | 类型 | 组件 | 状态 | 装载清单 |
|---|---|---|---|---|
| T-SK2-01 | design | global | done | 本文件、[contract-proposal.md](contract-proposal.md)、三份组件规格 |
| T-SK2-02 | change | skill | done | skill 规格、`src/components/skill/*`、`db/migrations/0005*`、`tests/components/skill/*` |
| T-SK2-03 | change | catalog | done | catalog 规格、`src/components/catalog/index.ts` |
| T-SK2-04 | change | http-gateway | done | http-gateway 规格、`src/components/http-gateway/*`、`openapi.yaml`、`tests/components/http-gateway/skill.test.ts` |
| T-SK2-05 | verify | global | done | 全量契约测试、OpenAPI 与规格逐项核对 |

## 领取的开放问题

无。三条确认已落在提案第 10 节，不单开 OQ。

## 确认记录

- 2026-10-26：`description` 上限 **400** 字。
- 2026-10-26：消费端字段调整无阻塞；本仓库只负责契约与数据，不规定展示端实现。
- 2026-10-26：详情抽屉以 tab 展示全文属展示端决策，后台只提供文档数据。
