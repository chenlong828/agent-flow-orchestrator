---
layer: design
module: http-gateway
status: current
component: CMP-http-gateway
updated: 2026-10-29
---

# `CMP-http-gateway` 组件规格与 REST API 契约

> 本文是本仓库的外部 HTTP 契约。本仓库只提供 HTTP API，不提供 CLI、库或产品 UI；UI 是独立项目，若接入只按本文调用，双方互不进入对方项目改代码。Swagger UI 是开发者文档，不是产品 UI。

## 1 主目标

把 HTTP 请求翻译为 B1/B3 用例调用，校验传输层形状，映射 DTO 与错误；同时托管开发者 API 文档。是唯一对外暴露 HTTP 面的组件。

**不负责**：业务规则、SQL、读模型拼装、状态推进、包结构解析、B1/B3 之外的业务端点。文档子模块只读取静态文件，不接触业务数据。

**方法归属**：领域方法、领域输入/输出类型与不变量在各组件规格；本文只定义端点、DTO 与错误映射。

**数据所有权**：无表、无缓存、不写数据库；不直接读写存储根。

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

- 默认 `Content-Type: application/json; charset=utf-8`；JSON 响应 UTF-8。
- 例外 1：`GET /skills/{id}/document` 返回 `text/markdown; charset=utf-8`，带 `ETag: "<revision>"`；请求带相同 `If-None-Match` 时返回 304、无响应体。该端点不做 `enabled` 过滤。
- 例外 2：`GET /skills/{id}/download` 返回 `application/zip`，带 `ETag`、`Content-Length`、`Content-Disposition: attachment`、`Cache-Control: no-cache` 与 `X-Content-Type-Options: nosniff`；`If-None-Match` 命中返回 304。
- 例外 3：`POST /skill-drafts/{id}/files` 请求为 `multipart/form-data`，字段 `path`（文本）与 `file`（二进制）；一次只传一个文件。
- ID 为 UUIDv7 字符串；时间为 ISO-8601 UTC 字符串；金额不涉及。
- 创建：Harness/工具/专家 `POST` 成功 201，返回资源详情，`Location: /api/v1/<resource>/<id>`；Skill 新建走 `POST /skill-drafts/{id}/save`，成功 201 返回 `SaveSkillResult`，`Location: /api/v1/skills/{id}`。
- 更新：Harness/工具/专家 `PUT` 成功 200，返回资源详情；Skill 更新走 `POST /skill-drafts/{id}/save`，成功 200 返回 `SaveSkillResult`；已移除 `POST /skills` 与 `PUT /skills/{id}`，调用按 404 `not_found` 处理。
- 草稿：`POST /skill-drafts` 成功 201，返回 `SkillDraft` 与 `Location`；文件上传/改名成功 200，返回 `{file,files}`；保存成功消费草稿。
- 启停：`PATCH .../enabled`，请求体 `{enabled:boolean}`，成功 200，返回资源详情。
- 写操作返回的资源详情由 `catalog` 组合；HTTP 在写入成功后按 ID 回读，不在路由层拼字段；Skill 保存返回 `SaveSkillResult`，需要详情时再 `GET`。
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

