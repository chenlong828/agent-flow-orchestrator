---
layer: design
module: global
status: current
updated: 2026-10-29
---

# B1+B3 架构与契约边界

> 范围：B1 资产注册中心（Harness、工具、Skill、专家）+ B3 工作流定义。B4 实例/运行不在本文。
> 本文冻结组件边界、依赖方向、数据所有权与契约规则；列级数据库设计已落入 [`db/migrations/`](../../db/migrations/)。REST API 明细见 [`components/http-gateway/spec.md`](components/http-gateway/spec.md)，实施结果见 [`result.md`](../history/works/2026-10-24-db-backend-infra/result.md)（归档件，仅作追溯）。

## 1 结论

1. 一个 Bun 进程、一个 PostgreSQL 数据库、10 个组件：共享契约、启动配置、运行时平台、四类资产、工作流定义、只读目录、HTTP 网关。
2. 外部契约只有 **REST API `/api/v1`**；本仓库不提供 CLI、库或产品 UI。UI 是独立项目，若接入只按契约调用；双方互不进入对方项目改代码。Swagger UI 仅作为开发者文档，不是产品界面。
3. 内部契约按同一原则逐层收窄：函数/类 → 组件 → 模块 → 进程/项目；每层只通过公开契约交互，不越过边界读写对方内部。
4. 每个组件只有一个主目标；数据只有一个写入口；读模型通过公开读契约组合。
5. 37 个 B1 业务端点 + 10 个 B3 工作流端点 = 47 个业务端点；另有 `/healthz` 与开发者文档端点 `/docs`、`/docs/*`、`/openapi.yaml`，不计入业务端点。

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
- 契约的权威版本在本项目 `components/http-gateway/spec.md`；外部 UI 是否接入、如何适配由该项目自行决定。
- 本项目不读取 UI 源码、不依赖 UI 的 `MOCK` 结构；UI 也不依赖本项目的内部模块。
- 契约变更先改规格，再改实现，再通知已接入的消费方；不允许先改代码后补契约。

### 2.2 项目内部组件

- 组件之间只通过公开契约交互；领域组件不互相调用写服务，不互相读表。
- 跨聚合读通过 `catalog` 的只读契约组合；跨聚合删除保护通过 `kernel` 的 `ReferenceGuard` 端口。
- `http-gateway` 只做协议翻译与错误映射，不承载业务规则；业务规则在领域组件。
- 数据只有一个写入口；其他组件只能读，不得写别人的表。
- 每个组件规格页只写自己的公共契约、数据所有权、依赖与验证；不写另一个组件的内部实现，不复制另一份契约。组件规格页之间只通过 `component` ID 和契约名引用。
- `kernel` 只定义共享契约词汇与端口，`config` 只负责启动配置合并/校验，`platform` 只提供运行时基础设施；三者不合并成一个“core 组件”，避免一个组件同时承担多类变化轴。

## 3 组件地图

| 组件 | 一句话主目标 | 拥有的数据 | 依赖 |
|---|---|---|---|
| `CMP-kernel` | 定义共享错误、分页、引用检查端口、时钟/ID 端口与文件存储端口 | 无 | 无 |
| `CMP-config` | 合并 TOML 与进程环境，校验并产出启动 `Config`（含存储根/TTL） | 无 | Bun TOML、文件系统 |
| `CMP-platform` | 提供数据库连接/事务、迁移、ID/时钟实现、健康检查、测试库与文件存储适配 | `schema_migrations`；存储根适配（无业务语义） | `kernel`、Bun、PostgreSQL |
| `CMP-harness` | 维护 Harness 聚合的生命周期、标签与不变量 | `harness`、`harness_tag` | `platform`、`kernel` |
| `CMP-tool` | 维护工具聚合、参数与 Harness 归属 | `tool`、`tool_param` | `platform`、`kernel` |
| `CMP-skill` | 维护 Skill brief、包指针、草稿生命周期、`SKILL.md` 与整包读取 | `skill_category`（只读种子）、`skill`、`skill_tag`、`skill_draft`；`packages/`、`drafts/` | `platform`、`kernel` |
| `CMP-expert` | 维护专家聚合、五区、有序装配与引用 | `expert`、`expert_persona`、`expert_skill`、`expert_tool`、`expert_ref` | `platform`、`kernel` |
| `CMP-workflow` | 维护工作流聚合、唯一当前定义、图校验与专家引用投影 | `workflow`、`workflow_definition`、`workflow_expert_ref` | `platform`、`kernel` |
| `CMP-catalog` | 组合跨资产的列表/详情/文档/整包/引用只读投影，并实现 `ReferenceGuard` | 无 | 四类资产与工作流的公开读契约、`kernel` |
| `CMP-http-gateway` | 把 HTTP 请求翻译为用例调用、映射 DTO/错误，处理 multipart/下载，并托管开发者 API 文档 | 无 | `catalog`、四类资产与工作流写服务、`platform`（健康检查）、`kernel`、Bun HTTP/流 API |

