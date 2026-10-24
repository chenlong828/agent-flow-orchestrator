---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# 控制面 B1 资产注册中心（用例驱动设计 + 实施）

## 背景

- `agent-flow-ui` 有 12 个页面、11 个 `CMP-*` 的高保真原型，数据来自 `assets/js/mock-data.js`（内存夹具，刷新复位），没有后端。
- 本项目 D0 已定 Bun + PostgreSQL；本地 PG 18.4（端口 54329）与 Bun 1.4.4 已就绪，`scripts/pg.sh` 负责启停。
- 用户 2026-10-24 确认：首批只做 **B1 资产注册中心**；先设计、后编码。
- 本工序没有对应 `REQ-xxxx`，属于控制面持久化的基础设施工序；默认按旁路处理，追溯方式见下。

## 范围（仅 B1）

- **聚合**：Harness、工具、Skill、专家。
- **表**：16 张业务表（`schema_migrations` 是基础设施表，不计入）。
- **用例**：6 个——维护 Harness、维护工具、维护 Skill、维护专家、装配专家、查询引用关系。
- **不做**：B2 Key/工作区、B3 工作流、B4 实例/看板、UI、鉴权、外部系统调用、运行时状态推进。
- B2/B3/B4 不在本批，本文与 `proposal.md` 都不展开其设计。

## 已确认（2026-10-24）

- 首批范围：只做 B1。
- 采用推荐默认：模块化单体、Bun + PG、HTTP JSON `/api/v1`（工作假设）、UUIDv7、英文状态码、无鉴权仅本机、API-first（UI 后接）。
- 设计输入：[`analysis.md`](analysis.md)、[`use-cases.md`](use-cases.md)、[`domain-objects.md`](domain-objects.md)。
- 设计提议：[`proposal.md`](proposal.md)；设计与实施计划：[`implementation-plan.md`](implementation-plan.md)。
- 2026-10-24 实施授权：用户直接要求按当前 spec 分步实现 API；据此把 `T-B1-D05` 契约复核门视为通过，不再等待逐项书面确认。

## 设计优先：确认门

1. `T-B1-D01` 用例清单 → [`use-cases.md`](use-cases.md)（已完成）。
2. `T-B1-D02` 领域对象清单 → [`domain-objects.md`](domain-objects.md)（已完成）。
3. `T-B1-D03` 组件规格与 REST API → [`design/architecture.md`](../../design/architecture.md) + 8 份组件规格 + REST API 列表 + [OpenAPI](../../design/components/http-gateway/openapi.yaml)（已完成）；UI 侧仍按契约印证。
4. `T-B1-D04` 表级数据库设计：按 Harness → 工具 → Skill → 专家逐聚合，逐表设计（已完成并落入迁移）。
5. `T-B1-D05` 组件契约复核与任务拆分（已完成）：用户直接要求实现，视为通过该门。
6. 实现已按「用例 × 组件」切片完成，验证结果见 [`result.md`](result.md)。

设计门的历史规则“未确认前不写实现代码”不再适用于本工序；后续批次仍按各自工序的门禁执行。

## 已完成

1. UI 页面操作、实体关系、纯 DB 边界分析 → [`analysis.md`](analysis.md)。
2. B1 设计提议（仅 B1）→ [`proposal.md`](proposal.md)。
3. 用例清单草案 → [`use-cases.md`](use-cases.md)。
4. 数据领域对象清单草案 → [`domain-objects.md`](domain-objects.md)。
5. 组件规格与 REST API 契约 → [`design/architecture.md`](../../design/architecture.md)、[`design/components/http-gateway/spec.md`](../../design/components/http-gateway/spec.md)、[`openapi.yaml`](../../design/components/http-gateway/openapi.yaml)。
6. 设计/实施计划 → [`implementation-plan.md`](implementation-plan.md)。
7. kernel / platform / 16 张表迁移 → `src/core/`、`db/migrations/`。
8. 四类资产领域、catalog 读模型、HTTP 网关与组合根 → `src/components/`、`src/main.ts`。
9. 种子、契约/旅程/架构测试 → `scripts/seed.ts`、`tests/`；结果见 [`result.md`](result.md)。

