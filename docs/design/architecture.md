---
layer: design
module: global
status: current
updated: 2026-10-25
---

# B1 架构与契约边界

> 范围：仅 B1 资产注册中心（Harness、工具、Skill、专家）。后续批次不在本文。
> 本文冻结组件边界、依赖方向、数据所有权与契约规则；列级数据库设计已落入 [`db/migrations/`](../../db/migrations/)。REST API 明细见 [`components/http-gateway/spec.md`](components/http-gateway/spec.md)，实施结果见 [`result.md`](../works/2026-10-24-db-backend-infra/result.md)。

## 1 结论

1. 一个 Bun 进程、一个 PostgreSQL 数据库、8 个组件：共享契约、运行时平台、四类资产、只读目录、HTTP 网关。
2. 外部契约只有 **REST API `/api/v1`**；`agent-flow-ui` 只按契约调用，不进入本项目改代码，本项目也不进入 UI 项目改代码。
3. 内部契约按同一原则逐层收窄：函数/类 → 组件 → 模块 → 进程/项目；每层只通过公开契约交互，不越过边界读写对方内部。
4. 每个组件只有一个主目标；数据只有一个写入口；读模型通过公开读契约组合。
5. 29 个 B1 业务端点 + `/healthz`；无 B1 之外的端点。

## 2 契约边界原则

| 层级 | 契约面 | 禁止 |
|---|---|---|
| 函数 / 类 | 公开方法签名、输入输出类型、错误 | 调用方依赖私有字段、内部辅助函数 |
| 组件 | `spec.md` 中的服务/读契约、数据所有权 | 跨组件导入 `store`、直接访问对方表、共享可变状态 |
| 模块 | 门面能力与事件 | 跨模块直接改数据、绕过门面 |
| 进程 / 项目 | REST API `/api/v1` | 跨项目改代码、跨项目共享源码/类型/数据库 |

### 2.1 两个独立项目

- `agent-flow-ui` 与 `agent-flow-orchaster` 是两个独立项目；**互不进入对方仓库改代码**。
- 唯一耦合是 REST API 契约：方法、路径、请求/响应字段、错误码、状态码、并发语义。
- 契约的权威版本在本项目 `components/http-gateway/spec.md`；UI 侧按此实现适配层或用它做契约测试。
- 本项目不读取 UI 源码、不依赖 UI 的 `MOCK` 结构；UI 也不依赖本项目的内部模块。
- 契约变更先改规格，再改实现，再通知 UI 侧；不允许先改代码后补契约。

### 2.2 项目内部组件

- 组件之间只通过公开契约交互；领域组件不互相调用写服务，不互相读表。
- 跨聚合读通过 `catalog` 的只读契约组合；跨聚合删除保护通过 `kernel` 的 `ReferenceGuard` 端口。
- `http-gateway` 只做协议翻译与错误映射，不承载业务规则；业务规则在领域组件。
- 数据只有一个写入口；其他组件只能读，不得写别人的表。
- 每个组件规格页只写自己的公共契约、数据所有权、依赖与验证；不写另一个组件的内部实现，不复制另一份契约。组件规格页之间只通过 `component` ID 和契约名引用。
- `kernel` 只定义共享契约词汇与端口，`platform` 只提供运行时基础设施；两者不合并成一个“core 组件”，避免一个组件同时承担两类变化轴。

## 3 组件地图

