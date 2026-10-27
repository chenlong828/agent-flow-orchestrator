---
layer: history
module: global
status: frozen
updated: 2026-10-27
---

# B1 组件规格、REST 契约与实施计划

> 范围：仅 B1。先做组件规格与 REST API 契约，再做表级数据库设计，最后复核契约、拆实现任务。用户 2026-10-24 直接要求实现，`T-B1-D05` 门据此通过；设计与实现均已完成，结果见 [`result.md`](result.md)。
> 输入：[`proposal.md`](proposal.md)、[`use-cases.md`](use-cases.md)、[`domain-objects.md`](domain-objects.md)、[`analysis.md`](analysis.md)。

## 1 本轮框定

> 以下“不做”是 2026-10-24 立计划时的设计阶段边界，保留作历史；实施阶段已按 §4 完成，实际交付见 [`result.md`](result.md)。

- **做**：把 B1 的组件边界、数据所有权、依赖与契约写成规格；输出完整 REST API 列表，供外部 HTTP 客户端按契约消费。
- **不做**：不写实现代码、不建表、不启服务、不改 UI；不做 B2/B3/B4；不新增 B1 之外的表/端点/依赖/组件。
- **需要你定**：先确认组件规格与 REST 契约；再逐表确认数据库设计；最后确认组件契约复核与实现任务拆分。

## 2 设计原则

1. **用例先行**：先回答「谁在什么情况下完成什么动作」。
2. **对象其次**：每个用例需要哪些领域对象、归属哪个聚合、有什么不变量。
3. **组件与契约再后**：每个组件一个主目标；外部契约只有 REST API；内部组件只通过公开契约交互。
4. **表设计随后**：逐表完成列、类型、约束、外键、索引、删除规则；不得改变已确认的 API 字段语义。
5. **确认后才编码**：D01～D05 全部确认后，才按用例 × 组件拆实现任务。
6. **两个独立项目**：`agent-flow-orchaster` 与 `agent-flow-ui` 互不进入对方项目改代码，只通过 REST 契约交互。

## 3 设计阶段与确认门

> 以下为设计阶段的流程记录；实施已完成，实际结果见 [`result.md`](result.md)。

| 阶段 | 任务 | 产出 | 确认后才可进入 |
|---|---|---|---|
| D01 | `T-B1-D01` 用例清单 | [`use-cases.md`](use-cases.md) | 对象清单定稿 |
| D02 | `T-B1-D02` 领域对象清单 | [`domain-objects.md`](domain-objects.md) | 组件规格与 REST 契约 |
| D03 | `T-B1-D03` 组件规格与 REST API | [`design/architecture.md`](../../../design/architecture.md) + 8 份组件规格 + REST API 列表 + [OpenAPI](../../../../src/components/http-gateway/openapi.yaml) | 表级数据库设计 |
| D04 | `T-B1-D04` 表级数据库设计 | 各组件规格的 `数据模型` 章节（列/约束/索引/删除） | 契约复核与任务拆分 |
| D05 | `T-B1-D05` 组件契约复核与任务拆分 | 组件卡复核、契约一致性检查、实现任务表 | 编码 |

### 3.1 `T-B1-D01` 用例清单

- 产出：[`use-cases.md`](use-cases.md)。
- 内容：6 个用例、参与者、主流程、失败路径、领域对象、验收出口。
- 出口：你确认「四类资产维护 + 装配 + 引用查询」的粒度；确认列表/详情随维护用例交付。
- 未确认前：不进入对象定稿。

### 3.2 `T-B1-D02` 领域对象清单

- 产出：[`domain-objects.md`](domain-objects.md)。
- 内容：4 个聚合根、9 个子实体、2 个关联实体、1 个参考数据；属性、关系、删除规则、不变量、只读投影。
- 出口：你确认对象拆分、聚合归属、16 张表清单与关键不变量。
- 未确认前：不进入组件规格定稿。

### 3.3 `T-B1-D03` 组件规格与 REST API

