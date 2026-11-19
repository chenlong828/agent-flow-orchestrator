---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-17-client-observability-integration
level: P1
---

# 集成设计：orchestrator 对接 client 观测面（文件 + session）

> 状态：**P1 集成设计，未冻结**。输入是 client 已实现的 `client-observability-v1`（`2026-11-17.1`）与验证结论。
> 本文只定 orchestrator 消费范围、产品 API、适配器、契约与测试；不改 client 代码。

## 0 结论

| # | 决策 | 内容 |
|---|---|---|
| `D-01` | 消费范围 | 消费 `O-09`/`O-10` 文件 + `O-06`/`O-07`/`O-08`/`O-11` session；**内部用 `O-02` 反查运行中 sessionId**，**不代理** attempt 产品端点 |
| `D-02` | 产品 API | 6 个：文件 2（`API-48`/`API-49`）+ session 4（`API-50` 详情、`API-51` 事件、`API-52` 富事件 SSE、`API-53` raw） |
| `D-03` | 适配器 | 新增 orchestrator `CMP-observability-client` L0；实现 `ClientRunFiles`/`ClientSessionObservability` 端口；`CMP-run` 不直接发 HTTP |
| `D-04` | 发现 | v1 client 在 poll 带 `X-Observability-Url` 自报，orchestrator 内存目录；静态配置/allowlist 后置；适配器校验 URL |
| `D-05` | 鉴权 | 默认 client loopback 无 token；适配器仅在 harness 有 `client_token` 时带 Bearer；非 loopback 由 client 强制 token |
| `D-06` | 运行身份 | `TaskRequest.runId?` 由 poll 富化；`run_node.session_id` 内部读取；session 产品响应不回 `sessionId` |
| `D-07` | 限制 | 接受 client 2000 条 / 1 MiB；适配器 2 MiB/5s；UI BFF 10s 是已知事实限制 |
| `D-08` | 契约 | 执行面只加 `runId`/URL 头，不新增端点、不升协议；无数据库迁移；`CMP-scheduler` 不变 |
| `D-09` | 验证 | CI 用 stub observer 契约测试；真实 client observer HTTP 对接作为工序验证脚本与联调门禁 |
| `D-10` | 已知缺口 | client 的 SSE 续传/慢消费者/保留/`run_gone`/health 占位不阻塞本轮；O-11 BFF 流式需 UI 配套 |

一句话：**orchestrator 把 client 当成“文件 + session（含富事件流）只读提供方”，用 6 个产品 API 暴露给 UI；attempt 归调度面。**

## 1 消费映射

| client 端点 | 是否消费 | orchestrator 落点 | 备注 |
|---|---|---|---|
| `O-01` health | 否 | — | 运维可直连，不代理 |
| `O-02` attempt 列表 | 内部 | `API-50`–`API-53` 的 session 解析 | 仅按 run/node/task 反查 sessionId；不返回 attempt DTO |
| `O-03` attempt 详情 | 否（薄用可选） | — | 同上 |
| `O-04` attempt 日志 | 否 | — | 不代理 preview |
| `O-05` attempt SSE | 否 | — | 不代理 |
| `O-06` session 详情 | 是 | `API-50` | 产品响应剥 `sessionId`/`attemptId` |
| `O-07` session 事件 | 是 | `API-51` | 分页；剥 `sessionId`/`attemptId` |
| `O-08` raw | 是 | `API-53` | 流式；BFF 缓冲已知 |
| `O-09` 文件列表 | 是 | `API-48` | 2000/1 MiB 截断 |
| `O-10` 文件内容 | 是 | `API-49` | 文本/二进制 |
| `O-11` 富 SSE | 是 | `API-52` | 代理时剥 `sessionId`；BFF 必须流式 |

## 2 组件与端口

### 2.1 新增 orchestrator 组件

`CMP-observability-client`（L0 技术边界适配器）：

