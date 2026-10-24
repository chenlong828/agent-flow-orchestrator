---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# B1 资产注册中心设计提议

> 范围：**仅 B1**。后续批次不在本批，本文不展开。
> 输入：[`analysis.md`](analysis.md)、[`use-cases.md`](use-cases.md)、[`domain-objects.md`](domain-objects.md)。
> 方式：用例 → 领域对象 → 组件规格与 REST 契约 → 表级数据库设计 → 契约复核 → 编码。实施时用户直接要求按当前 spec 实现，`T-B1-D05` 门据此通过；结果见 [`result.md`](result.md)。

## 1 结论

1. **B1 范围**：Harness、工具、Skill、专家四个聚合，16 张业务表，6 个用例，29 个业务端点 + `/healthz`。
2. **形态**：一个 Bun 进程内的模块化单体 + 一个 PostgreSQL 数据库；HTTP JSON `/api/v1`。2026-10-25 已确认对外仅提供 HTTP API，不提供 CLI、库或 UI；UI 为独立项目，契约由本仓库维护。
3. **设计顺序**：先确认用例与领域对象，再确认组件规格与 REST 契约，再逐聚合做表级数据库设计，最后复核契约与任务。REST 契约先冻结，供 `agent-flow-ui` 按契约印证。
4. **组件原则**：每个组件只承担一个主目标；读组合与 HTTP 交付分开，不把「查询拼装 + 路由 + 业务规则」混在一个组件里。
5. **不做**：B1 之外的批次、UI、鉴权、外部系统调用、运行时状态推进。

## 2 目标与非目标

### 2.1 目标

- 把 B1 四类资产的登记、维护、装配、引用关系落成可持久化、可验证的后端能力。
- 先完成设计闭环：用例、对象、表、API、组件逐一确认，再编码。
- 建立可复用的控制面骨架：配置、数据库连接/事务、迁移、错误模型、HTTP 交付、测试基座。
- 每个聚合有唯一写入口；每个组件有一句话可命名的主目标；每个契约有独立验证入口。

### 2.2 非目标

- B1 之外的表、端点、组件或设计细节。
- 登录、鉴权、多租户、审计合规、CI/CD、生产容量与 SLA。
- UI 改造、CORS、前端适配层；OpenAPI 只作为 REST 契约的机器可读导出，不做 Swagger UI 部署。
- 外部系统调用与运行时状态推进（git/SSH、模型供应商校验、工具执行、心跳、实例状态等）。
- 伪造运行时状态；新数据保持 `unknown` / `unverified`。

## 3 设计方法

### 3.1 为什么改为用例驱动

原计划按「平台 → Harness → 工具 → Skill → 专家 → API」模块推进，容易在用例边界未确认时就开始拆实现。改为：

1. 先列 B1 用例：谁在什么情况下完成什么动作。
2. 再列数据领域对象：这些用例需要哪些对象、归属哪个聚合、有什么不变量。
3. 再定组件规格与 REST 契约：每个组件一个主目标，外部契约只有 `/api/v1`；UI 侧按契约印证。
4. 再逐聚合做表级数据库设计：列、约束、外键、索引、删除规则；不改变已确认的 DTO 语义。
5. 再复核组件、数据模型、REST 契约一致，按用例 × 组件拆实现任务。
6. 最后编码与验收。

### 3.2 确认门

| 门 | 产出 | 确认后才可进入 |
|---|---|---|
| `T-B1-D01` 用例清单 | [`use-cases.md`](use-cases.md) | 领域对象定稿 |
| `T-B1-D02` 领域对象清单 | [`domain-objects.md`](domain-objects.md) | 组件规格与 REST 契约 |
| `T-B1-D03` 组件规格与 REST API | [`design/architecture.md`](../../design/architecture.md) + 8 份组件规格 + REST API 列表 + [OpenAPI](../../design/components/http-gateway/openapi.yaml) | 表级数据库设计 |
| `T-B1-D04` 表级数据库设计 | 各组件规格的 `数据模型` 章节（列/约束/索引/删除） | 契约复核与任务拆分 |
| `T-B1-D05` 组件契约复核与任务拆分 | 组件卡复核、契约一致性检查、实现任务表 | 编码 |

- 每个门都可以按聚合或按用例分批确认；未确认的部分不进入下一步。
- 任何新增表、字段、端点、依赖、组件都回到对应用例与对象清单，先说明理由再确认。

## 4 B1 用例与对象

### 4.1 用例