- 产出：
  - [`design/architecture.md`](../../../design/architecture.md)：组件地图、依赖规则、数据所有权、契约边界。
  - `design/components/{kernel,platform,harness,tool,skill,expert,catalog,http-gateway}/spec.md`。
  - `http-gateway` 规格中的 29 个 B1 业务端点 + `/healthz` 契约。
  - `http-gateway/openapi.yaml`：由上述契约导出的 OpenAPI 3.0 文档。
- 每个组件规格必须写清：
  - 一句话主目标、明确不负责的事。
  - 拥有的数据 / 唯一写入口。
  - 公共契约：方法表、输入/输出领域类型、错误、事务/并发语义。
  - 依赖与禁止依赖。
  - 验证入口与测试重点。
  - 预算与单独运行命令。
- REST 契约必须写清：方法、路径、查询参数、请求/响应 DTO、错误码、`If-Match`、分页、删除引用、UI 页面映射。
- OpenAPI 必须与 `spec.md` 的端点、DTO、错误、`If-Match` 一致；冲突以 `spec.md` 为准。
- 方法定义归组件规格；`http-gateway` 只保留端点、DTO 与「端点 → 组件方法」映射。
- 出口：你确认组件边界、单一主目标、数据所有权、REST API 字段与错误语义；外部 UI 若接入，可由该项目按 `spec.md` 与 `openapi.yaml` 做适配层/契约测试。
- 不做：不写路由/校验/仓储代码；不建表；不写迁移。

### 3.4 `T-B1-D04` 表级数据库设计

按聚合逐组设计、逐组确认；每张表独立一节，写入对应组件规格的 `数据模型` 章节。

| 组 | 表 | 确认点 |
|---|---|---|
| Harness | `harness`、`harness_tag` | 列/类型/默认值/唯一/CHECK/标签顺序/删除保护 |
| 工具 | `tool`、`tool_param` | Harness 外键/超时范围/参数顺序/状态默认 |
| Skill | `skill_category`、`skill`、`skill_tag`、`skill_trigger`、`skill_section`、`skill_pitfall`、`skill_ref` | 分类参考数据/五章/版本递增/有序子表/引用 |
| 专家 | `expert`、`expert_persona`、`expert_skill`、`expert_tool`、`expert_ref` | 五区/颜色/有序装配/关联唯一/删除规则 |

- 每张表写清：用途、所属聚合、列与类型、可空/默认、主键、外键、唯一约束、CHECK、索引、删除规则、对应不变量、验证用例。
- 表设计不得改变已确认的 REST DTO 字段语义；若必须改，回到 D03 改契约并重新确认。
- 出口：该聚合的表设计逐表确认；四组全部确认后才进入 D05。
- 不做：不在表设计阶段写仓储代码、不建表、不写迁移。

### 3.5 `T-B1-D05` 组件契约复核与任务拆分

- 复核：组件规格、数据模型、REST API 三者一致；每个组件仍只有一个主目标；依赖无环；数据所有权唯一。
- 确认 `ReferenceGuard` 端口方案：领域删除服务依赖端口，`catalog` 实现；不新增 L2 删除组件。
- 组件状态从 `planned` 进入实现准备；确认后才生成逐组件实现任务。
- 任务规则：一个实现任务只改一个组件，绑定一个用例；跨组件用例拆成多个任务；组件级 WIP=1。
- 出口：你确认复核结果与任务表；之后才编码。

## 4 实现阶段（D05 后才启动）

### 4.1 实现顺序

