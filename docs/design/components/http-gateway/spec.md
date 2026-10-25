---
layer: design
module: http-gateway
status: current
component: CMP-http-gateway
updated: 2026-10-25
---

# `CMP-http-gateway` 组件规格与 REST API 契约

> 本文是本仓库的外部 HTTP 契约。本仓库只提供 HTTP API，不提供 CLI、库或产品 UI；UI 是独立项目，若接入只按本文调用，双方互不进入对方项目改代码。Swagger UI 是开发者文档，不是产品 UI。

## 1 主目标

把 HTTP 请求翻译为 B1 用例调用，校验传输层形状，映射 DTO 与错误；同时托管开发者 API 文档。是唯一对外暴露 HTTP 面的组件。

**不负责**：业务规则、SQL、读模型拼装、状态推进、B1 之外的业务端点。文档子模块只读取静态文件，不接触业务数据。

**方法归属**：领域方法、领域输入/输出类型与不变量在各组件规格；本文只定义端点、DTO 与错误映射。

**数据所有权**：无表、无缓存、不写数据库。

**机器可读契约**：由本组件在运行时通过 `GET /openapi.yaml` 直接导出，供 Swagger UI、Postman 或外部接口项目导入；文件是 `CMP-http-gateway` 的组件内资产，不在 `docs/` 维护静态副本。`spec.md` 仍是契约权威，两者冲突时以本文为准。Swagger UI 页面在 `/docs`。

## 2 契约原则

- 基础路径：`/api/v1`；健康检查 `/healthz` 不在 API 版本内。
- REST 契约权威版本：本文；领域方法/类型权威在各组件规格。外部 UI 若接入，按本文实现适配层与契约测试。
- 两个独立项目之间不共享源码、类型或数据库；只通过 HTTP 契约交互。
- 兼容性：新增可选字段/端点视为兼容；删除/重命名字段、改变语义、新增必填字段视为破坏性变更，需 `/api/v2` 或明确迁移窗口。
- 调用方应忽略未知响应字段；本项目不依赖外部 UI 的 `MOCK` 结构。
- 无登录/鉴权；只监听 `127.0.0.1`；`X-Actor` 只用于显示，不是身份。

## 3 通用约定

### 3.1 请求/响应

- `Content-Type: application/json; charset=utf-8`；响应 JSON UTF-8。
- ID 为 UUIDv7 字符串；时间为 ISO-8601 UTC 字符串；金额不涉及。
- 创建：`POST` 成功 201，响应体为资源详情（同 `GET` 详情），`Location: /api/v1/<resource>/<id>`。
- 更新：`PUT` 成功 200，返回资源详情。
- 启停：`PATCH .../enabled`，请求体 `{enabled:boolean}`，成功 200，返回资源详情。
- 写操作返回的资源详情由 `catalog` 组合；HTTP 在写入成功后按 ID 回读，不在路由层拼字段。
- 若写入已提交但回读失败，响应 500；调用方可用 `Location` / `GET` 重试，不把 500 当作未写入。
- 删除：成功 204，无响应体。
- 列表：`{items,total,limit,offset}`；默认 `limit=50`，上限 200；`offset>=0`。
- `limit` / `offset` 必须是整数且落在上述范围；越界或非整数返回 400，不截断。
- 单资源：直接返回对象，不包 `data`。

```json
{ "items": [], "total": 0, "limit": 50, "offset": 0 }
```

- `q`：按名称大小写不敏感包含匹配；各资源可筛选字段见 DTO 段。
- `sort`：只接受该资源列出的值；非法值 400。默认 `updatedAt:desc`。
- 可选请求头 `X-Actor`（显示用）；请求/响应可带 `X-Request-Id`，响应回显。
- 未知查询参数忽略；未知请求体字段拒绝（400），避免静默丢字段。
- 无 CORS 配置；外部调用方若跨源，由部署层同源代理或调用方处理，不在本仓库范围。

### 3.2 并发与幂等

- 更新、启停、删除、装配必须带 `If-Match: "<revision>"`；`revision` 从 1 开始，每次写 +1。
- 缺少 `If-Match`：428 `precondition_required`。
- 版本不匹配：409 `revision_conflict`，`details.currentRevision` 返回当前值。
- 创建不要求 `If-Match`；重复名称返回 409 `name_conflict`。
- `DELETE` 重复调用：第二次 404；不承诺幂等 204。