| 组件 | 一句话主目标 | 拥有的数据 | 依赖 |
|---|---|---|---|
| `CMP-kernel` | 定义共享错误、分页、引用检查端口、时钟与 ID 端口 | 无 | 无 |
| `CMP-platform` | 提供配置、数据库连接/事务、迁移、ID/时钟实现、健康检查与测试库 | `schema_migrations` | `kernel`、Bun、PostgreSQL |
| `CMP-harness` | 维护 Harness 聚合的生命周期、标签与不变量 | `harness`、`harness_tag` | `platform`、`kernel` |
| `CMP-tool` | 维护工具聚合、参数与 Harness 归属 | `tool`、`tool_param` | `platform`、`kernel` |
| `CMP-skill` | 维护 Skill 聚合、分类引用、五章、触发、踩坑与引用 | `skill_category`（只读种子）、`skill` 及其子表 | `platform`、`kernel` |
| `CMP-expert` | 维护专家聚合、五区、有序装配与引用 | `expert`、`expert_persona`、`expert_skill`、`expert_tool`、`expert_ref` | `platform`、`kernel` |
| `CMP-catalog` | 组合跨资产的列表/详情/引用只读投影，并实现 `ReferenceGuard` | 无 | 四类资产的公开读契约、`kernel` |
| `CMP-http-gateway` | 把 HTTP 请求翻译为用例调用并映射 DTO/错误 | 无 | `catalog`、四类资产写服务、`platform`（健康检查）、`kernel` |

组件 ID 与目录：`CMP-*` 对应 `docs/design/components/<short-name>/spec.md`；任务表可用去掉 `CMP-` 的简称。`kernel` 与 `platform` 是两个独立组件；物理目录可用 `src/core/{kernel,platform}` 收口，但 `core` 只是容器，不是组件。

## 4 依赖规则

```
http-gateway
  ├── catalog                   （读）
  ├── harness / tool / skill / expert（写）
  ├── platform                  （健康检查）
  └── kernel                    （错误类型）

catalog
  ├── harness / tool / skill / expert（公开读）
  └── kernel                    （Reference、错误、分页）

harness / tool / skill / expert
  ├── platform                  （Db、Clock、ID 实现）
  └── kernel                    （ReferenceGuard 端口、错误、分页）

platform
  └── kernel                    （共享契约类型）

kernel
  └── 无外部依赖
```

- 依赖方向只能向下：`http-gateway` → `catalog`/领域写服务/`platform`（健康检查）/`kernel`；`catalog` → 领域读契约/`kernel`；领域 → `platform`/`kernel`；`platform` → `kernel`；`kernel` → 无。
- 禁止：领域组件互相导入写服务或 store；`http-gateway` 直接导入 store；`catalog` 直接写表；循环依赖；同层横向写调用。
- `ReferenceGuard` 端口定义在 `kernel`，`catalog` 实现；领域删除服务只依赖端口，不依赖 `catalog` 类型。组合根负责注入。
- `catalog` 不拥有表，不执行写操作；只通过领域公开读契约读数据。
- `http-gateway` 不执行 SQL，不实现业务规则；只校验传输层形状、调用契约、映射错误。
- `main.ts` 只做组合根：加载 `kernel` 类型、创建 `platform`/领域/`catalog`/`http-gateway`，注入 `ReferenceGuard`；不承载业务规则，不计为组件。

## 5 数据所有权

| 组件 | 表 | 写入口 |
|---|---|---|
| `CMP-kernel` | 无 | 无，只定义类型与端口 |
| `CMP-platform` | `schema_migrations` | 迁移执行器 |
| `CMP-harness` | `harness`、`harness_tag` | Harness 服务 |
| `CMP-tool` | `tool`、`tool_param` | 工具服务 |
| `CMP-skill` | `skill_category`（种子只读）、`skill`、`skill_tag`、`skill_trigger`、`skill_section`、`skill_pitfall`、`skill_ref` | Skill 服务 |
| `CMP-expert` | `expert`、`expert_persona`、`expert_skill`、`expert_tool`、`expert_ref` | 专家服务 |
| `CMP-catalog` | 无 | 无，只读组合 |
| `CMP-http-gateway` | 无 | 无，只做协议翻译 |