| ID | 用例 | 领域对象 | 说明 |
|---|---|---|---|
| `UC-B1-01` | 维护 Harness | `OBJ-01`、`OBJ-02` | 列表/详情/创建/更新/启停/删除 |
| `UC-B1-02` | 维护工具 | `OBJ-03`、`OBJ-04`、`OBJ-01` | 参数整体替换；归属 Harness；无启停 |
| `UC-B1-03` | 维护 Skill | `OBJ-05`～`OBJ-11` | 分类、五章、标签、触发、踩坑、引用 |
| `UC-B1-04` | 维护专家 | `OBJ-12`、`OBJ-13`、`OBJ-16` | 五区、启停、删除 |
| `UC-B1-05` | 装配专家 | `OBJ-14`、`OBJ-15` | 有序 Skill/工具整体替换 |
| `UC-B1-06` | 查询引用关系 | `OBJ-14`、`OBJ-15` + 资产 | 专家/工具/引用计数 |

用例卡、主流程、失败路径与验收见 [`use-cases.md`](use-cases.md)。

### 4.2 对象

- 4 个聚合根：Harness、工具、Skill、专家。
- 9 个子实体、2 个关联实体、1 个参考数据，共 16 张表。
- 只读投影 4 个，不落表；派生计数不落可写列。
- 对象属性、关系、删除规则与不变量见 [`domain-objects.md`](domain-objects.md)。

## 5 数据设计原则

| 项 | 约定 |
|---|---|
| 主键 | `uuid`，应用侧 `Bun.randomUUIDv7()`；API 用同一 ID |
| 并发 | 聚合根带 `revision`；更新用 `WHERE id=$1 AND revision=$2`；0 行即冲突 |
| 时间 | `timestamptz`，UTC 存储，API 返回 ISO-8601 |
| 人 | `created_by` / `updated_by` 可空文本；首期取 `X-Actor` 或 `DEV_ACTOR`，不是鉴权 |
| 枚举 | `text + CHECK`，存稳定英文代码；中文标签只在 DTO 层映射 |
| 删除 | 聚合根硬删除；子表级联；被引用时 409 + 引用列表 |
| 计数 | `usedByCount` / `refCount` / `toolCount` 查询时聚合，不建可写列 |
| 命名 | 表/列 `snake_case`；API/TypeScript 用 `camelCase`；名称唯一性用 `lower(name)` |
| 状态诚实 | 新 Harness `health=unknown`；新工具 `status=unverified`；B1 不提供伪造入口 |

**表归属（唯一写入口）**：

| 聚合 | 表 |
|---|---|
| Harness | `harness`、`harness_tag` |
| 工具 | `tool`、`tool_param` |
| Skill | `skill_category`、`skill`、`skill_tag`、`skill_trigger`、`skill_section`、`skill_pitfall`、`skill_ref` |
| 专家 | `expert`、`expert_persona`、`expert_skill`、`expert_tool`、`expert_ref` |
| 平台 | `schema_migrations`（基础设施，不计入 16 张业务表） |

组件规格与 REST 契约在 `T-B1-D03` 冻结；表级数据库设计在 `T-B1-D04` 逐聚合完成；本文不冻结列类型、索引与 DDL。

## 6 API 设计原则

- 前缀 `/api/v1`；JSON、UTF-8；字段 `camelCase`；时间 ISO-8601。
- 列表：`q`、类型相关筛选、`limit`（默认 50，上限 200）、`offset`、`sort`；返回 `{items,total,limit,offset}`。
- 单资源：直接返回对象。
- 更新：`PUT` 全量、`PATCH` 局部；要求 `If-Match: "<revision>"`；缺失 428，不匹配 409。
- 创建：`POST` 返回 201 + `Location`；ID 服务端生成。
- 删除：`DELETE`；被引用 409 + 引用列表；不存在 404。
- 错误体统一为 `{error:{code,message,details,requestId}}`；B1 错误码：`validation_error`(400)、`not_found`(404)、`name_conflict`(409)、`referenced`(409)、`revision_conflict`(409)、`precondition_required`(428)、`internal`(500)、`service_unavailable`(503)。
- 端点按用例分组；请求/响应 DTO、筛选字段、错误细节在 `T-B1-D03` 的 [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) 冻结并确认，UI 侧按此契约印证；机器可读版本见 [`openapi.yaml`](../../design/components/http-gateway/openapi.yaml)。
- B1 不提供心跳、调试、验证、标记可用等入口；不提供 B1 之外的端点。

## 7 组件化原则

**每个组件只承担一个主目标**，能用一句话说清「负责 X，不负责 Y」。外部与 `agent-flow-ui` 互不进入对方项目，只通过 REST 契约；内部组件、模块、函数也按同一原则只通过公开契约交互。草案：