### 3.3 错误体

```json
{
  "error": {
    "code": "referenced",
    "message": "资产仍被引用，不能删除",
    "details": {
      "asset": { "type": "tool", "id": "...", "name": "trace_call_chain" },
      "references": [
        { "type": "expert", "id": "...", "name": "方案设计专家" }
      ]
    },
    "requestId": "..."
  }
}
```

| HTTP | `code` | 触发 |
|---:|---|---|
| 400 | `validation_error` | 字段缺失/类型错误/枚举非法/范围越界/请求体未知字段 |
| 404 | `not_found` | 资源或引用目标不存在 |
| 409 | `name_conflict` | 名称大小写不敏感重复 |
| 409 | `revision_conflict` | `If-Match` 与当前 `revision` 不一致 |
| 409 | `referenced` | 删除时仍有引用；`details.references` 非空 |
| 428 | `precondition_required` | 缺少 `If-Match` |
| 500 | `internal` | 未分类服务端错误；不返回堆栈/SQL |
| 503 | `service_unavailable` | 数据库不可用；`/healthz` 同样返回 503 |

- `message` 中文；`code` 稳定英文；`details` 按错误类型定义。
- 路径 `id` 必须是 UUID；格式不合法返回 400 `validation_error`，格式合法但资源不存在返回 404。
- 请求体引用的目标（`harnessId`、`categoryCode`、`skillId`、`toolId`）不存在用 400 `validation_error`，`details.field` 指向字段。
- 校验错误 `details` 至少含 `{field, reason}`；多字段可用数组。

## 4 端点总表

30 个 B1 业务端点；`/healthz` 单独列在 §4.2；开发者文档端点见 §4.3，不计入业务端点。

### 4.1 业务端点

| ID | 方法 | 路径 | 用例 | 用途 | 成功 |
|---|---|---|---|---|---|
| `API-01` | GET | `/harnesses` | `UC-B1-01` | Harness 列表/检索 | 200 列表 |
| `API-02` | GET | `/harnesses/{id}` | `UC-B1-01` | Harness 详情 | 200 详情 |
| `API-03` | POST | `/harnesses` | `UC-B1-01` | 创建 Harness | 201 + Location |
| `API-04` | PUT | `/harnesses/{id}` | `UC-B1-01` | 全量更新 Harness | 200 详情 |
| `API-05` | PATCH | `/harnesses/{id}/enabled` | `UC-B1-01` | 启用/停用 | 200 详情 |
| `API-06` | DELETE | `/harnesses/{id}` | `UC-B1-01` | 删除；被工具引用则 409 | 204 |
| `API-07` | GET | `/harnesses/{id}/references` | `UC-B1-06` | 查询引用工具 | 200 引用页 |
| `API-08` | GET | `/tools` | `UC-B1-02` | 工具列表/检索 | 200 列表 |
| `API-09` | GET | `/tools/{id}` | `UC-B1-02` | 工具详情 | 200 详情 |
| `API-10` | POST | `/tools` | `UC-B1-02` | 创建工具 | 201 + Location |
| `API-11` | PUT | `/tools/{id}` | `UC-B1-02` | 全量更新工具 | 200 详情 |
| `API-12` | DELETE | `/tools/{id}` | `UC-B1-02` | 删除；被专家引用则 409 | 204 |
| `API-13` | GET | `/tools/{id}/references` | `UC-B1-06` | 查询引用专家 | 200 引用页 |
| `API-14` | GET | `/skills` | `UC-B1-03` | Skill 列表/检索 | 200 列表 |
| `API-15` | GET | `/skills/{id}` | `UC-B1-03` | Skill 详情 | 200 详情 |
| `API-16` | POST | `/skills` | `UC-B1-03` | 创建 Skill | 201 + Location |
| `API-17` | PUT | `/skills/{id}` | `UC-B1-03` | 全量更新；服务端递增版本 | 200 详情 |
| `API-18` | PATCH | `/skills/{id}/enabled` | `UC-B1-03` | 启用/停用 | 200 详情 |
| `API-19` | DELETE | `/skills/{id}` | `UC-B1-03` | 删除；被专家引用则 409 | 204 |
| `API-20` | GET | `/skills/{id}/references` | `UC-B1-06` | 查询引用专家 | 200 引用页 |
| `API-21` | GET | `/skill-categories` | `UC-B1-03` | 分类参考数据 | 200 列表 |
| `API-22` | GET | `/experts` | `UC-B1-04` | 专家列表/检索 | 200 列表 |
| `API-23` | GET | `/experts/{id}` | `UC-B1-04` | 专家详情（含装配摘要） | 200 详情 |
| `API-24` | POST | `/experts` | `UC-B1-04` | 创建专家；可带初始有序装配 | 201 + Location |
| `API-25` | PUT | `/experts/{id}` | `UC-B1-04` | 全量更新（不含装配） | 200 详情 |
| `API-26` | PATCH | `/experts/{id}/enabled` | `UC-B1-04` | 启用/停用 | 200 详情 |
| `API-27` | DELETE | `/experts/{id}` | `UC-B1-04` | 删除；B1 无引用方 | 204 |
| `API-28` | PUT | `/experts/{id}/skills` | `UC-B1-05` | 整体替换有序 Skill | 200 专家详情 |
| `API-29` | PUT | `/experts/{id}/tools` | `UC-B1-05` | 整体替换有序工具 | 200 专家详情 |
| `API-30` | PATCH | `/experts/{id}` | `UC-B1-04` / `UC-B1-05` | 聚合部分更新五区、引用与装配；一次事务 | 200 专家详情 |