- 负责：调 client 观测 HTTP、URL/SSRF 校验、Bearer、超时、响应大小、DTO/错误映射、raw 流。
- 不负责：run 状态、产品 DTO、DB、调度、UI。
- 依赖：`ClientRunFiles`/`ClientSessionObservability` 端口实现、`ObservabilityDirectory`、`ClientCredentialReader`、`fetch`。
- 单独验证：stub HTTP server 契约测试。

### 2.2 端口

```ts
type ClientRunFiles = {
  listFiles(input: { clientId: string; runId: string; root: "task-space" | "workspace"; path: string }): Promise<ClientFileListing>;
  readFile(input: { clientId: string; runId: string; root: "task-space" | "workspace"; path: string }): Promise<ClientFileContent>;
};

type ClientSessionObservability = {
  getSession(input: { clientId: string; sessionId: string }): Promise<ClientSessionView>;
  listEvents(input: { clientId: string; sessionId: string; cursor?: string; limit?: number }): Promise<ClientSessionEventPage>;
  openRaw(input: { clientId: string; sessionId: string }): Promise<{ stream: ReadableStream<Uint8Array>; sizeBytes: number; sha256: string }>;
  openEvents(input: { clientId: string; sessionId: string; lastEventId?: string }): Promise<ReadableStream<Uint8Array>>;
};
```

- `openEvents` 代理 client O-11；适配器解析 SSE 帧、剔除 `sessionId` 后重发；不提供 attempt 端口。
- `ClientSessionView` 可含 `sessionId`，但产品层剥离。
- raw 流由适配器返回；产品层设置 `content-type/etag/checksum`。

### 2.3 现有组件改动

| 单元 | 改动 |
|---|---|
| `CMP-run` | `listFiles`/`readFile` 产品方法；`runIdForTask`；`sessionForNode`；产品 DTO 映射；不直接 HTTP |
| `CMP-http-gateway` | 6 个产品 API（含 O-11 SSE 代理）；poll 读 `X-Observability-Url`；task 补 `runId`；OpenAPI |
| `CMP-kernel` | 端口/错误类型 |
| `CMP-platform` | 内存 `ObservabilityDirectory` |
| `CMP-harness` | `clientToken(clientId)` 只读 |
| `CMP-executor-backend` | 注册 URL；task 富化 `runId` |
| `CMP-scheduler` | **不变** |
| `CMP-config` | `[observability.clients]` 静态地址表（可选） |

## 3 产品 API

### 3.1 文件（沿用 `REQ-0002`）

| ID | 方法/路径 | 说明 |
|---|---|---|
| `API-48` | `GET /api/v1/runs/{id}/files` | `root`/`path`；返回 `RunFileListing` |
| `API-49` | `GET /api/v1/runs/{id}/files/content` | 返回 `RunFileContent` |

- 产品 DTO 沿用 [`2026-11-17-run-file-browser/design-proposal.md`](../2026-11-17-run-file-browser/design-proposal.md) §4。
- client 2000/1 MiB 截断通过 `truncated` 暴露；不额外截断。
- `root` 默认 task-space；`path` 相对、拒绝 `..`/绝对路径。

### 3.2 session 代理

| ID | 方法/路径 | 说明 |
|---|---|---|
| `API-50` | `GET /api/v1/runs/{id}/nodes/{nodeId}/session` | `RunSessionView` |
| `API-51` | `GET /api/v1/runs/{id}/nodes/{nodeId}/session/events` | `Page<RunSessionEventView>` |
| `API-52` | `GET /api/v1/runs/{id}/nodes/{nodeId}/session/events/stream` | O-11 富事件 SSE 代理 |
| `API-53` | `GET /api/v1/runs/{id}/nodes/{nodeId}/session/raw` | raw 流 |