- 引用计数、`toolCount`、`usedByCount`、`refCount` 不落可写列。
- 删除规则与不变量见各组件规格的「拥有的数据」章节；列级外键与索引在 `T-B1-D04` 补。
- 跨聚合引用检查：`ReferenceGuard.check(owner, id)` 返回引用方列表；领域删除服务在删除前调用，非空则抛 `ReferencedError`。

## 6 外部 REST 契约

- 基础路径：`/api/v1`；健康检查：`/healthz`（不在 `/api/v1` 下）。
- 29 个 B1 业务端点：Harness 7、工具 6、Skill 8、专家 8。
- 契约明细：方法、路径、查询参数、请求/响应 DTO、错误码、并发头、删除引用列表，全部在 [`components/http-gateway/spec.md`](components/http-gateway/spec.md)。
- UI 页面映射：Harness 页、工具页、Skill 页、专家页；无 Key/工作区/工作流/实例/看板端点。
- 契约验证：UI 侧按端点表与 DTO 表写适配层/契约测试；本项目用 HTTP 契约测试与用例旅程验证同一份契约。

## 7 内部契约

- 领域组件对外暴露服务契约与只读契约；类型用领域词汇，不暴露 SQL、`Bun.sql`、HTTP 类型。
- 方法定义在各组件 `spec.md`；`http-gateway` 的 DTO 只是传输形状，不是领域方法或领域类型的定义来源。
- `catalog` 对外暴露读模型契约；不暴露领域内部类型。
- `http-gateway` 对外暴露 REST DTO；不把领域实体直接序列化，避免内部字段泄漏。
- 错误按层映射：领域错误（`ValidationError`、`NotFoundError`、`NameConflictError`、`RevisionConflictError`、`ReferencedError`、`PreconditionRequiredError`）→ HTTP 错误码；`http-gateway` 不解析数据库错误文本。
- 契约中只出现稳定概念；数据库列名、索引名、迁移文件名不进 REST DTO。

## 8 契约变更流程

1. 先改对应 `spec.md`（组件契约或 REST API）。
2. 评估是否破坏兼容：删除/重命名字段、改变语义、新增必填字段 = 破坏性变更，需 `/api/v2` 或明确迁移窗口。
3. 实现与测试按新规格更新；旧契约在迁移窗口内保留。
4. UI 侧按新规格适配；本项目不改 UI 代码，UI 也不改本项目代码。
5. 变更记录写入 `docs/history/decisions/`（结构性变更）或工序 `brief/result`（局部变更）。

## 9 验证

- **架构测试**：无跨组件 store 导入；无领域组件互调；`Bun.sql` 只在 `platform/db` 与 store；无循环依赖；`http-gateway` 不碰 store；`catalog` 无写操作；`kernel` 不导入运行时组件。
- **组件测试**：每个组件能只加载自身源码 + 规格 + 测试运行验证命令。
- **契约测试**：HTTP 端点按 `http-gateway/spec.md` 的 3 正 1 反验证；错误码、字段、分页、`If-Match`、引用列表。
- **项目边界检查**：仓库内不出现 `agent-flow-ui` 的源码导入；不出现跨项目相对路径依赖；UI 侧只通过 HTTP 契约验证。
- **预算**：单组件源码 + 规格 + 测试 ≤120k token；单任务装载 ≤250k；实现后核算。

## 10 实施状态与下一步

- `T-B1-D04` 已完成：16 张业务表落入 [`db/migrations/`](../../db/migrations/)，未改变本文与 REST DTO 的字段语义。
- `ReferenceGuard` 已按端口方案实现：端口在 `kernel`，由 `catalog` 实现，领域删除服务经组合根注入；未新增 L2 删除组件。
- REST API 已按 [`http-gateway/spec.md`](components/http-gateway/spec.md) 实现，待 `agent-flow-ui` 侧按契约印证；UI 反馈只改契约，不跨项目改代码。
- 组件状态均为 `current`；实现与验证结果见 [`result.md`](../works/2026-10-24-db-backend-infra/result.md)。