- Harness/工具/专家/工作流的更新、删除，专家装配，工作流保存定义，以及 Skill 的启停、删除，必须带 `If-Match: "<revision>"`；`revision` 从 1 开始，每次写 +1。工作流复制、校验、导入不需要 `If-Match`。
- 已有 Skill 草稿保存必须带 `If-Match: "<baseRevision>"`；新建草稿保存不带 `If-Match`，带了返回 400。
- 缺少 `If-Match`：428 `precondition_required`；格式非法 400 `validation_error`。
- 版本不匹配：409 `revision_conflict`，`details.currentRevision` 返回当前值；草稿保存不消费草稿。
- 创建其他资源不要求 `If-Match`；重复名称返回 409 `name_conflict`。
- 同一草稿并发保存：一个成功并删除草稿，另一个 404；不同草稿基于同一 revision：先保存者成功，后保存者 409，草稿保留。
- 保存响应丢失：刷新 Skill 确认；不要盲目重试同一草稿。
- `DELETE` 重复调用：第二次 404；不承诺幂等 204。草稿取消例外：已过期但可清理按 204，已清理 404。

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
| 400 | `validation_error` | 字段缺失/类型错误/枚举非法/范围越界/请求体未知字段/路径非法/`If-Match` 格式非法 |
| 404 | `not_found` | 资源或引用目标不存在；草稿已清理 |
| 409 | `name_conflict` | 名称大小写不敏感重复 |
| 409 | `revision_conflict` | `If-Match`/baseRevision 与当前 revision 不一致 |
| 409 | `referenced` | 删除时仍有引用；`details.references` 非空 |
| 409 | `file_conflict` | 草稿附件改名目标已存在；`details.path`、`newPath` |
| 410 | `draft_expired` | 草稿记录仍在但已过期；`details.expiresAt` |
| 413 | `payload_too_large` | 单文件/文件数/包总量/草稿总量超限；`details.limit` |
| 415 | `unsupported_media_type` | 草稿附件上传不是 `multipart/form-data` |
| 422 | `skill_md_too_large` | 生成的 `SKILL.md` 超过 16384 字节；`details.limitBytes`、`actualBytes` |
| 428 | `precondition_required` | 需要 `If-Match` 但缺失 |
| 500 | `package_unavailable` | 已保存包的 zip 或 `SKILL.md` 缺失/损坏；`details.skillId` |
| 500 | `internal` | 未分类服务端错误；不返回堆栈/SQL |
| 503 | `service_unavailable` | 数据库不可用；`/healthz` 同样返回 503 |

- `message` 中文；`code` 稳定英文；`details` 按错误类型定义。
- `payload_too_large` 的 `details.limit` 取 `file_bytes` / `file_count` / `package_bytes` / `draft_bytes`，并带 `limitValue`、`actualValue`。
- 路径 `id` 必须是 UUID；格式不合法返回 400 `validation_error`，格式合法但资源不存在返回 404。
- 请求体引用的目标（`harnessId`、`categoryCode`、`skillId`、`toolId`）不存在用 400 `validation_error`，`details.field` 指向字段。
- 校验错误 `details` 至少含 `{field, reason}`；多字段可用数组。

## 4 端点总表