### 4.2 健康检查

| ID | 方法 | 路径 | 用途 | 成功 | 失败 |
|---|---|---|---|---|---|
| `API-H` | GET | `/healthz` | 进程与数据库健康 | 200 `{status:"ok",database:"up"}` | 503 `{status:"degraded",database:"down"}` |

### 4.3 开发者文档端点（非业务 API）

| 方法 | 路径 | 用途 | 成功 |
|---|---|---|---|
| GET | `/docs`、`/docs/` | Swagger UI 页面 | 200 `text/html` |
| GET | `/docs/swagger-ui.css` | Swagger UI 样式 | 200 `text/css` |
| GET | `/docs/swagger-ui-bundle.js` | Swagger UI 主包 | 200 JavaScript |
| GET | `/docs/swagger-ui-standalone-preset.js` | Swagger UI standalone preset | 200 JavaScript |
| GET | `/docs/favicon-32x32.png` | 页面图标 | 200 `image/png` |
| GET | `/openapi.yaml` | 机器可读契约 | 200 `application/yaml` |

- 这些端点不属于业务 API，不进入 `/api/v1` 版本，也不写入 `openapi.yaml` 的 `paths`。
- 无鉴权、无 CORS；与业务 API 一样只应监听本机或受控网络。
- Swagger UI 只引用本地 `/docs/*` 资源，不依赖 CDN；`Try it out` 使用当前文档所在 host/port（`servers: /`）。
- 静态资源只从固定白名单读取，未知 `/docs/*` 返回 404，不拼接用户输入到文件路径。

## 5 资源 DTO

DTO 是传输契约，不是领域方法定义；字段语义以对应组件规格的方法与领域类型为准。

### 5.1 Harness

**列表项 `HarnessListItem`**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | UUIDv7 |
| `name` | string | 唯一 |
| `kind` | `container` / `server` / `desktop` / `laptop` | 类型 |
| `address` | string | 接入地址 |
| `accessMode` | `agent` / `ssh` / `container_registry` | 接入方式 |
| `enabled` | boolean | 启停 |
| `health` | `unknown` / `online` / `offline` / `overloaded` | 运行时只读 |
| `lastHeartbeatAt` | string \| null | 运行时只读 |
| `concurrencyMax` | number | ≥1 |
| `queuePolicy` | `fifo` / `priority` | 排队策略 |
| `tags` | string[] | 能力标签，有序 |
| `toolCount` | number | 派生：引用工具数 |
| `revision` | number | 乐观锁 |
| `updatedAt` | string | ISO-8601 |

**详情 `HarnessDetail`**：列表项 + `description`、`createdAt`。