- `visit` 可选查询参数；缺省该节点最大 visit；`run_node.session_id` 为空且 `task_id` 存在时，用 `O-02` 按 `runId/nodeId/taskId` 反查 sessionId；仍为空 → 404 `session_not_linked`。
- `RunSessionView`：`runId`、`nodeId`、`visit`、`status`、`cwd`、`startedAt`、`finishedAt`、`eventCount`、`archive {status,sizeBytes,sha256}`；**不含 `sessionId`/`attemptId`**。
- `RunSessionEventView`：`seq`、`ts`、`kind`、`event`、`message`、`data`；**顶层与 `data` 均不含 `sessionId`/`attemptId`**。
- raw：`application/zstd`；`content-length`、`etag`、`x-checksum-sha256`；不暴露 client `downloadUrl`。
- O-11 SSE：`text/event-stream`；事件 `snapshot` / `event` / `heartbeat` / `end`；`snapshot` 的 `events[]`、`event` 的 data 用 `RunSessionRichEvent`；**剔除 `sessionId`、`attemptId`**；`last-event-id` 透传给 client。
- `RunSessionRichEvent`：`seq`、`ts`、`kind`（lifecycle/prompt/message/thought/tool_call/tool_result/usage/permission/config/other）、`messageId?`、`toolCallId?`、`lifecycle?`、`acpType?`、`text?`、`tool?`、`usage?`、`permission?`、`stopReason?`、`error?`、`data?`、`truncated?`、`originalBytes?`。
- O-11 只覆盖运行中/内存 ring；历史看 `O-07` + `O-08`。recorder 目前只发 `session.started` / `prompt.result` / `session.closed` 未发，集成不依赖 `session.closed`。
- `rich_stream_enabled=false` → 503 `rich_stream_disabled`；适配器透传 503。
- **UI BFF 必须改流式**；当前 BFF 全量缓冲，SSE 会被缓冲/10s 超时。该改动归 UI 项目，不在本仓库。
- `run_node.session_id` 仍不进入 `RunNodeView`；只在代理内部使用。

### 3.3 错误映射

| client | 产品 |
|---|---|
| 200 | 200 |
| 400 `validation_error`/`path_escape` | 400 `validation_error` |
| 401 | 502 `client_observability_unauthorized` |
| 403 `file_permission_denied`/`raw_disabled` | 403 `file_permission_denied` / 502 `raw_disabled` |
| 404 `run_not_found`/`file_not_found`/`session_not_found` | 404 对应 |
| 409 `archive_not_ready` | 409 `session_archive_not_ready` |
| 410 `run_gone`/`observation_gone` | 410 对应；client 当前实际 404，按 404 透传 |
| 415 | 415 |
| 429 | 429 |
| 5xx | 502/503 |
| 连接失败/超时 | 504 `client_observability_unavailable` |
| URL/响应非法 | 502 `client_observability_invalid` |

## 4 发现与鉴权

- client 在 poll 请求头带 `X-Observability-Url`（仅 enabled）；orchestrator 的 poll 路由读头，写内存 `ObservabilityDirectory`（clientId → URL）；不落库。
- **v1 只做自报 + 内存目录**；静态配置 `[observability.clients]`/allowlist 后置（列入组件规格待定）。适配器校验 http(s)、拒绝 userinfo/fragment、不跟随重定向、超时、响应上限。
- token：`auth=on` 时 client 校验 Bearer；orchestrator 从 `harness.client_token` 取 token 并在有值时带 `Authorization`；`auth=off`/loopback 无 token。
- client 非 loopback 无 token 会拒绝启动（config 已实现）；orchestrator 侧不替 client 决定。
- `EXECUTOR_AUTH=off` 且无 token：仅 loopback 可用；跨机需 client/auth token。

## 5 适配器行为

- URL：`http(s)://host:port/api/v1/observability`；拼接 `/runs/<runId>/files...`、`/sessions/<sessionId>...`。
- 一元请求超时 5s；raw 流空闲 120s；响应体 ≤2 MiB（JSON）；raw 不设总大小，流式。
- 不跟随重定向；不向第三方 host 发 Authorization；不重试；不缓存。
- 错误：`ClientObservabilityUnavailableError`、`ClientObservabilityUnauthorizedError`、`ClientObservabilityInvalidError`。
- 请求/响应不记录文件内容/session 内容；只记 runId/clientId/root/path/bytes/码。