47 个业务端点（B1 37 个 + B3 工作流 10 个）；`/healthz` 单独列在 §4.2；开发者文档端点见 §4.3，不计入业务端点。

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
| `SKP-01` | GET | `/skills` | `UC-B1-03` | Skill 列表/检索；不读 zip | 200 列表 |
| `SKP-02` | GET | `/skills/{id}` | `UC-B1-03` | Skill 详情；`body` + `files` | 200 详情 |
| `SKP-03` | GET | `/skills/{id}/document` | `UC-B1-03` | 包内 `SKILL.md` 原文 | 200 markdown、304 |
| `SKP-04` | GET | `/skills/{id}/download` | `UC-B1-03` | 整包下载 | 200 zip、304 |
| `SKP-05` | GET | `/skill-categories` | `UC-B1-03` | 分类参考数据 | 200 列表 |
| `SKP-06` | GET | `/skills/{id}/references` | `UC-B1-06` | 查询引用专家 | 200 引用页 |
| `SKP-07` | PATCH | `/skills/{id}/enabled` | `UC-B1-03` | 启用/停用；不重建包 | 200 详情 |
| `SKP-08` | DELETE | `/skills/{id}` | `UC-B1-03` | 删除；被专家引用则 409 | 204 |
| `SKP-09` | POST | `/skill-drafts` | `UC-B1-03` | 建草稿；复制当前包或空草稿 | 201 + Location |
| `SKP-10` | GET | `/skill-drafts/{id}` | `UC-B1-03` | 读草稿清单 | 200 草稿 |
| `SKP-11` | POST | `/skill-drafts/{id}/files` | `UC-B1-03` | 上传/覆盖附件（multipart） | 200 `{file,files}` |
| `SKP-12` | PATCH | `/skill-drafts/{id}/files` | `UC-B1-03` | 附件改名/跨目录 | 200 `{file,files}` |
| `SKP-13` | DELETE | `/skill-drafts/{id}/files` | `UC-B1-03` | 删除附件 | 204 |
| `SKP-14` | DELETE | `/skill-drafts/{id}` | `UC-B1-03` | 取消草稿 | 204 |
| `SKP-15` | POST | `/skill-drafts/{id}/save` | `UC-B1-03` | 生成包并保存；消费草稿 | 200/201 + Location |
| `API-22` | GET | `/experts` | `UC-B1-04` | 专家列表/检索 | 200 列表 |
| `API-23` | GET | `/experts/{id}` | `UC-B1-04` | 专家详情（含装配摘要） | 200 详情 |
| `API-24` | POST | `/experts` | `UC-B1-04` | 创建专家；可带初始有序装配 | 201 + Location |
| `API-25` | PUT | `/experts/{id}` | `UC-B1-04` | 全量更新（不含装配） | 200 详情 |
| `API-26` | PATCH | `/experts/{id}/enabled` | `UC-B1-04` | 启用/停用 | 200 详情 |
| `API-27` | DELETE | `/experts/{id}` | `UC-B1-04` | 删除；被工作流引用则 409 | 204 |
| `API-28` | PUT | `/experts/{id}/skills` | `UC-B1-05` | 整体替换有序 Skill | 200 专家详情 |
| `API-29` | PUT | `/experts/{id}/tools` | `UC-B1-05` | 整体替换有序工具 | 200 专家详情 |
| `API-30` | PATCH | `/experts/{id}` | `UC-B1-04` / `UC-B1-05` | 聚合部分更新五区、引用与装配；一次事务 | 200 专家详情 |
| `API-31` | GET | `/workflows` | `UC-B3-01` | 工作流列表/检索 | 200 列表 |
| `API-32` | POST | `/workflows` | `UC-B3-01` | 创建工作流；初始为空图 | 201 + Location |
| `API-33` | GET | `/workflows/{id}` | `UC-B3-01` | 工作流详情（含 graph） | 200 详情 |
| `API-34` | PUT | `/workflows/{id}` | `UC-B3-01` | 更新名称/类型/描述 | 200 详情 |
| `API-35` | DELETE | `/workflows/{id}` | `UC-B3-01` | 删除工作流及定义/引用 | 204 |
| `API-36` | POST | `/workflows/{id}/copy` | `UC-B3-01` | 复制图，自动处理名称后缀 | 201 + Location |
| `API-37` | PUT | `/workflows/{id}/definition` | `UC-B3-02` | 保存当前图；语义问题返回 warning | 200 `{workflow,warnings}` |
| `API-38` | POST | `/workflows/{id}/validate` | `UC-B3-02` | 只校验图，不写入 | 200 `ValidationReport` |
| `API-39` | GET | `/workflows/{id}/dsl` | `UC-B3-03` | 导出 JSON/YAML DSL | 200 文件 |
| `API-40` | POST | `/workflows/import` | `UC-B3-03` | 从严导入 DSL，新建工作流 | 201 `{workflow,idMap,warnings}` |

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
| `description` | string | 1–400 字；路由描述（适用场景、触发条件、不适用场景），列表检索使用 |
| `version` | string | `vX.Y`，服务端维护 |
| `enabled` | boolean | 启停 |
| `tags` | string[] | 标签，有序 |
| `usedByCount` | number | 派生：引用专家数 |
| `revision` | number | 乐观锁 |
| `updatedAt` | string | ISO-8601 |

**详情 `SkillDetail`**：列表项 + `body: string`、`files: SkillFile[]`、`createdAt`。

**`SkillFile`**：`{path:string, size:number, readOnly:boolean}`；`files` 含 `SKILL.md` 且首项，其余按 `path` 升序；已保存状态全部 `readOnly=true`；草稿中 `SKILL.md` 为 `true`、附件为 `false`。

- `name`、`description`、`version` 以包内 `SKILL.md` frontmatter 为准；分类、标签、启停、revision、时间取自 brief。
- `body` 是 `SKILL.md` frontmatter 结束后的剩余内容，读取时不做 trim。
- 包缺失/损坏返回 500 `package_unavailable`，不回落 brief；停用 Skill 照常可读。
- 列表不读 zip；详情只读 zip 中央目录与 `SKILL.md`，不读附件内容。

**查询参数**：`q`（匹配 `name` 或 `description`）、`category`、`enabled`、`tag`、`limit`、`offset`、`sort`（`name:asc|desc`、`updatedAt:asc|desc`、`version:asc|desc`，默认 `updatedAt:desc`）。