**查询参数**：`q`、`kind`、`enabled`、`health`、`limit`、`offset`、`sort`（`name:asc|desc`、`updatedAt:asc|desc`，默认 `updatedAt:desc`）。

**创建/更新请求**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 1–80 字，唯一 |
| `kind` | enum | 是 | 见上 |
| `address` | string | 是 | 1–200 字 |
| `accessMode` | enum | 是 | 见上 |
| `description` | string | 否 | ≤500 字 |
| `concurrencyMax` | number | 是 | ≥1 |
| `queuePolicy` | enum | 是 | 见上 |
| `tags` | string[] | 否 | 有序；空数组合法 |

- `POST` 可带 `enabled`（默认 `true`）；`PUT` 不带 `enabled`，启停走 `API-05`。
- `POST` 默认 `health=unknown`、`lastHeartbeatAt=null`；两者不可写。

### 5.2 工具

**列表项 `ToolListItem`**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | UUIDv7 |
| `name` | string | 唯一 |
| `kind` | `mcp` / `cli` / `script` | 类型 |
| `invocation` | string | 命令模板/端点 |
| `description` | string | 描述；列表检索与导航使用，空描述返回空字符串 |
| `harnessId` | string | 所属 Harness |
| `harnessName` | string | 派生展示 |
| `timeoutMs` | number | 1000–600000 |
| `status` | `unverified` / `available` / `unavailable` | 运行时只读 |
| `lastDebugAt` | string \| null | 运行时只读 |
| `paramCount` | number | 参数数 |
| `usedByCount` | number | 派生：引用专家数 |
| `revision` | number | 乐观锁 |
| `updatedAt` | string | ISO-8601 |

**详情 `ToolDetail`**：列表项 + `params: ToolParam[]`、`createdAt`。

**`ToolParam`**：`{key: string, type: "string"|"int", description?: string}`；`description` 可省略，省略时返回空字符串；对应领域 `paramKey`，HTTP 层做字段映射。

**查询参数**：`q`、`kind`、`status`、`harnessId`、`limit`、`offset`、`sort`（`name`、`updatedAt`）。

**创建/更新请求**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 1–80 字，唯一 |
| `kind` | enum | 是 | 见上 |
| `invocation` | string | 是 | 1–500 字 |
| `description` | string | 否 | ≤500 字 |
| `harnessId` | string | 是 | 必须存在 |
| `timeoutMs` | number | 是 | 1000–600000 |
| `params` | `ToolParam[]` | 否 | 有序；`key` 唯一 |

- 工具没有 `enabled`；`POST` 默认 `status=unverified`、`lastDebugAt=null`；两者不可写；B1 无调试/标记可用端点。

### 5.3 Skill

**列表项 `SkillListItem`**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | UUIDv7 |
| `name` | string | 唯一 |
| `categoryCode` | string | 分类代码 |
| `categoryLabel` | string | 分类展示名 |
| `summary` | string | ≤200 字 |
| `version` | string | `vX.Y`，服务端维护 |
| `enabled` | boolean | 启停 |
| `tags` | string[] | 标签，有序 |
| `triggers` | string[] | 触发条件，有序且唯一；列表检索使用 |
| `usedByCount` | number | 派生：引用专家数 |
| `revision` | number | 乐观锁 |
| `updatedAt` | string | ISO-8601 |

**详情 `SkillDetail`**：列表项 + `sections: SkillSections`、`pitfalls: string[]`、`refs: SkillRef[]`、`createdAt`。

**`SkillSections`**：固定五键 `{overview:string, steps:string, examples:string, scripts:string, verification:string}`，全部必填。

**`SkillRef`**：`{label:string, refType:string, path?: string|null}`；`path` 可省略或为 null。

**查询参数**：`q`、`category`、`enabled`、`tag`、`limit`、`offset`、`sort`（`name`、`updatedAt`、`version`）。

**创建/更新请求**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 1–80 字，唯一 |
| `categoryCode` | string | 是 | 必须存在 |
| `summary` | string | 是 | ≤200 字 |
| `tags` | string[] | 否 | 有序 |
| `triggers` | string[] | 否 | 有序、唯一 |
| `sections` | `SkillSections` | 是 | 五章齐全 |
| `pitfalls` | string[] | 否 | 有序 |
| `refs` | `SkillRef[]` | 否 | 有序；`path` 可空 |