## 6 `run` 与网关

- `run.listFiles/readFile`：`loadRun` 取 `client_id`；校验 root/path；调端口；映射产品 DTO（补 `path/hidden/previewable/contentType/language`）。
- `run.sessionForNode(runId, nodeId, visit?)`：读 `run_node.session_id`；供 session 代理；不进入 `RunNodeView`。
- `run.runIdForTask(taskId)`：`select run_id from run_node where task_id = $1`；poll 富化。
- 网关 poll：读 `X-Observability-Url` → `executor-backend.registerObservability`；随后 `scheduler.poll`；给 task 补 `runId`；`ExecutorTask` DTO 增 `runId?`。
- 网关产品 API：6 个路由；session raw/SSE 流式；session 详情/事件 JSON。
- 无 `fileRequests`/`fileResponses`；执行面 5 端点不变。

## 7 契约 diff

### 7.1 执行面 `executor-http-v3`

- `TaskRequest` 增可选 `runId: string`；manual task 可缺。
- poll 请求头增可选 `X-Observability-Url`（≤2048，http(s)）。
- 客户端承诺：`C-16` 上报 URL；`C-17` 持久化 run→路径/关联 session。
- 无新端点；协议仍 `3`。

### 7.2 观测面

- 权威在 client `docs/design/contracts/client-observability-v1.md`；orchestrator 只在适配器实现中消费，不复制完整契约。
- 本集成不要求 client 改任何端点；验证 Hold 项另行处理。

### 7.3 产品面

- 54 → 60：`API-48`–`API-53`；OpenAPI 6 path；executor 端点不写入产品 `paths`。
- `RunSessionView`/`RunSessionEventView` 新 DTO；`RunFileListing`/`RunFileContent` 沿用。

## 8 测试计划

| 层 | 用例 |
|---|---|
| 适配器 | stub observer：文件/session 200；400/401/403/404/409/410/415/429；超时；响应超限；重定向；非法 URL/SSRF；raw 流 |
| run | 文件映射、`runIdForTask`、`sessionForNode`；无 DB 写入 |
| 网关 | 6 个产品 API（含 SSE）；poll URL 头；runId 富化；旧 client 无 URL → 503 |
| 真实对接 | 起 client observer（临时 state，真实 HTTP）；用产品 API 取文件/session/raw；记录到工序 `probe/`；不纳入 CI |
| 回归 | `bun run check`；`docs:check`；OpenAPI 字段白名单 |

## 9 发布、回滚与已知缺口

- 顺序：client 观测面（已实现）→ orchestrator 适配器/产品 API → UI。
- 旧 orchestrator + 新 client：`runId`/URL 无人消费；任务正常。
- 新 orchestrator + 旧 client：无 URL/文件/session → 503；任务正常。
- 回滚：下线 6 个产品 API/适配器；无 DB 迁移；任务不受影响。
- 已知缺口：client 2000/1 MiB、2 MiB/5s 未在 client、raw/SSE BFF 缓冲、SSE 续传/慢消费者/保留/health 占位；本集成不修，按验证 `review.md` 转 client 后续。
- client 工作区未提交；集成前需 client 侧确认提交版本。

## 10 P1 确认清单

- [ ] 消费范围：文件 + session 4（含 O-11）；不代理 attempt。
- [ ] 产品 API 6 个与 DTO；session 响应/SSE data 不含 sessionId/attemptId。
- [ ] 适配器 `CMP-observability-client` + 端口（含 `openEvents`）+ URL 目录/token 读取。
- [ ] 执行面只加 `runId`/URL 头；无新端点、无迁移、scheduler 不变。
- [ ] 文件限制接受 client 2000/1 MiB；2 MiB/5s 在适配器/BFF 侧。
- [ ] 已知 client Hold 项不阻塞本轮；另行修复。
- [ ] 真实 observer 对接探针作为工序验证，不纳入 CI。