**草稿 DTO `SkillDraft`**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | UUID；bearer capability，不做所有权校验 |
| `skillId` | string \| null | 新建为 null |
| `baseRevision` | number \| null | 新建为 null |
| `baseVersion` | string \| null | 新建为 null |
| `expiresAt` | string | 创建后 24 小时，不滑动 |
| `createdAt` | string | ISO-8601 |
| `files` | `SkillFile[]` | 已有 Skill 含只读 `SKILL.md`；新建为空 |

**建草稿 `POST /skill-drafts`**（`SKP-09`）

```json
{ "skillId": "0191f2f0-7a5e-7c3b-9d1a-3f2b4c5d6e7f" }
```

- `skillId` 缺省或 `null` 表示新建；已有 Skill 复制当前包。
- 已有 Skill：`files` 含只读 `SKILL.md` 与附件，`baseRevision`/`baseVersion` 取当前值。
- 新建：空目录，三个字段为 null；成功 201，`Location: /api/v1/skill-drafts/{id}`。
- `skillId` 不存在 404；包缺失/损坏 500 `package_unavailable`；允许对停用 Skill 建草稿，允许多个草稿并存。

**读草稿 `GET /skill-drafts/{id}`**（`SKP-10`）

- 返回 `SkillDraft`；不返回正文；不存在 404；过期但未清理 410 `draft_expired`；已清理 404。
- 不提供草稿列表、草稿包下载或单文件读取。

**上传/覆盖附件 `POST /skill-drafts/{id}/files`**（`SKP-11`）

- `content-type: multipart/form-data`，字段 `path`（文本）与 `file`（二进制）；一次一个文件。
- `path` 必须在 `scripts/` 或 `references/` 下，允许子目录；不接受 `SKILL.md`；同路径覆盖，不推进 revision/version。
- 0–20 MiB；附件 ≤99；含 `SKILL.md` 总量 ≤100 MiB；新建草稿预留 16 KiB 给 `SKILL.md`。
- 响应 200 `{file:SkillFile, files:SkillFile[]}`；`files` 按 `SKILL.md` 首项、其余 `path` 升序。
- 非 multipart 415 `unsupported_media_type`；字段缺失/路径非法 400；超限 413 `payload_too_large`；不改变 `expiresAt`。

**改名 `PATCH /skill-drafts/{id}/files`**（`SKP-12`）

```json
{ "path": "scripts/old.sh", "newPath": "references/new.sh" }
```

- 源必须是附件且存在；目标不能存在；`SKILL.md` 不可作为源或目标；新旧相同 400。
- 允许跨 `scripts/` 与 `references/`；路径规则同上传；成功 200 `{file,files}`。
- 目标已存在 409 `file_conflict`；源不存在 404；草稿过期 410。

**删除附件 `DELETE /skill-drafts/{id}/files?path=...`**（`SKP-13`）

- 只删附件；`SKILL.md` 400；不存在 404；成功 204；不推进 revision/version。

**取消草稿 `DELETE /skill-drafts/{id}`**（`SKP-14`）

- 删除草稿记录与目录；成功 204；不存在 404；已过期按 204 处理（能清理就清理）；不影响已保存 Skill。

**保存 `POST /skill-drafts/{id}/save`**（`SKP-15`）

```json
{
  "name": "调用链分析",
  "categoryCode": "coding",
  "description": "基于 Call Trace 定位符号引用链，圈定影响面",
  "tags": ["调用链", "Trace"],
  "body": "## 适用场景\n..."
}
```