- `version` 不在请求中；`POST` 生成 `v1.0`，默认 `enabled=true`；`PUT` 服务端 minor+1；若 minor 超过 9，则 major+1、minor=0（如 `v1.9` → `v2.0`）。
- `GET /skill-categories` 返回 `{items:[{code,label,position}]}`；无分页。

### 5.4 专家

**列表项 `ExpertListItem`**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | UUIDv7 |
| `name` | string | 唯一 |
| `color` | string | `#RRGGBB` |
| `role` | string | 角色定位 |
| `enabled` | boolean | 启停 |
| `persona` | string[] | 性格/视角标签，有序 |
| `skillCount` | number | 装配 Skill 数 |
| `toolCount` | number | 装配工具数 |
| `refCount` | number | B1 固定 0 |
| `skills` | `ExpertSkillPreview[]` | 前 3 个装配 Skill 预览，按装配顺序；无装配为空数组 |
| `revision` | number | 乐观锁 |
| `updatedAt` | string | ISO-8601 |

**详情 `ExpertDetail`**：共享字段 + `duty`、`skillOrder`、`verifyOrder`、`notes`、`skills: ExpertSkillSummary[]`、`tools: ExpertToolSummary[]`、`refs: ExpertRef[]`、`createdAt`。

**`ExpertSkillPreview`**：`{id,name}`，仅用于列表选择/导航。
**`ExpertSkillSummary`**：`{id,name,categoryCode,categoryLabel,summary}`。
**`ExpertToolSummary`**：`{id,name,kind,status}`。
**`ExpertRef`**：`{label,refType,path?: string|null}`；`path` 可省略或为 null。

**查询参数**：`q`、`enabled`、`limit`、`offset`、`sort`（`name`、`updatedAt`）。

**创建/更新请求**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 1–80 字，唯一 |
| `color` | string | 是 | `#RRGGBB` |
| `role` | string | 是 | 1–200 字 |
| `enabled` | boolean | 否 | POST 默认 true；PUT 不使用 |
| `persona` | string[] | 否 | 有序 |
| `duty` | string | 否 | 主要职责/工作内容 |
| `skillOrder` | string | 否 | Skill 配合顺序说明 |
| `verifyOrder` | string | 否 | 验证顺序说明 |
| `notes` | string | 否 | 任务解读/备注 |
| `refs` | `ExpertRef[]` | 否 | 有序 |
| `skillIds` | string[] | 否 | 创建时可选的有序 Skill ID；同事务写入 |
| `toolIds` | string[] | 否 | 创建时可选的有序工具 ID；同事务写入 |

- `POST` 可带初始有序装配；`PUT` 只更新五区/人设/引用，不接收 `skills`/`tools`/`skillIds`/`toolIds`。
- `PATCH /experts/{id}` 是聚合部分更新：省略字段不变，数组字段传入即整体替换，空数组清空；一次事务、一次递增 `revision`。独立装配端点 `API-28`/`API-29` 保留。
- `GET /experts` 的 `skills` 只返回前 3 个 `{id,name}`，避免把详情摘要塞进列表；`GET /experts/{id}` 返回完整装配摘要。
- `skillCount` / `toolCount` 由装配关系派生。

**装配请求/响应**：

```json
// PUT /experts/{id}/skills
{ "items": [ { "skillId": "..." }, { "skillId": "..." } ] }
```

- 成功 200，返回更新后的 `ExpertDetail`（同 `API-23`）；调用方可直接刷新详情，不需要额外的装配摘要 DTO。
- 工具装配同构，请求字段为 `toolId`。
- HTTP 层在领域服务写入成功后调用 `catalog` 组合详情；不在路由层拼 Skill/工具名称。

### 5.5 引用页

`GET /harnesses/{id}/references`、`/tools/{id}/references`、`/skills/{id}/references` 返回：

```json
{
  "asset": { "type": "skill", "id": "...", "name": "CRES 技能" },
  "total": 1,
  "items": [
    { "type": "expert", "id": "...", "name": "开发实现专家" }
  ]
}
```