组件 ID 与目录：`CMP-*` 对应 `docs/design/components/<short-name>/spec.md`；任务表可用去掉 `CMP-` 的简称。`kernel`、`config`、`platform` 是三个独立组件；物理目录可用 `src/core/{kernel,config,platform}` 收口，但 `core` 只是容器，不是组件。

## 4 依赖规则

```
main / scripts
  ├── config                    （启动 Config）
  └── platform                  （Db、迁移、健康检查、FileStore）

http-gateway
  ├── catalog                   （读）
  ├── harness / tool / skill / expert / workflow（写）
  ├── platform                  （健康检查）
  └── kernel                    （错误类型）

catalog
  ├── harness / tool / skill / expert / workflow（公开读）
  └── kernel                    （Reference、错误、分页）

harness / tool / expert / workflow
  ├── platform                  （Db、Clock、ID 实现）
  └── kernel                    （ReferenceGuard 端口、错误、分页）

skill
  ├── platform                  （Db、FileStore 实现）
  └── kernel                    （ReferenceGuard、FileStore 端口、错误、分页）

platform
  └── kernel                    （共享契约类型）

kernel
  └── 无外部依赖

config
  └── 无外部依赖（Bun TOML/文件 API）
```

- 依赖方向只能向下：`http-gateway` → `catalog`/领域写服务/`platform`（健康检查）/`kernel`；`catalog` → 领域读契约/`kernel`；领域 → `platform`/`kernel`；`platform` → `kernel`；`main`/脚本 → `config`/`platform`；`config`/`kernel` → 无外部依赖。
- 禁止：领域组件互相导入写服务或 store；`http-gateway` 直接导入 store 或 `FileStore`；`catalog` 直接写表；循环依赖；同层横向写调用。
- `ReferenceGuard` 端口定义在 `kernel`，`catalog` 实现；领域删除服务只依赖端口，不依赖 `catalog` 类型。组合根负责注入。
- `FileStore` 端口定义在 `kernel`，`platform` 实现；`skill` 只依赖端口，不直接使用 Bun 文件 API；组合根把存储根与适配器注入 `skill`。
- `catalog` 不拥有表，不执行写操作；只通过领域公开读契约读数据。
- `http-gateway` 不执行 SQL，不实现业务规则；只校验传输层形状、调用契约、映射错误；multipart 只解析传输，不解释包结构；文档子模块只读本地静态资源，不新增依赖边。
- `main.ts` 只做组合根：调用 `config` 取 `Config`、创建 `platform`/领域/`catalog`/`http-gateway`，注入 `ReferenceGuard` 与 `FileStore`；不承载业务规则，不计为组件。

## 5 数据所有权

| 组件 | 表 | 写入口 |
|---|---|---|
| `CMP-kernel` | 无 | 无，只定义类型与端口 |
| `CMP-config` | 无 | 无，只持有启动配置 |
| `CMP-platform` | `schema_migrations`；文件存储适配（无业务语义） | 迁移执行器；存储适配器 |
| `CMP-harness` | `harness`、`harness_tag` | Harness 服务 |
| `CMP-tool` | `tool`、`tool_param` | 工具服务 |
| `CMP-skill` | `skill_category`（种子只读）、`skill`、`skill_tag`、`skill_draft`；`packages/`、`drafts/` | Skill 服务 |
| `CMP-expert` | `expert`、`expert_persona`、`expert_skill`、`expert_tool`、`expert_ref` | 专家服务 |
| `CMP-workflow` | `workflow`、`workflow_definition`、`workflow_expert_ref` | 工作流服务 |
| `CMP-catalog` | 无 | 无，只读组合 |
| `CMP-http-gateway` | 无 | 无，只做协议翻译与 OpenAPI / Swagger UI 托管 |

- 引用计数、`toolCount`、`usedByCount`、`refCount` 不落可写列；工作流的 `refCount` 由 `catalog` 组合 `workflow_expert_ref` 得出。
- `packages/`、`drafts/` 的字节由 `CMP-skill` 拥有业务语义，`CMP-platform` 只提供 `FileStore` 适配；其他组件不得直接读写。
- 删除规则与不变量见各组件规格的「拥有的数据」章节；列级外键与索引在实现任务补。
- 跨聚合引用检查：`ReferenceGuard.check(owner, id)` 返回引用方列表；领域删除服务在删除前调用，非空则抛 `ReferencedError`。

## 6 外部 REST 契约

- 基础路径：`/api/v1`；健康检查：`/healthz`（不在 `/api/v1` 下）。
- 47 个业务端点：B1 37 个（Harness 7、工具 6、Skill 15、专家 9）+ B3 工作流 10 个。
- 开发者文档：Swagger UI `/docs`、静态资源 `/docs/*`、OpenAPI `/openapi.yaml`；OpenAPI 资产由 `CMP-http-gateway` 直接提供，不在 `docs/` 维护设计副本；不计入业务端点，不写入 OpenAPI `paths`。
- 契约明细：方法、路径、查询参数、请求/响应 DTO、错误码、并发头、删除引用列表，全部在 [`components/http-gateway/spec.md`](components/http-gateway/spec.md)。
- 外部 UI 页面映射（参考）：Harness 页、工具页、Skill 页、专家页、工作流页；本仓库无 Key/工作区/实例/看板端点。
- 契约验证：本项目用 HTTP 契约测试与用例旅程验证契约；外部 UI 若接入，由该项目按端点表与 DTO 表自行适配。
- Skill 包形态是 `/api/v1` 的破坏性变更：移除 `POST /skills`、`PUT /skills/{id}`，新增草稿/下载；不提供 `/api/v2`，按本项目与 UI 独立项目约定直接切到新契约。