- `name`、`categoryCode`、`description`、`body` 必填；`body` 可为空字符串；`tags` 可省略，默认 `[]`；未知字段 400。
- 不接受 `enabled`、`version`、`id`、`skillId`、`baseRevision` 或文件清单；启停另走 `SKP-07`。
- 名称冲突 409 `name_conflict`；`categoryCode` 不存在 400 `validation_error`。
- 已有草稿必须带 `If-Match: "<baseRevision>"`；缺失 428，格式非法 400，值不等于 `baseRevision` 或与当前 revision 不一致 409；新建草稿不带 `If-Match`，带了 400。
- 新建 `v1.0`、revision 1、`enabled=true`；更新 minor+1，`v1.9` → `v2.0`。
- 服务端生成 `SKILL.md`（frontmatter 三键 + `body`，换行统一、末尾一个换行）；最终 ≤16384 UTF-8 字节，超出 422 `skill_md_too_large`。
- 成功：写新包 → fsync → 单事务更新 brief/`package_key`/revision/version/时间并删草稿记录 → 提交 → 删草稿目录；新建 201，更新 200；体为 `{id,revision,version,updatedAt}`，新建带 `Location: /api/v1/skills/{id}`。
- 失败：草稿保留，旧包与旧 brief 不变；数据库失败 503；包/`SKILL.md` 缺失或损坏 500 `package_unavailable`。
- 保存成功即消费草稿；之后 `GET` 该草稿 404；不要盲目重试同一草稿。

**启停与删除**

- `PATCH /skills/{id}/enabled`（`SKP-07`）：`{enabled:boolean}`，必须 `If-Match`；只改 brief，不重建包；成功 200 `SkillDetail`。
- `DELETE /skills/{id}`（`SKP-08`）：必须 `If-Match`；有专家引用 409 `referenced`；成功 204；不保留版本历史、不可恢复。

**编排文档 `GET /skills/{id}/document`**（`SKP-03`）

- 响应包内 `SKILL.md` 原始字节，`text/markdown; charset=utf-8`；`ETag` 与 `If-Match` 同格式（`"<revision>"`）；`If-None-Match` 命中返回 304；`Cache-Control: no-cache`。
- 不重新合成、不追加五章/踩坑/引用；停用 Skill 同样可读；缺失资源 404；包缺失/损坏 500 `package_unavailable`。
- 条件请求在 Skill 与包存在性校验之后评估；包缺失不返回 304。

**整包下载 `GET /skills/{id}/download`**（`SKP-04`）

- 返回当前 zip，`application/zip`；`Content-Length` 为包文件大小；`ETag`、`Cache-Control: no-cache`、`X-Content-Type-Options: nosniff`。
- `Content-Disposition: attachment`；文件名 `<name>-<version>.zip`，同时给 ASCII 回退与 `filename*=UTF-8''...`；清洗引号、CRLF、路径分隔符。
- 缺失 Skill 404；包缺失/损坏 500 `package_unavailable`；停用可下载；不提供单文件下载、Range、内联预览。
- 条件请求在 Skill 与包存在性校验之后评估；包缺失不返回 304。

**分类**：`GET /skill-categories` 返回 `{items:[{code,label,position}]}`，无分页。

`GET /skills` 的 `category` 是查询参数名；保存请求的字段名是 `categoryCode`，两者不要混用。`sort` 的传输值用 `name:asc` 这类冒号形式，领域查询再转换。

> 对齐说明：契约 §6.1 用领域名 `categoryCode` 和 `name`/`-name` 描述查询；HTTP 传输沿用现有网关的 `category` 与 `name:asc|desc`，并保留已有的 `version` 排序。映射在 `http-gateway` 完成，不把 `categoryCode` 直接当查询参数名。

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
| `refCount` | number | 引用该专家的去重工作流数；B3 起由 `workflow_expert_ref` 计算 |
| `skills` | `ExpertSkillPreview[]` | 前 3 个装配 Skill 预览，按装配顺序；无装配为空数组 |
| `revision` | number | 乐观锁 |
| `updatedAt` | string | ISO-8601 |

**详情 `ExpertDetail`**：共享字段 + `duty`、`skillOrder`、`verifyOrder`、`notes`、`skills: ExpertSkillSummary[]`、`tools: ExpertToolSummary[]`、`refs: ExpertRef[]`、`createdAt`。

**`ExpertSkillPreview`**：`{id,name}`，仅用于列表选择/导航。
**`ExpertSkillSummary`**：`{id,name,categoryCode,categoryLabel,description}`。
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
- B3 起专家被工作流节点引用时，专家删除 409 的 `references` 返回 `type="workflow"` 的 `{id,name}`；工作流目前没有 `references` 端点，B4 实例引用后另加。

### 5.6 工作流