| 顺序 | 切片 | 主组件 | 说明 |
|---:|---|---|---|
| 1 | 共享契约 | `kernel` | 错误、分页、`ReferenceGuard`、时钟/ID 端口与契约测试 |
| 2 | 平台 | `platform` | 配置、DB/事务、迁移、健康检查、测试基座；先验证 `Bun.sql` |
| 3 | `UC-B1-01` Harness | `harness` | 聚合 + 列表/详情读模型 + HTTP 路由 |
| 4 | `UC-B1-02` 工具 | `tool` | 聚合 + 参数 + Harness 归属 |
| 5 | `UC-B1-03` Skill | `skill` | 聚合 + 五章/分类/引用 |
| 6 | `UC-B1-04` 专家 | `expert` | 聚合 + 五区 + 引用 |
| 7 | `UC-B1-05` 装配 | `expert` | 有序 Skill/工具整体替换 |
| 8 | `UC-B1-06` 引用查询 | `catalog` | 跨资产引用读模型 |
| 9 | 集成验收 | 全组件 | 种子、旅程、架构测试、`result.md` |

- 每个切片内部再拆「领域组件 / 读模型组件 / HTTP 网关」任务；同一组件串行。
- 列表/详情随维护用例交付；引用查询在最后一个读模型切片完成。

### 4.2 任务生成规则

- 任务 ID 在 D05 后按 `T-B1-I<序号><组件后缀>` 生成，不在设计阶段预设伪任务。
- 每个任务装载 ≤250k；单组件源码 + 规格 + 测试 ≤120k token。
- 每个任务开工前核对：组件规格、REST 契约、表设计、测试入口。

## 5 任务表（草案）

| ID | 类型 | 组件 | 状态 | 产出 |
|---|---|---|---|---|
| `T-B1-D01` | design | `global` | completed | [`use-cases.md`](use-cases.md) |
| `T-B1-D02` | design | `global` | completed | [`domain-objects.md`](domain-objects.md) |
| `T-B1-D03` | design | `global` | completed | 架构 + 8 份组件规格 + REST API + OpenAPI |
| `T-B1-D04` | design | 4 个聚合 | completed | 16 张表设计与 [`db/migrations/`](../../../../db/migrations) |
| `T-B1-D05` | design | `global` | completed | 契约复核与实现任务表 |
| `T-B1-I01` | change | `kernel` | completed | 共享契约与端口，含契约测试 |
| `T-B1-I02` | change | `platform` | completed | 平台骨架、迁移、健康检查与 `Bun.sql` 验证 |
| `T-B1-I03` | change | `harness` | completed | 聚合、读模型、7 个端点与测试 |
| `T-B1-I04` | change | `tool` | completed | 聚合、参数、6 个端点与测试 |
| `T-B1-I05` | change | `skill` | completed | 聚合、五章、8 个端点与测试 |
| `T-B1-I06` | change | `expert` | completed | 聚合、五区、6 个端点与测试 |
| `T-B1-I07` | change | `expert` | completed | 有序装配 2 个端点与测试 |
| `T-B1-I08` | change | `catalog` | completed | 列表/详情/引用读模型与 `ReferenceGuard` |
| `T-B1-I09` | verify | `global` | completed | 种子、旅程、架构测试、[`result.md`](result.md) |

> 实施时把原 `I03`～`I08` 的用例切片拆成逐组件任务；组件、用例与端点的对应关系见 [`brief.md`](brief.md) 任务表。

## 6 检查表

### 6.1 组件规格检查表

- frontmatter：`layer: design`、`status: current`、`component: CMP-*`。
- 一句话主目标；明确不负责的事。
- 数据所有权；是否唯一写入口。
- 公共契约：输入、输出、错误；不泄漏 SQL/HTTP/框架类型。
- 依赖与禁止依赖；无循环、无跨组件 store。
- 验证入口；单独运行命令（计划）。
- 预算；实现后核算。
- 外部契约：只有 `http-gateway` 暴露 REST。

### 6.2 REST API 检查表

- 端点回链用例；无 B1 之外端点。
- 请求/响应 DTO 字段、类型、必填、默认、范围。
- 错误码 400/404/409/428/500/503 的具体条件。
- `If-Match`、分页、筛选、排序。
- 删除引用列表与详情一致。
- UI 页面映射；字段名与 UI 夹具的差异由 UI 适配层处理。
- 契约版本与兼容性规则。

### 6.3 表设计检查表