- Harness 引用项 `type="tool"`；工具/Skill 引用项 `type="expert"`。
- 删除 409 的 `details` 使用 `asset` + `references` 结构，与 §3.3 示例一致。
- B1 不返回工作流节点引用。

### 5.6 端点 → 组件方法

本文只定义 HTTP 传输契约；领域方法、领域输入/输出类型与不变量定义在各组件规格中。DTO 是传输形状，不是方法定义来源。

- Harness：[`../harness/spec.md`](../harness/spec.md)
- 工具：[`../tool/spec.md`](../tool/spec.md)
- Skill：[`../skill/spec.md`](../skill/spec.md)
- 专家：[`../expert/spec.md`](../expert/spec.md)
- 目录：[`../catalog/spec.md`](../catalog/spec.md)
- 平台：[`../platform/spec.md`](../platform/spec.md)
- 共享契约：[`../kernel/spec.md`](../kernel/spec.md)

| 端点 | 组件方法 |
|---|---|
| `API-01` | `catalog.listHarnesses` |
| `API-02` | `catalog.getHarness` |
| `API-03` | `harness.create` + `catalog.getHarness` |
| `API-04` | `harness.update` + `catalog.getHarness` |
| `API-05` | `harness.setEnabled` + `catalog.getHarness` |
| `API-06` | `harness.delete` |
| `API-07` | `catalog.referencesForHarness` |
| `API-08` | `catalog.listTools` |
| `API-09` | `catalog.getTool` |
| `API-10` | `tool.create` + `catalog.getTool` |
| `API-11` | `tool.update` + `catalog.getTool` |
| `API-12` | `tool.delete` |
| `API-13` | `catalog.referencesForTool` |
| `API-14` | `catalog.listSkills` |
| `API-15` | `catalog.getSkill` |
| `API-16` | `skill.create` + `catalog.getSkill` |
| `API-17` | `skill.update` + `catalog.getSkill` |
| `API-18` | `skill.setEnabled` + `catalog.getSkill` |
| `API-19` | `skill.delete` |
| `API-20` | `catalog.referencesForSkill` |
| `API-21` | `catalog.listSkillCategories` |
| `API-22` | `catalog.listExperts` |
| `API-23` | `catalog.getExpert` |
| `API-24` | `expert.create` + `catalog.getExpert` |
| `API-25` | `expert.update` + `catalog.getExpert` |
| `API-26` | `expert.setEnabled` + `catalog.getExpert` |
| `API-27` | `expert.delete` |
| `API-28` | `expert.setSkills` + `catalog.getExpert` |
| `API-29` | `expert.setTools` + `catalog.getExpert` |
| `API-30` | `expert.updateAggregate` + `catalog.getExpert` |
| `API-H` | `platform.Health.check` |

- 写端点由 `http-gateway` 调用领域写方法，再用 `catalog` 回读详情；路由层不拼字段。
- `API-28/29` 的请求体只表达装配顺序；`API-30` 的请求体可同时表达五区、引用与两类装配顺序；`catalog` 负责把 `skillIds`/`toolIds` 解析为摘要。
- 领域方法表见各组件规格的「方法契约」章节。

## 6 外部 UI 页面映射（参考，不属于本仓库交付与验收）

| UI 页面 / 组件 | B1 端点 | 说明 |
|---|---|---|
| `harnesses.html` / `CMP-harnesses` | `API-01`～`API-07` | 列表、详情、注册、编辑、启停、删除、工具引用 |
| `tools.html` / `CMP-tools` | `API-08`～`API-13` | 列表、详情、注册、编辑、删除、专家引用；无启停/调试 |
| `skills.html` / `CMP-skills` | `API-14`～`API-21` | 列表、详情、五章、启停、删除、专家引用、分类 |
| `experts.html` / `CMP-experts` | `API-22`～`API-30` | 列表、详情、五区、启停、删除、Skill/工具装配、聚合保存 |
| 其他页面 | 无 B1 端点 | Key/工作区/工作流/实例/看板不在 B1 |