**列表项 `WorkflowSummary`**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | UUIDv7 |
| `name` | string | 1–80 字，大小写不敏感唯一 |
| `type` | string | 1–40 字，自由标签 |
| `description` | string | 0–500 字 |
| `nodeCount` | number | 当前图节点数 |
| `stageCount` | number | 当前图阶段数 |
| `revision` | number | 乐观锁，从 1 开始 |
| `createdAt` | string | ISO-8601 |
| `updatedAt` | string | ISO-8601 |

**详情 `WorkflowDetail`**：共享字段 + `graph`。

**`WorkflowGraph`**：`{stages: Stage[], nodes: WorkflowNode[], edges: WorkflowEdge[], viewport?: {x,y,zoom}}`；节点/阶段/边 ID 是工作流内稳定字符串，不是 UUID。`viewport` 是可选画布展示状态：`x/y` 为画布滚动偏移（CSS 像素），`zoom` 为缩放倍数且必须大于 0；随整图保存，不参与执行语义。

- `Stage`：`{id,name}`。
- `WorkflowNode`：`{id,type,name,stageId:string|null,expertId:string|null}`；`type` 为 `start|end|agent|review|confirm|fanout|fanin`。
- `WorkflowEdge`：`{id,from,to,kind}`；`kind` 为 `seq|rollback`。
- DSL 顶层 `layout.viewport={x,y,zoom}` 与 `WorkflowGraph.viewport` 双向映射；只用于展示，不参与执行语义。

**查询参数**：`q`、`type`、`limit`、`offset`、`sort`（`name`、`updatedAt`）。

**创建/更新请求**：`{name,type,description?}`；`PUT` 的 `description` 也必填（可为空串）。

**`CopyWorkflow`**：`{name?: string}`；省略时默认 `"{源名称} 副本"`，冲突自动追加 ` (2)`…` (99)`；节点/阶段/边 ID 原样保留。

**`SaveDefinitionInput`**：`{graph: WorkflowGraph}`；整图替换，`graph.viewport` 随图保存或清空；形状错误 400，语义问题 200 + `warnings`，专家不存在 400 并回滚。

**`ValidationReport`**：`{errors:[{code,path,message}],warnings:[{code,path,message}]}`；`validate` 只读专家状态，不写库。

**`WorkflowDsl`**：`{dslVersion:1,metadata:{name,type,description},stages,nodes,edges,layout?}`；导入只接受 JSON，导出支持 `?format=json|yaml`。

### 5.7 端点 → 组件方法

本文只定义 HTTP 传输契约；领域方法、领域输入/输出类型与不变量定义在各组件规格中。DTO 是传输形状，不是方法定义来源。

- Harness：[`../harness/spec.md`](../harness/spec.md)
- 工具：[`../tool/spec.md`](../tool/spec.md)
- Skill：[`../skill/spec.md`](../skill/spec.md)
- 专家：[`../expert/spec.md`](../expert/spec.md)
- 工作流：[`../workflow/spec.md`](../workflow/spec.md)
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
| `SKP-01` | `catalog.listSkills` |
| `SKP-02` | `catalog.getSkill` |
| `SKP-03` | `catalog.getSkillDocument` |
| `SKP-04` | `catalog.getSkillPackage` |
| `SKP-05` | `catalog.listSkillCategories` |
| `SKP-06` | `catalog.referencesForSkill` |
| `SKP-07` | `skill.setEnabled` + `catalog.getSkill` |
| `SKP-08` | `skill.delete` |
| `SKP-09` | `skill.createDraft` |
| `SKP-10` | `skill.getDraft` |
| `SKP-11` | `skill.uploadDraftFile` |
| `SKP-12` | `skill.renameDraftFile` |
| `SKP-13` | `skill.deleteDraftFile` |
| `SKP-14` | `skill.cancelDraft` |
| `SKP-15` | `skill.saveDraft` |
| `API-22` | `catalog.listExperts` |
| `API-23` | `catalog.getExpert` |
| `API-24` | `expert.create` + `catalog.getExpert` |
| `API-25` | `expert.update` + `catalog.getExpert` |
| `API-26` | `expert.setEnabled` + `catalog.getExpert` |
| `API-27` | `expert.delete` |
| `API-28` | `expert.setSkills` + `catalog.getExpert` |
| `API-29` | `expert.setTools` + `catalog.getExpert` |
| `API-30` | `expert.updateAggregate` + `catalog.getExpert` |
| `API-31` | `catalog.listWorkflows` |
| `API-32` | `workflow.create` + `catalog.getWorkflow` |
| `API-33` | `catalog.getWorkflow` |
| `API-34` | `workflow.update` + `catalog.getWorkflow` |
| `API-35` | `workflow.delete` |
| `API-36` | `workflow.copy` + `catalog.getWorkflow` |
| `API-37` | `workflow.saveDefinition` + `catalog.getWorkflow` |
| `API-38` | `catalog.getWorkflow`（存在性）+ `workflow.validate` |
| `API-39` | `workflow.exportDsl` |
| `API-40` | `workflow.importDsl` + `catalog.getWorkflow` |
| `API-H` | `platform.Health.check` |