## 下一步（不在本工序）

1. 把 [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) 与 [`openapi.yaml`](../../design/components/http-gateway/openapi.yaml) 交给 `agent-flow-ui` 侧按契约印证；UI 接入与适配层是另一个项目的工作。
2. B2/B3/B4（Key/工作区、工作流、实例/看板）与 ACP 执行模型另立工序，按各自改动级别走确认门。
3. 生产化事项（鉴权、CORS、限流、容量、SLA、故障演练）未定，不在 B1 结果内。

## 不做什么

- 不写 B2/B3/B4 的表、端点、模块；不做 Key/工作区/工作流/实例。
- 不做登录/鉴权、多租户、CI/CD、生产容量与 SLA。
- 不做 UI 改造、CORS、前端适配层；OpenAPI 只作为 REST 契约的机器可读导出，不做 Swagger UI 部署。
- 不做 git 连通性、Key 校验、工具调试、Harness 心跳、工作区初始化。
- 不做实例状态推进、评审/确认、重跑/重试、看板。
- 不新增 B1 用例与对象清单之外的依赖、表、字段、端点、组件；确需新增时先停下确认。
- 不伪造运行时状态（新 Harness `unknown`、新工具 `unverified`）。

## 验收标准

### 用例与对象（D01/D02）

- 6 个用例的主流程、失败路径、领域对象、验收出口明确；列表/详情归属清楚。
- 4 个聚合、16 张表、关系与删除规则、关键不变量、只读投影明确。
- 待确认项显式列出，不以假设替代确认。

### 组件规格与 REST API（D03）

- 8 个组件规格齐全；每个一句话主目标、数据所有权、公共契约、依赖与禁止依赖、验证入口、预算、单独运行命令。
- `http-gateway` 导出 `openapi.yaml`，端点、DTO、错误、`If-Match` 与 `spec.md` 一致。
- 方法契约与领域输入/输出类型在各组件规格；`http-gateway` 的 DTO 不承担方法定义，只保留端点映射。
- 29 个 B1 业务端点 + `/healthz`；每个端点回链用例；DTO、错误码、分页/筛选、`If-Match`、删除引用、UI 页面映射明确。
- 两个独立项目只通过 REST 契约交互；无跨项目源码/类型/数据库依赖。
- 不出现 B2/B3/B4 端点。

### 表级数据库设计（D04）

- 每张表写清列/类型/可空/默认、主键、外键、唯一/CHECK、索引、删除规则、对应不变量。
- 每张表至少一条成功用例 + 一条约束失败用例。
- 按聚合确认；未确认的聚合不进入契约复核。
- 不得改变已确认的 REST DTO 字段语义；不一致时先改契约再改表。

### 组件契约复核（D05）

- 每个组件能用一句话说清主目标；混合职责即拆分。
- 组件地图、依赖矩阵、数据所有权、契约、验证入口、预算、单独运行命令齐全。
- 组件、表设计、REST 契约三者一致；REST 字段语义未被表设计静默改变。
- 无领域组件互调、无跨模块 store 导入、`Bun.sql` 只在 `platform/db` 与 store。

### 实现（D05 后另列任务）

- 四类资产 CRUD、Harness/Skill/专家启停、装配、引用查询可用；工具没有启停；重启后数据仍在。
- 契约测试覆盖成功、400、404、409、428；旅程测试绿。
- 种子 5/10/12/8，关联边 23/23；`/healthz` 200/503。
- 无 B2/B3/B4 表/端点；无伪造状态。

## 任务表