外部 UI 夹具与契约字段不同（如 `k`→`key`、`desc`→`description`、`harness`→`harnessId`/`harnessName`、`usedBy`→`usedByCount`、`CLI/MCP/脚本`→`cli/mcp/script`、中文状态→英文代码）；若接入，由该项目适配层映射，不把 `MOCK` 形状带进契约。

B1 不提供的运行时字段：Harness 当前任务数/运行中任务、工具执行历史/成功率、专家工作流节点引用明细、Skill 执行统计。外部 UI 若展示这些字段，由该项目自行标注「未接入」，本仓库不伪造；`lastHeartbeatAt` / `lastDebugAt` 只展示种子值或空值。

B1 不提供的页面动作：Harness 连接测试/心跳刷新、工具调试/标记可用、Skill 版本历史/回滚、专家绑定工作流/节点引用。外部 UI 若保留这些按钮，只做展示，不接 B1 API。

外部接入验证建议（参考）：

1. 按端点表写适配层，字段名逐一对应 DTO；不直接复用本项目类型。
2. 用 `If-Match` 验证并发：缺失 428、旧版本 409。
3. 用删除引用场景验证 409 `referenced` 与 `details.references`。
4. 用 Skill 保存验证 `version` 递增；客户端不传 `version`。
5. 用专家装配验证顺序与 `revision`；Skill/工具列表整体替换；一次保存五区与两类装配时使用 `PATCH /experts/{id}`，确认只递增一次 `revision`。
6. 忽略未知字段；遇到契约缺口先改本文，不跨项目改代码。

## 7 契约测试

- 每个端点 3 正 1 反；断言具体状态码、字段值、列表顺序、错误 `code`。
- 公共：分页、筛选、排序、404、400、409、428、500 映射。
- 删除：Harness 被工具引用、工具/Skill 被专家引用；无引用 204。
- 装配：重复目标、目标不存在、旧 `revision`、顺序回读；聚合保存的省略/替换/清空语义。
- 契约快照：响应字段集合与 DTO 表一致；新增字段必须更新本文。
- 外部 UI 若接入，可用同一份端点/DTO 表做适配层契约测试；不共享代码。

## 8 依赖与边界

- 允许：`catalog` 读契约；四类资产写服务；`platform` 的 `Health`；`kernel` 的错误、分页、ID/时钟类型；文档子模块的 Bun 文件读取与本地静态资源。
- 禁止：导入任何 store；执行 SQL；在路由层实现名称唯一、引用保护、版本递增等业务规则；直接序列化领域实体；文档子模块接触数据库或领域服务。
- 校验分工：HTTP 校验 JSON 形状、必填、类型、简单范围、未知字段；领域校验唯一性、引用、状态与事务不变量。
- 错误映射：领域错误 → HTTP `code`/状态码；未知异常 → 500，不泄漏 SQL/堆栈。

## 9 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 23 KB；OpenAPI 运行时资产约 69 KB、Swagger UI 静态资源约 2.14 MB，均单独计量，不计入组件预算。
- 单独验证命令：`bun test tests/components/http-gateway`。
- 文档入口：启动后访问 `/docs`；机器可读契约：`/openapi.yaml`。OpenAPI 资产随组件发布，包含 31 个 operation 的说明、51 个 schema 的说明与核心 DTO 的字段说明。
- 当前状态：`current`；已实现并通过契约测试，验证入口见 [`result.md`](../../../works/2026-10-24-db-backend-infra/result.md)。

## 10 B1 实现口径与剩余问题

- `API-21` 保留为独立只读资源 `GET /skill-categories`，便于外部客户端下拉直接消费。
- `API-28` / `API-29` 保持分开，避免一次保存两类装配关系时互相覆盖；`API-30` 提供一次保存五区、引用与两类装配的聚合入口，领域内仍是单事务、单 `revision`。
- 错误体不新增顶层 `fieldErrors`，字段级错误仍放在 `details`：单字段为 `details.field` / `details.reason`，多字段为 `details.fieldErrors` 数组。
- 本仓库不配置 CORS；外部浏览器若跨源调用，由部署层同源代理或调用方处理，不在本仓库范围。
- Swagger UI 是开发者文档，不是产品 UI；`/docs` 与 `/openapi.yaml` 不改变“只提供 HTTP API、无 CLI/库/产品 UI”的边界。