- 写端点由 `http-gateway` 调用领域写方法，再用 `catalog` 回读详情；路由层不拼字段。`SKP-15` 例外：保存返回 `SaveSkillResult`，不回读整包。
- `API-28/29` 的请求体只表达装配顺序；`API-30` 的请求体可同时表达五区、引用与两类装配顺序；`catalog` 负责把 `skillIds`/`toolIds` 解析为摘要。
- 领域方法表见各组件规格的「方法契约」章节。

## 6 外部 UI 页面映射（参考，不属于本仓库交付与验收）

| UI 页面 / 组件 | 端点 | 说明 |
|---|---|---|
| `harnesses.html` / `CMP-harnesses` | `API-01`～`API-07` | 列表、详情、注册、编辑、启停、删除、工具引用 |
| `tools.html` / `CMP-tools` | `API-08`～`API-13` | 列表、详情、注册、编辑、删除、专家引用；无启停/调试 |
| `skills.html` / `CMP-skills` | `SKP-01`～`SKP-15` | 列表、详情、整包下载、启停、删除、专家引用、分类、草稿与保存 |
| `experts.html` / `CMP-experts` | `API-22`～`API-30` | 列表、详情、五区、启停、删除、Skill/工具装配、聚合保存 |
| 工作流定义页 | `API-31`～`API-40` | 列表、创建、详情、编辑、删除、复制、图保存/校验、DSL 导入导出 |
| 其他页面 | 无端点 | Key/工作区、B4 实例/运行、看板不在本仓库 |

外部 UI 夹具与契约字段不同（如 `k`→`key`、`desc`→`description`、`harness`→`harnessId`/`harnessName`、`usedBy`→`usedByCount`、`CLI/MCP/脚本`→`cli/mcp/script`、中文状态→英文代码）；若接入，由该项目适配层映射，不把 `MOCK` 形状带进契约。

B1/B3 不提供的运行时字段：Harness 当前任务数/运行中任务、工具执行历史/成功率、专家工作流节点引用明细、Skill 执行统计。外部 UI 若展示这些字段，由该项目自行标注「未接入」，本仓库不伪造；`lastHeartbeatAt` / `lastDebugAt` 只展示种子值或空值。

B1/B3 不提供的页面动作：Harness 连接测试/心跳刷新、工具调试/标记可用、Skill 版本历史/回滚、专家绑定工作流/节点引用。外部 UI 若保留这些按钮，只做展示，不接本仓库 API。

外部接入验证建议（参考）：

1. 按端点表写适配层，字段名逐一对应 DTO；不直接复用本项目类型。
2. 用 `If-Match` 验证并发：缺失 428、旧版本 409；Skill 新建保存不带，已有保存必须带。
3. 用删除引用场景验证 409 `referenced` 与 `details.references`。
4. 用 Skill 草稿验证：建草稿、上传附件、改名、删除、保存、成功后草稿 404、过期 410。
5. 用 Skill 保存验证 `version` 递增与 `SKILL.md` 16 KiB；客户端不传 `version`/`enabled`。
6. 用整包下载验证 zip、`Content-Disposition`、`ETag`/304；不提供单文件下载。
7. 用专家装配验证顺序与 `revision`；Skill/工具列表整体替换；一次保存五区与两类装配时使用 `PATCH /experts/{id}`，确认只递增一次 `revision`。
8. 工作流验证：`If-Match` 缺失 428、旧版本 409；保存语义问题 200 + warnings，形状错误 400；DSL 导入缺失专家清空并 warning；专家删除被工作流引用 409。
9. 忽略未知字段；遇到契约缺口先改本文，不跨项目改代码。