| 组件 | 主目标（一句话） | 拥有的数据 | 不负责 |
|---|---|---|---|
| `CMP-kernel` | 定义共享错误、分页、引用检查端口、时钟与 ID 端口 | 无 | 业务规则、数据库、HTTP |
| `CMP-platform` | 提供配置、数据库连接/事务、迁移、ID/时钟与测试库 | `schema_migrations` | 业务规则、HTTP 路由 |
| `CMP-harness` | 维护 Harness 聚合的生命周期、标签与不变量 | `harness*` | 工具装配、健康推进 |
| `CMP-tool` | 维护工具聚合、参数与 Harness 归属 | `tool*` | 调试执行、状态推进 |
| `CMP-skill` | 维护 Skill 聚合、分类、章节、触发、踩坑与引用 | `skill*` | 专家装配、版本历史 |
| `CMP-expert` | 维护专家聚合、五区、有序装配与引用 | `expert*` | 工作流节点、引用计数存储 |
| `CMP-catalog` | 组合跨资产的列表/详情/引用只读投影 | 无 | 写操作、业务规则 |
| `CMP-http-gateway` | 把 HTTP 请求翻译为用例调用并映射 DTO/错误 | 无 | 业务规则、SQL |

- 不把读组合与 HTTP 交付合并成一个组件；拆为 `catalog` 与 `http-gateway`，各自单一主目标。
- 组件依赖方向：`http-gateway` → `catalog` / 领域组件 / `platform`（健康检查）/ `kernel`；`catalog` → 领域只读契约 / `kernel`；领域组件 → `platform` / `kernel`；`platform` → `kernel`；禁止领域组件之间横向写调用。
- 跨聚合引用检查通过 `ReferenceGuard` 端口，由 `catalog` 实现；领域组件不读别人的表，`http-gateway` 不承载删除规则。
- 组件 ID、依赖矩阵、数据所有权、验证计划与 REST 契约在 `T-B1-D03` 输出；`T-B1-D05` 只做一致性复核与任务拆分。

## 8 工程、迁移与验证

- Bun 1.4.4 + PostgreSQL 18.4；`.local/pg/bin` 没有 `psql/createdb/pg_dump`，建库、迁移、查数据都走 Bun。
- 迁移按聚合拆文件；`schema_migrations(version,checksum,applied_at)`；advisory lock；只向前。
- 种子从 `agent-flow-ui@9a0ae35` 一次性转换；运行时不依赖 `agent-flow-ui`；目标 5/10/12/8，关联边 23/23。
- 测试分层：规则单测、store 测试、HTTP 契约测试、用例旅程、架构测试、种子测试、健康检查。
- 测试库每进程独立；先串行；测试间清表。
- 架构测试守住：无跨模块 store 导入、无领域组件互调、`Bun.sql` 只在 `platform/db` 与 store、无循环依赖、`http-gateway` 不直接碰 store。
- 具体测试用例在 REST 契约确认后补齐；验收以用例卡与 API 契约的具体值为准，不用存在性断言充数。

## 9 风险与待定

| # | 风险 / 未知 | 应对 |
|---|---|---|
| R1 | `Bun.sql` 事务/动态 SQL/错误映射未验证 | `T-B1-I02` 开头做最小验证；不足时停下给选项，不静默换驱动 |
| R2 | UI 夹具字段漂移 | 以用例与对象清单为准；种子固定 UI commit；REST 契约中明确字段映射 |
| R3 | 状态诚实与演示期望冲突 | 种子可写演示值并标注；新数据保持 `unknown/unverified` |
| R4 | 没有 `psql` / `createdb` / `pg_dump` | 引导脚本 + 迁移执行器；备份工具不在本批 |
| R5 | 测试库并发污染 | 每进程独立库 + 串行；稳定后再优化 |
| R6 | 用例/对象确认后仍改契约 | 变更回到对应用例与对象清单，重新确认；不直接改代码 |
| R7 | `OQ-2` / `OQ-3` 早期推断 | 2026-10-25 已关闭归档：仅 HTTP API，无 CLI/库/UI；UI 为独立项目，见[归档记录](../../history/decisions/2026-10-25-project-boundary-and-open-questions.md) |

## 10 确认状态

- 2026-10-24：用户确认首批只做 **B1**；后续批次不在本批。
- 用户 2026-10-24 直接要求按当前 spec 分步实现 API，`T-B1-D05` 门据此通过；D01～D05 设计按本提议落地，未再逐项书面确认。
- 表级数据库设计、契约复核与编码均已完成；结果见 [`result.md`](result.md)。
- 外部契约：29 个 B1 业务端点 + `/healthz`，见 [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)。