- 表名、用途、所属聚合、唯一写入口。
- 列：名称、类型、可空、默认值、枚举/CHECK、长度/范围。
- 键：主键、外键、唯一约束、复合唯一、索引。
- 删除：`CASCADE` / `RESTRICT` / `SET NULL`，与对象清单一致。
- 不变量：数据库约束 + 服务规则 + 测试。
- 迁移：文件顺序、参考数据、只向前。
- 验证：每张表至少成功用例 + 约束失败用例。
- 与 REST DTO 字段语义一致；不一致时先改契约。

## 7 验收

### 7.1 设计验收

- D01：用例粒度、主流程、失败路径、对象映射确认。
- D02：对象拆分、聚合归属、关系、删除规则、不变量确认。
- D03：8 个组件规格齐全；每个一句话主目标；数据所有权唯一；REST API 29 个业务端点 + `/healthz` 完整；`openapi.yaml` 与 `spec.md` 一致；外部 UI 若接入可据此适配。
- D04：每张表列/约束/索引/删除规则完整，能直接落迁移；不改变 API 语义。
- D05：组件、数据模型、REST 契约一致；依赖无环；任务按组件拆分。

### 7.2 实现验收

- 四类资产 CRUD、Harness/Skill/专家启停、装配、引用查询可用；工具没有启停；重启后数据仍在。
- 契约测试覆盖成功、400、404、409、428；用例旅程绿。
- 架构测试：无跨组件 store 导入、无领域组件互调、`Bun.sql` 只在 `platform/db` 与 store、`http-gateway` 不碰 store、`catalog` 无写操作。
- 种子 5/10/12/8，关联边 23/23；`/healthz` 200/503。
- 无 B2/B3/B4 表/端点；无伪造状态。

## 8 风险与检查点

| # | 风险 / 未知 | 检查点 | 应对 |
|---|---|---|---|
| 1 | 组件职责混合 | D03/D05 | 一句话主目标；混合即拆 |
| 2 | REST 契约与外部消费方不一致 | D03 | 端点/DTO 表 + 外部 UI 页面映射；本仓库以契约测试为准 |
| 3 | 表设计改变 API 语义 | D04 | 先改契约再改表；不静默改字段 |
| 4 | 跨组件直接读表 | 每门 | 数据所有权 + 架构测试 |
| 5 | `Bun.sql` 能力不足 | I02 | 最小验证；不足时停下给选项 |
| 6 | 范围蔓延到后续批次 | 每门 | 按 §1/§2 停下确认 |

## 9 旧待定项的处理结果

1. **追溯方式**：按默认旁路执行，未补 `REQ`/`SCN`；`brief.md` + 本计划为锚点，实施结果见 [`result.md`](result.md)。
2. **类型检查**：已采用推荐项，加入 `typescript`、`@types/bun` devDependency 与 `bun run typecheck`；`tsc --noEmit` 通过。
3. **HTTP 默认**：按 HTTP JSON `/api/v1` 实现，行为以 [`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) 为准。

## 10 下一步（不在本工序）

- 外部 UI 若接入，由该项目按 [`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) 与 [`openapi.yaml`](../../../../src/components/http-gateway/openapi.yaml) 自行做适配层/契约测试。
- B2/B3/B4、ACP 执行模型与生产化事项另立工序，各自走确认门。
- 本工序结论与验证记录见 [`result.md`](result.md)。

## 11 实施结果摘要

- 交付：29 个 B1 业务端点 + `/healthz`，四类资产 CRUD/启停/装配/引用查询，16 张表迁移，5/10/12/8 演示种子与 23/23 装配边。
- 验证：`bun test --max-concurrency=1` 86 pass / 0 fail；`bun run typecheck` 通过；真实 PostgreSQL 上迁移重复执行幂等；`/healthz` 与四类资产列表冒烟通过。
- 偏差：种子把 UI 夹具中悬空的 `sk-smoke2` 映射到 `sk-replay` 以保持 12 个 Skill 和 23 条装配边；专家 `refCount` 按契约固定 0。
- 详细记录：[`result.md`](result.md)。