## 7 内部契约

- 领域组件对外暴露服务契约与只读契约；类型用领域词汇，不暴露 SQL、`Bun.sql`、HTTP 类型。
- 方法定义在各组件 `spec.md`；`http-gateway` 的 DTO 只是传输形状，不是领域方法或领域类型的定义来源。
- `catalog` 对外暴露读模型契约；不暴露领域内部类型。
- `http-gateway` 对外暴露 REST DTO；不把领域实体直接序列化，避免内部字段泄漏。
- 错误按层映射：领域错误（`ValidationError`、`NotFoundError`、`NameConflictError`、`RevisionConflictError`、`ReferencedError`、`FileConflictError`、`DraftExpiredError`、`PayloadTooLargeError`、`UnsupportedMediaTypeError`、`SkillMdTooLargeError`、`PreconditionRequiredError`、`PackageUnavailableError`、`DatabaseUnavailableError`）→ HTTP 错误码；`http-gateway` 不解析数据库错误文本。
- 契约中只出现稳定概念；数据库列名、索引名、迁移文件名不进 REST DTO。

## 8 契约变更流程

1. 先改对应 `spec.md`（组件契约或 REST API）。
2. 评估是否破坏兼容：删除/重命名字段、改变语义、新增必填字段 = 破坏性变更，一般需 `/api/v2` 或明确迁移窗口。**本次 Skill 包形态是例外**：无生产使用、当前数据均为演示数据，按 2026-10-28 决策直接切 `/api/v1`，不建 `/api/v2`，重建开发库。
3. 实现与测试按新规格更新；旧契约在迁移窗口内保留。
4. 外部 UI 若接入，由该项目按新规格适配；本项目不提供产品 UI，也不改 UI 代码。
5. 变更记录写入 `docs/history/decisions/`（结构性变更）或工序 `brief/result`（局部变更）。

## 9 验证

- **架构测试**：无跨组件 store 导入；工作流只通过 `WorkflowService`/`WorkflowRead` 暴露契约；无领域组件互调；`Bun.sql` 只在 `platform/db` 与 store；Bun 文件 API 只出现在 `config`（读 TOML）、`http-gateway`（读文档静态资源）与 `platform`（存储适配器）；业务组件只用 `FileStore` 端口；`FileStore` 只由 `skill` 依赖、由 `platform` 实现；无循环依赖；`http-gateway` 不碰 store、不碰 `FileStore`；`catalog` 无写操作；`kernel` 不导入运行时组件；`config` 只被入口/脚本/测试引用。
- **组件测试**：每个组件能只加载自身源码 + 规格 + 测试运行验证命令。
- **契约测试**：HTTP 端点按 `http-gateway/spec.md` 的 3 正 1 反验证；错误码、字段、分页、`If-Match`、引用列表、multipart、下载头；文档端点验证 HTML、静态资源与 OpenAPI 结构。
- **项目边界检查**：仓库内不出现 `agent-flow-ui` 的源码导入；不出现跨项目相对路径依赖；外部 UI 只通过 HTTP 契约交互。
- **预算**：单组件源码 + 规格 + 测试 ≤120k token；单任务装载 ≤250k。

## 10 实施状态与下一步

- `T-B1-D04` 已完成历史 schema：旧 `skill` 五章/踩坑/引用结构落入 [`db/migrations/`](../../db/migrations/)；本次不沿用旧结构。
- 2026-10-28：Skill 包形态契约 v1 冻结，规格/OpenAPI 由 T-SKP-06 同步；目标 schema 为重写 `0003`、删除 `0005`，重建后 13 张业务表、4 个迁移。实现待 T-SKP-08 起的拆分任务，当前代码尚未切换。
- `ReferenceGuard` 已按端口方案实现：端口在 `kernel`，由 `catalog` 实现，领域删除服务经组合根注入；未新增 L2 删除组件。
- 旧 REST API 已实现并通过历史契约测试；Skill 新契约（草稿/保存/下载/详情 `body`+`files`）待实现。Swagger 运行时仍按旧实现，由 T-SKP-17 一并更新运行时代码与测试。
- 组件状态均为 `current`；历史实现见 [`result.md`](../history/works/2026-10-24-db-backend-infra/result.md)（归档件，仅作追溯）。
- 2026-10-29：`CMP-workflow` P1 冻结，10 个端点与三张表进入实现；B4 运行不在本批。
- `CMP-config` 已从 `CMP-platform` 拆出；TOML + `process.env` 启动配置历史记录见 [`core-config/result.md`](../history/works/2026-10-25-core-config/result.md)（归档件，仅作追溯）。