| ID | 类型 | 组件 | 状态 | 装载清单 | 产出 |
|---|---|---|---|---|---|
| `T-DB-01` | design | `global` | completed | UI 页面与夹具 | [`analysis.md`](analysis.md) |
| `T-DB-02` | design | `global` | completed | `analysis`、UI 规格 | [`proposal.md`](proposal.md) |
| `T-DB-03` | design | `global` | completed | `proposal` §10 | 用户确认 B1；[`implementation-plan.md`](implementation-plan.md) |
| `T-B1-D01` | design | `global` | completed | `analysis`、`proposal`、`use-cases` | [`use-cases.md`](use-cases.md) |
| `T-B1-D02` | design | `global` | completed | `use-cases`、`analysis`、UI 规格 | [`domain-objects.md`](domain-objects.md) |
| `T-B1-D03` | design | `global` | completed | `domain-objects`、`proposal` §6/§7、UI 规格 | 8 份组件规格 + REST API + OpenAPI |
| `T-B1-D04` | design | 4 个聚合 | completed | `design/components/*`、`domain-objects`、REST 契约 | 16 张表设计与 `db/migrations/` |
| `T-B1-D05` | design | `global` | completed | 8 份组件规格、REST 契约、表设计 | 契约复核与实现任务表 |
| `T-B1-I01` | change | `kernel` | completed | 设计文档、`implementation-plan` §4 | 共享错误/分页/端口契约与测试 |
| `T-B1-I02` | change | `platform` | completed | 设计文档、`implementation-plan` §4 | 平台骨架、迁移、健康检查、测试基座 |
| `T-B1-I03` | change | `harness` | completed | Harness 规格、REST 契约、表设计 | 聚合、读模型、7 个端点与测试 |
| `T-B1-I04` | change | `tool` | completed | 工具规格、REST 契约、表设计 | 聚合、参数、6 个端点与测试 |
| `T-B1-I05` | change | `skill` | completed | Skill 规格、REST 契约、表设计 | 聚合、五章、8 个端点与测试 |
| `T-B1-I06` | change | `expert` | completed | 专家规格、REST 契约、表设计 | 聚合、五区、6 个端点与测试 |
| `T-B1-I07` | change | `expert` | completed | 装配契约、专家规格 | 有序装配 2 个端点与测试 |
| `T-B1-I08` | change | `catalog` | completed | 目录规格、引用契约 | 列表/详情/引用读模型与 `ReferenceGuard` |
| `T-B1-I09` | verify | `global` | completed | 全部规格、`fixtures` | 种子、旅程、架构测试、[`result.md`](result.md) |

## 追溯方式

- B1 是基础设施工序：不改 UI，`OQ-2` 未裁定，**默认按旁路处理**：不建 `REQ`/`SCN`，`brief.md` + `implementation-plan.md` 为锚点；若你要求追溯，先补 `REQ`/`SCN` 再开工。
- commit 绑定 `T-B1-Dxx` / `T-B1-Ixx` 与本工单目录；默认不绑定 `SCN`，不伪造场景 ID。
- 若 `OQ-2` 后续裁定 UI 为需求来源，再为之后的批次补 `REQ`/`SCN`，不回写历史 commit。

## 领取的开放问题

| 编号 | 与本工序的关系 | 本工序的处理 |
|---|---|---|
| `OQ-2` | UI 是否是需求来源与验收蓝本 | 按用户指令把 UI 当作数据契约与界面行为参考；正式裁定仍待确认 |
| `OQ-3` | 对外形态与契约归属 | B1 按 HTTP JSON `/api/v1` 工作假设推进；路由层可替换，正式裁定仍待定 |
| `OQ-4` | 首个交付范围 | **部分解决（2026-10-24）**：先做 B1；M4 端到端业务流仍待 `OQ-2` 裁定后另选 |

## 定级与门禁

- 定级：**P1**。触发项：新增业务模块、核心 schema、数据所有权、公共契约与分层依赖。
- B1 范围已确认；D01～D05 已完成。用户 2026-10-24 直接要求实现，D05 门据此通过；实现与验证结果见 [`result.md`](result.md)。
- `T-B1-I02` 已先验证 `Bun.sql` 事务、动态 SQL 与错误映射；实现继续使用 `Bun.sql`，未更换驱动。
- 已确认的既有决策：D0（Bun + PostgreSQL）；执行模型 D1–D11 见 `docs/works/2026-10-24-agentflow-execution-concept/concept-design.md`，本工序不重复裁定。