## 7 契约测试

- 每个端点 3 正 1 反；断言具体状态码、字段值、列表顺序、错误 `code`。
- 公共：分页、筛选、排序、404、400、409、410、413、415、422、428、500、503 映射。
- Skill 包：列表不读 zip；详情 `body`/`files`；文档逐字一致；下载 zip 可解压、文件名合规；包缺失 500 `package_unavailable`；停用可读/可下载。
- Skill 草稿：建草稿（空/已有）、文件清单顺序、上传/覆盖/改名/删除、`SKILL.md` 保留、路径穿越、TTL 过期、取消、多草稿并存。
- Skill 保存：新建/更新、`If-Match` 缺失/非法/旧值、名称冲突、版本进位、`SKILL.md` 超限、文件/总量超限、打包失败、数据库失败、成功后草稿 404。
- 删除：Harness 被工具引用、工具/Skill 被专家引用、专家被工作流引用；无引用 204。
- 装配：重复目标、目标不存在、旧 `revision`、顺序回读；聚合保存的省略/替换/清空语义。
- 工作流：列表/详情、复制后缀、图保存/校验、DSL JSON/YAML、导入缺失专家、revision 冲突、validate 404。
- 契约快照：响应字段集合与 DTO 表一致；新增字段必须更新本文。
- 外部 UI 若接入，可用同一份端点/DTO 表做适配层契约测试；不共享代码。

## 8 依赖与边界

- 允许：`catalog` 读契约；四类资产写服务；工作流写服务；`platform` 的 `Health`；`kernel` 的错误、分页、ID/时钟类型；Bun 的 multipart/流读取；文档子模块的 Bun 文件读取与本地静态资源。
- 禁止：导入任何 store；执行 SQL；直接使用 `FileStore` 或 Bun 文件 API 读写包/草稿；在路由层实现名称唯一、引用保护、版本递增、路径校验等业务规则；直接序列化领域实体；文档子模块接触数据库或领域服务。
- 校验分工：HTTP 校验 multipart/JSON 形状、必填、类型、简单范围、未知字段、请求体大小；领域校验路径、文件数/总量、唯一性、引用、状态与事务不变量。
- 错误映射：领域错误 → HTTP `code`/状态码；未知异常 → 500，不泄漏 SQL/堆栈。

## 9 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 36 KB；OpenAPI 运行时资产约 85 KB、Swagger UI 静态资源约 2.14 MB，均单独计量，不计入组件预算。
- 单独验证命令：`bun test tests/components/http-gateway`。
- 文档入口：启动后访问 `/docs`；机器可读契约：`/openapi.yaml`。OpenAPI 资产随组件发布，覆盖 47 个业务 operation 与 Skill 包/草稿、工作流定义 DTO。
- 当前状态：`current`；B1 资产端点与 B3 工作流定义端点均已实现，运行时 OpenAPI 为 31 个 path、48 个 operation（含 `/healthz`）；B3 验证记录见 [工作流工序 result.md](../../../history/works/2026-10-28-workflow-definition/result.md)。

## 10 B1/B3 实现口径与剩余问题

- `SKP-05` 保留为独立只读资源 `GET /skill-categories`，便于外部客户端下拉直接消费。
- `API-28` / `API-29` 保持分开，避免一次保存两类装配关系时互相覆盖；`API-30` 提供一次保存五区、引用与两类装配的聚合入口，领域内仍是单事务、单 `revision`。
- `SKP-15` 的保存结果只返回 `{id,revision,version,updatedAt}`；需要详情时再 `GET /skills/{id}`，不在保存路由里回读整包。
- 错误体不新增顶层 `fieldErrors`，字段级错误仍放在 `details`：单字段为 `details.field` / `details.reason`，多字段为 `details.fieldErrors` 数组。
- 本仓库不配置 CORS；外部浏览器若跨源调用，由部署层同源代理或调用方处理，不在本仓库范围。
- Swagger UI 是开发者文档，不是产品 UI；`/docs` 与 `/openapi.yaml` 不改变“只提供 HTTP API、无 CLI/库/产品 UI”的边界。
