---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-17-client-observability
level: P1
---

# 修正提案：client 只读观测面（session 为主 + 少量 attempt + 运行文件）

> 状态：**P1 提案，未冻结**。2026-11-17 用户裁决：
> 1. 保留少量 attempt；2. session 代理与文件都做；3. 新增组件拆分；4. 默认不走 token、本地透传、监听 `127.0.0.1`，与开发期 executor 权限同款开关；5. `serve` 观测面失败降级；6. 网络同机/同网段可以；7. v1 先不设业务上限，运行一段时间再看。
> 本文是跨项目交接草案：client 观测 API 权威在 client 仓库；orchestrator 保留同构副本供适配器使用。本文不改代码、不改组件规格、不建迁移。

## 0 结论

| # | 决策 | 内容 |
|---|---|---|
| `D-01` | 定位 | client 提供 **session 为主**的只读观测；attempt 只保留薄列表/详情，不做 attempt 日志与 SSE |
| `D-02` | 端点 | `O-01` health、`O-02`/`O-03` 薄 attempt、`O-04`–`O-08` session、`O-09`/`O-10` 运行文件 |
| `D-03` | 通道 | orchestrator 直连 client 只读观测 HTTP；删除 poll 文件请求/回传 |
| `D-04` | 运行身份 | `TaskRequest` 增可选 `runId`；client 持久化 run 注册表；session meta 关联 run/node/task/attempt |
| `D-05` | 文件边界 | 只读、run-scoped、相对路径；不提供任意绝对路径、不跨 run、不写 |
| `D-06` | 默认权限 | 默认 `bind=127.0.0.1`、`auth=off`、无 token，本地透传；与开发期 executor 权限同款 |
| `D-07` | 开关 | `auth=on` 时要求 Bearer；`auth=off` + 非 loopback 必须显式 `allow_unauthenticated=true`，否则拒绝启动 |
| `D-08` | 发现 | 静态配置优先；client 在 poll 带 `X-Observability-Url` 作为 loopback/开发期自报；适配器校验防 SSRF |
| `D-09` | client 组件 | 新增 `CMP-observer` L0（HTTP/查询/文件）；`CMP-observability` 仍只管 session 事件存储/日志/doctor |
| `D-10` | orchestrator 组件 | 新增 `CMP-observability-client` L0 适配器（观测面的 HTTP 客户端），`CMP-run` 调端口，`CMP-scheduler` 不变 |
| `D-11` | 产品面 | 文件 2 个 + session 代理 4 个，都做；attempt 不代理（调度面已有） |
| `D-12` | 降级 | `serve` 观测面启动失败默认只降级，poll/执行/结果/归档照常；`required=true` 才退出 4 |
| `D-13` | 限制 | v1 **默认不设业务上限**（目录条数/文件字节/响应字节）；保留可配置占位与超时，观察后再定 |
| `D-14` | 网络 | 同机/同网段/SSH 隧道可用；NAT 后不可达时观测失败，任务执行不受影响 |
| `D-15` | 契约 | 执行面只加 `runId` 与 URL 头，不升协议；观测 API 独立版本；无数据库迁移 |

一句话：**调度面继续拥有 attempt/task 的完整状态；client 提供 session 级细节 + 少量 attempt 薄视图 + 运行文件；orchestrator 直连并代理给 UI，默认本地无 token。**

## 1 背景与 P1 差异

### 1.1 P1 现状

client 仓库 `docs/works/2026-11-06-observability-http/proposal.md`（works 稿，未实现）定义：

- `O-01` health（`activeAttempts`/`retainedAttempts`）。
- `O-02` attempts 列表、`O-03` attempt 详情、`O-04` attempt 日志、`O-05` attempt 日志 SSE。
- `O-06` session 元数据、`O-07` session 事件、`O-08` raw。
- `ObservationEvent` 以 attempt 为键，含 `claimed`/`bound`/`settled`/`reported` 阶段。
- 存储 `attempts/*` + `sessions/*`。
- 组件方案 A：扩展 `CMP-observability`；预算 >60k 或端点 >12 再拆 `CMP-observer`（`OB-04`）。

### 1.2 本次调整

- **attempt 不重复**：调度面的 `task`/`task_attempt`/`run_node` 已有完整状态、次数、错误、时间；client 保留 **薄 attempt 列表/详情**（本地 journal 视角）用于排障，删除 attempt 日志与 attempt SSE。
- **session 为主**：client 独有的是 DSH session 元数据、ACP 事件、raw、cwd、工具/usage；这些是调度面没有的。
- **文件**：task-space/workspace 的目录与文本内容，run-scoped。
- **权限默认本地透传**：与当前开发期 executor 一致，默认无 token、`127.0.0.1`、有开关。

### 1.3 代码事实

- `TaskRequest` 无 `runId`（client `src/components/executor/types.ts`）；`TaskRecord` 无路径；`ArchiveRequest` 有 `runId` + 两个路径，但只在 run 终态下发。
- 调度面 `run_node.session_id` 已由 `0010` 迁移落库，当前**不进入 `RunNodeView` 或产品 API**（`run/spec.md` §2）。
- `CMP-observability` 现行规格明确「不负责进程/文件/网络」「不得读 journal/工作区」；L0 之间不横向调用。
- client `CMP-runtime` 已有 session 原始文件归档；`CMP-workspace` 已有 `readdir`/`realpath`；`CMP-store` 已有 journal。

## 2 目标与非目标

### 目标

1. client 提供 session 级观测面：`O-04`–`O-08`（列表/详情/事件/SSE/raw）。
2. 保留少量 attempt：`O-02` 薄列表、`O-03` 薄详情；不提供 attempt 日志与 SSE。
3. 提供运行文件：`O-09` 列表、`O-10` 内容。
4. orchestrator 直连 client 观测面；文件与 session 都代理给 UI；产品 API/UI 文件入口不变。
5. 默认本地无 token、`127.0.0.1`；有 `auth` 开关；`serve` 观测面失败只降级。
6. 执行面只做加法（`runId`、URL 头），不升协议；orchestrator 无数据库迁移。

### 非目标

- 不做 attempt 日志/SSE；不做 attempt 状态机；这些由调度面提供。
- 不做写入、编辑、上传、删除、终端；观测面仍只读。
- 不做任意绝对路径/跨 run 读取；不提供通用文件系统浏览。
- 不做文件下载/二进制预览（v1 只读文本；二进制只给元数据）。
- 不做运行结束后从服务端归档浏览（`OQ-34`）；不做 confirm 自动快照（`OQ-35`）。
- 不做 TLS/mTLS、token 轮换、跨公网/NAT 自动打洞；v1 依赖同机/同网段/隧道。
- 不改 orchestrator 的 `CMP-scheduler` 任务表与派发逻辑。
- 不把观测面变成控制面。

## 3 修订总览

| 项 | P1 现状 | 本次修订 |
|---|---|---|
| 观测单元 | attempt 为主 | session 为主 + attempt 薄视图 |
| 端点 | O-01–O-08（attempt + session） | O-01–O-10（health + attempt + session + files） |
| 存储 | `attempts/*` + `sessions/*` | 只保留 `sessions/*`；attempt 读 journal；新增 `runs/*` 注册表 |
| 权限 | token 可选；默认 `0.0.0.0` | 默认 `127.0.0.1` + `auth=off` 本地透传；`auth=on` 要 Bearer；非 loopback 无 token 需显式允许 |
| 发现 | 调度器静态配置 | 静态配置优先 + `X-Observability-Url` 自报（仅 loopback/受控）；适配器校验防 SSRF |
| 运行身份 | 无 | `TaskRequest.runId` + session meta 关联 + client 运行注册表 |
| 文件端点 | 无 | `O-09` 列表、`O-10` 内容；run-scoped 相对路径 |
| 组件 | `CMP-observability` 内 | client 新增 `CMP-observer`；orchestrator 新增 `CMP-observability-client` |
| 执行面契约 | v3 | 加 `TaskRequest.runId?`、`X-Observability-Url` 头；不新增端点、不升版本 |
| orchestrator | poll 反向请求 | 文件 + session 代理；`CMP-run` 调端口；scheduler 不变 |
| `serve` 启动失败 | 退出 4 | 默认降级；`required=true` 才退出 |
| 限制 | — | **v1 默认不设业务上限**；保留配置占位与超时 |

### 3.1 P1 端点映射

| P1 | 新编号 | 说明 |
|---|---|---|
| `O-01` health | `O-01` | 去掉 attempt 计数，改 session/run/file 计数 |
| `O-02` attempts 列表 | `O-02` | 保留薄列表（journal 视角），去掉 attemptId |
| `O-03` attempt 详情 | `O-03` | 保留薄详情（状态/错误/时间），无日志 |
| `O-04` attempt 日志 | — | **删除**；会话事件走 session |
| `O-05` attempt 日志 SSE | `O-07` | 改为 **session events stream** |
| `O-06` session 元数据 | `O-05` | session 详情 |
| `O-07` session 事件 | `O-06` | session 事件分页 |
| `O-08` raw | `O-08` | 保持编号 |
| — | `O-04` | **新增** session 列表 |
| — | `O-09`/`O-10` | **新增** 运行文件列表/内容 |

P1 未实现、无消费方，直接换编号，不设兼容窗口。

## 4 运行与 session 模型

### 4.1 runId 与 sessionId

- `runId`：orchestrator 的 `workflow_run.id`；用于文件根与会话关联。client 从 `TaskRequest.runId` 获取。
- `sessionId`：client 建 session 后由 DSH 返回；`TaskResult.sessionId` 回传；调度面落在 `run_node.session_id`（内部字段）。
- session meta：`sessionId`、`runId?`、`instanceId`、`nodeId?`、`taskId?`、`attemptNo?`、`cwd`、`status`、时间、事件数、归档状态。
- **attempt 的权威在调度面**；client 的 attempt 视图来自本地 journal，只做排障，不含 attempt 日志/状态机。

### 4.2 运行注册表

```ts
type RunRecord = {
  runId: string;
  instanceId: string;
  workspacePath: string;
  taskSpacePath: string;
  firstSeenAt: string;
  updatedAt: string;
  archivedAt?: string;
};
```

- 写入：`TaskRequest.runId` 存在时任务接收即 upsert；`ArchiveRequest` 到达时 upsert/刷新并写 `archivedAt`。
- 存储：`<stateRoot>/runs/<runId>.json`；临时文件 + rename；`CMP-store` 唯一写入口。
- 重建：`TaskRecord` 增可选 `runId`/`workspacePath`/`taskSpacePath`；启动时从 journal 重建。
- 保留：已归档 run 从 `archivedAt` 起按保留期（默认 7 天）；活跃 run 永不清理；无归档 run 用 30 天上限兜底。清理后文件端点 410。
- 未知 run：404 `run_not_found`；已清理：410 `run_gone`。

### 4.3 路径与根

- `root`：`task-space`（默认）/ `workspace`。
- `path`：相对 POSIX，`""` 根；拒绝 `..`、`.`/空段、绝对路径、反斜杠、NUL；≤1024 字符、≤64 段。
- 根由 client 从注册表取；调用方不能传绝对路径，不能指定别的 run。
- 列表只返回一层；符号链接列表标记、读取拒绝；`realpath` 必须仍在根内。
- 读取不写盘、不缓存；不做一致性快照。

### 4.4 为什么不让调用方传绝对路径

- 观测面是入站面，默认无 token；接受绝对路径等于把任意文件读取暴露给本机任何进程。
- runId + 注册表把可读范围限制在该 run 的两个根。
- 这是 P1「不提供文件系统路径参数」原则的受控例外。

## 5 观测面端点

基础路径：`/api/v1/observability`；JSON UTF-8、camelCase、ISO-8601 UTC；`Cache-Control: no-store`；全部 `GET`；鉴权按 §9。

| ID | 方法/路径 | 用途 |
|---|---|---|
| `O-01` | `GET /health` | 存活、版本、session/run/file 计数 |
| `O-02` | `GET /attempts` | 薄 attempt 列表（journal 视角） |
| `O-03` | `GET /attempts/{taskId}/{attemptNo}` | 薄 attempt 详情 |
| `O-04` | `GET /sessions` | session 列表 |
| `O-05` | `GET /sessions/{sessionId}` | session 详情 + 关联 + 归档 |
| `O-06` | `GET /sessions/{sessionId}/events` | session 事件分页 |
| `O-07` | `GET /sessions/{sessionId}/events/stream` | session 事件 SSE |
| `O-08` | `GET /sessions/{sessionId}/raw` | 原始 DSH session 下载 |
| `O-09` | `GET /runs/{runId}/files` | 运行文件列表 |
| `O-10` | `GET /runs/{runId}/files/content` | 运行文件内容 |

- 没有 `/attempts/{id}/logs`、没有 attempt SSE；attempt 只有薄列表/详情。
- `observabilityVersion` 升 `2026-11-17.1`。
- `O-01` 不返回路径、配置、token。
- `O-05`/`O-06` 的 `runId`/`nodeId`/`taskId`/`attemptNo` 是关联字段。

## 6 薄 attempt 契约

### 6.1 `O-02` 列表

```http
GET /api/v1/observability/attempts?instanceId=&taskId=&state=&limit=50&cursor=
```

查询：`instanceId`、`taskId`、`state`（`received|running|settled|reported`）、`limit`（1..200，默认 50）、`cursor`。

```json
{
  "items": [
    {
      "taskId": "01a1...",
      "attemptNo": 2,
      "instanceId": "0193...",
      "nodeId": "0193...",
      "sessionId": "<session-id>",
      "state": "settled",
      "resultStatus": "succeeded",
      "startedAt": "2026-11-17T08:02:10Z",
      "finishedAt": "2026-11-17T08:03:40Z",
      "errorCode": null
    }
  ],
  "nextCursor": "eyJzZXEiOjEyM30="
}
```

- 来源：client journal（`TaskRecord`）；不新增 attempt 存储。
- `state` 是 client 本地状态；`resultStatus` 是结果状态；attempt 的权威仍在调度面。
- 排序 `startedAt` 降序。
- 不返回 prompt/result message/日志。

### 6.2 `O-03` 详情

```http
GET /api/v1/observability/attempts/{taskId}/{attemptNo}
```

```json
{
  "attempt": { "...": "同 O-02 item" },
  "error": { "class": "workspace", "code": "not_prepared", "message": "容器不存在" },
  "sessionId": "<session-id>"
}
```

- `error` 来自 client 本地结果；成功为 `null`。
- 无 attempt 日志；日志/事件走 `O-06`/`O-08`（如果 session 存在）。
- 未知 taskId/attemptNo：404 `attempt_not_found`。
- 不提供 attempt 列表的分页详情以外的状态机/verdict。

## 7 Session 端点契约

### 7.1 `O-04` session 列表

```http
GET /api/v1/observability/sessions?instanceId=&runId=&status=&from=&to=&limit=50&cursor=
```

```json
{
  "items": [
    {
      "sessionId": "<session-id>",
      "runId": "01a1...",
      "instanceId": "0193...",
      "nodeId": "0193...",
      "taskId": "01a1...",
      "attemptNo": 2,
      "status": "running",
      "startedAt": "2026-11-17T08:02:10Z",
      "finishedAt": null,
      "eventCount": 84,
      "archiveStatus": "pending"
    }
  ],
  "nextCursor": "eyJzZXEiOjEyM30="
}
```

- `status`：`running|completed|failed|cancelled|timeout`。
- `archiveStatus`：`pending|archived|partial|failed|not_applicable`。
- 排序 `startedAt` 降序，活跃置顶。

### 7.2 `O-05` session 详情

```json
{
  "session": {
    "sessionId": "<session-id>",
    "runId": "01a1...",
    "instanceId": "0193...",
    "nodeId": "0193...",
    "taskId": "01a1...",
    "attemptNo": 2,
    "status": "completed",
    "cwd": "/abs/instance-a",
    "startedAt": "2026-11-17T08:02:10Z",
    "finishedAt": "2026-11-17T08:03:40Z",
    "eventCount": 42,
    "archive": {
      "available": true,
      "sizeBytes": 123456,
      "sha256": "sha256:<hex>",
      "downloadUrl": "/api/v1/observability/sessions/<session-id>/raw"
    }
  },
  "eventRange": { "firstSeq": 1, "lastSeq": 42 }
}
```

- 404 `session_not_found`；410 `observation_gone`；archive 未完成 `available=false`。
- 不返回 attempt 的 verdict/message/状态机。

### 7.3 `O-06` 事件

```http
GET /api/v1/observability/sessions/{sessionId}/events?cursor=&limit=200&kind=acp
```

```json
{
  "items": [
    {
      "seq": 3,
      "ts": "2026-11-17T08:02:12Z",
      "sessionId": "<session-id>",
      "runId": "01a1...",
      "instanceId": "0193...",
      "nodeId": "0193...",
      "taskId": "01a1...",
      "attemptNo": 2,
      "kind": "acp",
      "event": "session.update",
      "message": "tool call: read",
      "data": { "tool": "read", "status": "completed" }
    }
  ],
  "nextCursor": "eyJzZXEiOjN9",
  "truncatedBefore": null
}
```

- `seq` 按 session 单调；`truncatedBefore` 标明保留截断。
- `kind`：`session|acp|error`；**不含** attempt 的 `claimed|bound|settled|reported`。
- `message` 截断/脱敏；`data` 白名单；不返回 prompt/最终全文/推理全文。

### 7.4 `O-07` SSE

```http
GET /api/v1/observability/sessions/{sessionId}/events/stream
Accept: text/event-stream
Last-Event-ID: <seq>
```

- `snapshot` + `log` + `end` + 15s `heartbeat`。
- 慢消费者队列上限 1000；超过 `slow_consumer` 关闭。
- 并发流上限 `maxStreams`（默认 20）；超限 429。

### 7.5 `O-08` raw

- 200：`application/zstd`、`Content-Length`、`ETag`、`X-Checksum-Sha256`、`Accept-Ranges`。
- 409 `archive_not_ready`；404 `session_not_found`；410 `observation_gone`。
- 完整 DSH session（system prompt/推理/工具 I/O）；敏感。

### 7.6 session 错误码

| HTTP | code |
|---:|---|
| 400 | `validation_error` |
| 401 | `unauthorized`（`auth=on`） |
| 404 | `session_not_found` / `attempt_not_found` |
| 409 | `archive_not_ready` |
| 410 | `observation_gone` |
| 429 | `rate_limited` |
| 500 | `unsupported_layout` / `internal` |
| 503 | `service_unavailable` |

## 8 文件端点契约

### 8.1 `O-09` 列表

```http
GET /api/v1/observability/runs/<runId>/files?root=task-space&path=reports
```

```json
{
  "runId": "01a1...",
  "root": "task-space",
  "path": "reports",
  "entries": [
    { "name": "design.md", "type": "file", "sizeBytes": 2048, "modifiedAt": "2026-11-17T08:10:00Z" },
    { "name": "assets", "type": "dir", "sizeBytes": null, "modifiedAt": "2026-11-17T08:09:00Z" }
  ],
  "truncated": false,
  "fetchedAt": "2026-11-17T08:12:00Z"
}
```

- 一层、目录优先/名称升序、`type` file/dir/symlink/other。
- v1 不设 2000 条上限；`truncated` 保留字段，当前恒 false。
- 不返回绝对路径；`name` 单段；orchestrator 拼产品面 `path`。

### 8.2 `O-10` 内容

```http
GET /api/v1/observability/runs/<runId>/files/content?root=task-space&path=reports/design.md
```

```json
{
  "runId": "01a1...",
  "root": "task-space",
  "path": "reports/design.md",
  "name": "design.md",
  "sizeBytes": 2048,
  "modifiedAt": "2026-11-17T08:10:00Z",
  "content": "# 方案\n...",
  "encoding": "utf-8",
  "binary": false,
  "truncated": false,
  "fetchedAt": "2026-11-17T08:12:01Z"
}
```

- v1 不设 1 MiB 上限；`truncated` 当前恒 false。
- 二进制/非法 UTF-8：`content=null`、`encoding=null`、`binary=true`。
- 目录/符号链接当文件读：415 `unsupported_file`。
- 不返回 `contentType`/`language`；orchestrator 映射。

### 8.3 限制（v1 默认关闭）

| 配置 | 默认 | 说明 |
|---|---|---|
| `limits_enabled` | `false` | v1 不设业务上限 |
| `max_file_entries` | 0 | 0 = 不限；观察后再定 |
| `max_file_bytes` | 0 | 0 = 不限；观察后再定 |
| `max_file_response_bytes` | 0 | 0 = 不限；观察后再定 |
| `client_observability_timeout_ms` | 60000 | 适配器超时（技术保护） |
| `client_observability_stream_idle_ms` | 120000 | SSE/raw 空闲超时 |

- **风险**：不设上限时，大目录/大文件会进入 JSON 响应，可能打满 client/orchestrator/浏览器内存；UI BFF 默认 10s 也会先超时。v1 先观察，出问题再加阈值或改流式/分块。
- 文件/会话读取不阻塞 poll/任务；异步 FS；一层列表。
- 不做缓存；`no-store`；`fetchedAt` 只表示读取时间。

### 8.4 文件错误码

| HTTP | code |
|---:|---|
| 400 | `validation_error` / `path_escape` |
| 401 | `unauthorized`（`auth=on`） |
| 403 | `file_permission_denied` |
| 404 | `run_not_found` / `file_not_found` |
| 410 | `run_gone` |
| 415 | `unsupported_file` |
| 500 | `internal` |
| 503 | `service_unavailable` |

## 9 权限、发现与网络

### 9.1 配置

```toml
[observability]
retention_days = 7
max_bytes = 1073741824
max_event_bytes_per_session = 10485760

[observability.http]
enabled = true
required = false                 # true：观测面启动失败则 serve 退出；默认降级
bind = "127.0.0.1"
port = 17890
advertise_url = "http://127.0.0.1:17890/api/v1/observability"
auth = "off"                     # off（默认，本地透传）/ on（Bearer）
token = ""                       # auth=on 时使用；空则回退 [scheduler].token
allow_unauthenticated = false    # auth=off + 非 loopback 必须显式 true
max_streams = 20
raw_enabled = true

[observability.http.limits]
enabled = false
max_file_entries = 0
max_file_bytes = 0
max_file_response_bytes = 0
```

- `auth=off` + loopback：不校验 token，本地透传（与开发期 executor 默认一致）。
- `auth=on`：所有请求要求 Bearer；token 取 `observability.http.token`，空则回退 `[scheduler].token`。
- `auth=off` + 非 loopback：必须 `allow_unauthenticated=true`，否则拒绝启动（`observability_insecure`）。
- `required=false`：bind/初始化失败记 `observability_disabled`，`serve` 继续执行；`required=true` 退出 4。
- `advertise_url` 是调度器可达 URL；`0.0.0.0` 不能作为 advertise。

### 9.2 发现

- client 在 poll 请求头带 `X-Observability-Url`（≤2048，绝对 http(s)），仅当 `enabled=true`。
- orchestrator 的 poll 路由读头，交给 `ObservabilityDirectory`（内存，按 clientId 存 URL）；不落库。
- 静态配置优先：
  ```toml
  [observability.clients]
  "chenlong-mac-01" = "http://127.0.0.1:17890/api/v1/observability"
  ```
- 自报用于 loopback/开发期；`EXECUTOR_AUTH=off` 时不接受非 loopback 自报，必须走静态配置。
- 适配器校验：只接受 http(s)、拒绝 userinfo/fragment/非绝对 URL、不跟随重定向、超时、响应上限、可配 host allowlist。
- 失败：URL 非法不注册；连接失败/超时 → 504 `client_observability_unavailable`；401 → 502 `client_observability_unauthorized`。

### 9.3 鉴权与 token

- `auth=on` 时，orchestrator 从 `harness.client_token` 读 token，作为 Bearer 调观测面；client 用 `[scheduler].token` 或 `observability.http.token` 校验。
- `auth=off` 时，orchestrator 可不带 token；client 忽略 Authorization。
- `EXECUTOR_AUTH=off` 且无 token：只允许 loopback；跨机必须 `auth=on` + token。
- v1 不要把 `observability.http.token` 设为与 `[scheduler].token` 不同的值（调度器只知道 executor token）；独立观测 token 后置。

### 9.4 网络与 TLS

- 观测面是入站：orchestrator 必须能路由到 `advertise_url`。
- 支持同机 loopback、同网段私网、SSH 隧道/反向代理；NAT 后无隧道不可达（任务不受影响）。
- v1 是 HTTP；跨机 token 明文，必须走可信网络/隧道/反代；TLS/mTLS 后置。

## 10 组件定义与区别

### 10.1 client 侧：`CMP-observability` vs `CMP-observer`

| 维度 | `CMP-observability`（现有 L0） | `CMP-observer`（新增 L0） |
|---|---|---|
| 角色 | 观测**数据写入者** | 观测**读取/HTTP 提供者** |
| 负责 | 结构化日志、session 事件写入、脱敏、doctor | 只读 HTTP 路由、鉴权、SSE、session/attempt/file 查询编排 |
| 数据 | `sessions/*/events.jsonl`、日志 | 无持久化 |
| 不负责 | 进程/网络/文件/HTTP/工作区 | 写日志/事件、调度、文件写入 |
| 依赖 | 无（被 observer 通过 `SessionQuery` 使用） | 只读端口：`SessionQuery`、`AttemptQuery`、`RunDirectory`、`RunFileReader`、`SessionArchiveReader` |
| 运行位置 | client `serve` 进程 | 同进程；由 CLI 启动/停止 |

- **拆分理由**：`CMP-observability` 的现行边界是「不负责进程/文件/网络」，把它改成 HTTP/文件组件会破坏边界；P1 的 `OB-04` 也规定端点/预算增长时拆 `CMP-observer`。
- **L0 不横向调用**：observer 只依赖接口，实现在组合根注入；不 import 具体 L0。

### 10.2 orchestrator 侧：`CMP-run` vs `CMP-observability-client`

| 维度 | `CMP-run`（现有 L2） | `CMP-observability-client`（新增 L0） |
|---|---|---|
| 角色 | 运行编排/产品读模型 | 观测面的 HTTP **客户端/适配器** |
| 负责 | run 状态机、节点推进、判定回退、文件产品方法、`runIdForTask`/`sessionForNode` | 调 client 观测面、鉴权、URL/SSRF 校验、超时、DTO/错误映射、流式转发 |
| 数据 | `workflow_run`/`run_node`/`run_artifact` | 无 |
| 不负责 | HTTP、client 地址、token | 编排规则、数据库、run 状态 |
| 依赖 | 端口、现有依赖 | `ClientRunFiles`/`ClientSessionObservability` 实现、`ObservabilityDirectory`、`ClientCredentialReader`、`fetch` |

- **为什么不是同一个组件**：一个在 orchestrator 进程，一个在 client 进程；一个是业务编排，一个是技术边界适配器。把 HTTP 放进 `run` 会违反「run 不向 client 发网络请求」；把编排放进适配器会污染技术边界。
- **命名**：orchestrator 侧用 `CMP-observability-client`（观测面的客户端），client 侧用 `CMP-observer`（观测服务），避免两个 `client-observability` 混淆。

### 10.3 组件地图

| 单元 | 职责 | 数据 | 依赖 |
|---|---|---|---|
| client `CMP-observer`（新） | HTTP/SSE/session/attempt/file | 无 | 只读端口 |
| client `CMP-observability` | session 事件写入/日志/doctor | `sessions/*/events.jsonl` | 无 |
| client `CMP-store` | journal、run 注册表 | `journal.jsonl`、`runs/` | 无 |
| client `CMP-workspace` | 只读文件/路径 | 工作区文件 | 无 |
| client `CMP-runtime` | session meta/raw | `sessions/*/meta.json`、raw | 无 |
| client `CMP-executor` | 任务执行、session 关联、run 注册 | 运行时 | `JournalPort` |
| client `CMP-gateway` | poll URL 头 | 无 | 配置 |
| orchestrator `CMP-observability-client`（新） | client 观测 HTTP 客户端 | 无 | 端口、fetch |
| orchestrator `CMP-run` | 产品方法、`runIdForTask`/`sessionForNode` | 无新增 | 端口 |
| orchestrator `CMP-http-gateway` | 文件/会话产品 API、poll 头/runId | 无 | run、backend |
| orchestrator `CMP-scheduler` | 不变 | task/task_attempt | 无 |
| orchestrator `CMP-config`/`CMP-harness`/`CMP-platform` | 静态地址/token/内存目录 | 配置/DB/内存 | 无 |

## 11 client 侧实现

- 配置/启动：`serve` 启动 observer；`run` 不启动；`enabled=false` 不监听；`required=false` 失败降级；关闭时停止 HTTP/SSE/定时器。
- HTTP：`O-01`–`O-10`；GET/JSON/`no-store`/`nosniff`；`auth=off` 本地透传，`auth=on` Bearer；SSE 快照/续传/慢消费者/并发；错误按 §7.6/§8.4。
- session：`CMP-runtime` 写 `sessions/<id>/meta.json` + raw；`CMP-observability` 写 `events.jsonl`；`CMP-observer` 的 `SessionQuery` 组合；事件只收 session/ACP，不收 attempt 阶段。
- attempt：`CMP-observer` 的 `AttemptQuery` 读 `CMP-store` journal；薄列表/详情；无 attempt 日志/SSE。
- run 注册：`JournalPort.recordRun/listRuns`；`CMP-executor` 任务接收时 upsert；`CMP-cli` 归档请求 upsert；`TaskRecord` 增可选 runId/路径；启动重建。
- 文件：`CMP-workspace.listDir/readText`；一层、符号链接保护、异步 FS；v1 不设上限。
- 兼容：`TaskRequest.runId` 可选；旧 orchestrator 不发；旧 client 忽略。
- doctor：bind/port、advertise、auth/loopback、run 注册表、文件/session 自检。
- 测试：O-01–O-10；薄 attempt 无日志/SSE；session 关联；run 注册；文件路径/二进制；权限/发现；降级；无阻塞。

## 12 orchestrator 侧实现

### 12.1 端口与适配器

```ts
type ClientRunFiles = {
  listFiles(input: { clientId: string; runId: string; root: RunFileRoot; path: string }): Promise<ClientListing>;
  readFile(input: { clientId: string; runId: string; root: RunFileRoot; path: string }): Promise<ClientContent>;
};

type ClientSessionObservability = {
  getSession(input: { clientId: string; sessionId: string }): Promise<ClientSession>;
  listEvents(input: { clientId: string; sessionId: string; cursor?: string; limit?: number }): Promise<ClientEventPage>;
  openEvents(input: { clientId: string; sessionId: string; lastEventId?: string }): Promise<ReadableStream<Uint8Array>>;
  openRaw(input: { clientId: string; sessionId: string }): Promise<ReadableStream<Uint8Array>>;
};
```

- `CMP-observability-client` 实现两端口；fetch/Bearer/URL/SSRF/超时/流式；不重试、不缓存。
- URL 来源：静态配置 > 自报；校验见 §9.2。
- 错误映射：连接失败/超时 → 504；401 → 502；404/410/409/415/429 透传；响应非法 → 502。

### 12.2 `CMP-run`

- 文件：`loadRun` → 校验 root/path → `ClientRunFiles` → 映射产品 DTO（path/hidden/previewable/contentType/language）；不落库。
- `runIdForTask(taskId)`：`select run_id from run_node where task_id = $1`；poll 富化。
- `sessionForNode(runId, nodeId, visit?)`：读 `run_node.session_id`；session 代理内部使用；不放进 `RunNodeView`。
- 无 broker/wake/TTL。

### 12.3 网关与产品 API

- 文件：`API-48`/`API-49`（`/runs/{id}/files`、`/files/content`）。
- session 代理：`API-50`–`API-53`：
  - `GET /api/v1/runs/{id}/nodes/{nodeId}/session`
  - `GET /api/v1/runs/{id}/nodes/{nodeId}/session/events`
  - `GET /api/v1/runs/{id}/nodes/{nodeId}/session/events/stream`
  - `GET /api/v1/runs/{id}/nodes/{nodeId}/session/raw`
- 代理用 `run.sessionForNode` 解析 `session_id`；**不返回 sessionId**；详情/事件的 sessionId 剥离，`downloadUrl` 换成 run/node 路由，raw 走代理流。
- `run_node.session_id` 为空 → 404 `session_not_linked`；run/node 不存在 → 404。
- poll：读 `X-Observability-Url` 注册；`executor-backend.poll` 给 task 补 `runId`；`ExecutorTask` DTO 增 `runId?`；无 `fileRequests`/`file-responses`。
- 产品端点计数 54 → 60（+2 文件 +4 session）；OpenAPI 6 个 path；执行面 5 个不变。

### 12.4 测试

- 适配器：200/401/404/410/409/415/429/超时/超大/重定向/非法 URL/SSRF。
- run：文件映射、`runIdForTask`、`sessionForNode`；无 DB 写入。
- 网关：文件/session 产品 API、SSE/raw 流、poll URL 头、runId 富化、旧 client 503。
- 架构：新组件端口/依赖；run 无 HTTP；scheduler 不变；无迁移。

## 13 契约 diff

### 13.1 执行面 `executor-http-v3`

- `TaskRequest` 增可选 `runId: string`；manual task 可缺。
- poll 请求头增可选 `X-Observability-Url`（≤2048，绝对 http(s)）；服务端只登记。
- 客户端承诺：
  - `C-16`：观测面启用时上报 URL；观测面不可用不影响任务。
  - `C-17`：收到 `runId` 时持久化 run→路径，并在 session meta 关联 run/node/task/attempt。
- 不新增执行面端点；`X-Executor-Protocol` 仍 `3`。

### 13.2 观测面 `client-observability-v1`

- P1 attempt 日志/SSE 删除；O-02/O-03 改为薄 attempt；O-04 session 列表；O-05–O-08 session；O-09/O-10 文件。
- `O-01` 去掉 attempt 计数。
- 默认 bind/auth/发现/降级修订（§9）。
- `observabilityVersion` 升 `2026-11-17.1`。
- 权威在 client 仓库 `docs/design/contracts/client-observability-v1.md`；orchestrator 保留副本。

### 13.3 产品面

- 54 → 60：`API-48`/`API-49` 文件，`API-50`–`API-53` session 代理。
- `RunFileEntry`/`RunFileContent` 不变；session DTO 不包含 sessionId；attempt 不新增产品 DTO（run 详情已有）。

## 14 安全与风险

| 风险 | 影响 | 处理 |
|---|---|---|
| 默认无 token + 入站 | 本机任何进程可读 | 默认 `127.0.0.1`；`auth=on` 开关；非 loopback 强制显式允许；run/session-scoped |
| raw/session 敏感 | prompt/推理/工具 I/O 泄露 | `raw_enabled` 可关；loopback；审计；不写日志 |
| 文件敏感 | `.env`/凭据 | run-scoped + 只读；生产前鉴权/TLS（`OQ-36`） |
| SSRF（自报 URL） | 调度器访问内网 | 静态配置优先；自报仅 loopback/受控；校验/禁重定向/超时/allowlist |
| NAT/不可达 | 观测失败 | 任务不受影响；同机/同网段/隧道；已知退化 |
| 无业务上限 | 大目录/大文件 OOM/慢 | v1 观察；保留超时/并发；后续加阈值或流式（§8.3） |
| UI BFF 10s | 大请求先 504 | 观察；必要时调 `BFF_TIMEOUT_MS` 或流式 |
| UI BFF 全量缓冲 | SSE/raw 不能流式 | 需要 BFF 改为流式；否则 session 代理先用分页事件/short raw |
| 观测面启动失败 | 若退出会停任务 | 默认 `required=false` 降级；`required=true` 才退出 |
| attempt 视图漂移 | 与调度面不一致 | 只读 journal；不提供日志/状态机；attempt 权威在调度面 |
| token 复用 | 一个秘密两个方向 | v1 接受；后续独立 token/轮换 |

## 15 `serve` 降级后还能做什么

`required=false`（默认）且观测面 bind/初始化失败时：

| 能力 | 是否可用 |
|---|---|
| 持续 poll、领取任务 | 可用 |
| 执行节点、DSH session、技能安装 | 可用 |
| 结果落盘/上报、会话日志上传 | 可用 |
| 运行归档上传 `P-05` | 可用 |
| 取消/停止控制信号 | 可用 |
| `doctor`/本地日志 | 可用（会报 `observability_disabled`） |
| session/attempt/file 观测 API | **不可用** |
| orchestrator 文件/session 产品 API | 503/504；UI 显示不可用 |
| 自动重启 observer | 不做；修端口/重启 `serve` 后恢复 |

`required=true`：观测面启动失败退出 4，不进入执行循环。

## 16 兼容、发布与回滚

- 发布：client（O-01–O-10 + run 注册 + URL 头）→ orchestrator（适配器 + 6 个产品 API）→ UI。
- 旧 orchestrator + 新 client：`runId`/头无人消费；任务正常。
- 新 orchestrator + 旧 client：无 URL/端点；文件/session API 503；任务正常。
- 协议：执行面仍 `3`；观测面独立版本；无 v4。
- 回滚：client 关 `observability.http.enabled`；orchestrator 下线 API；任务不受影响；无迁移。
- 多 client：目录按 clientId；静态配置逐 client。

## 17 验证计划

| 层 | 用例 |
|---|---|
| client health/attempt | `O-01` 计数；`O-02`/`O-03` 薄列表/详情；无 attempt 日志/SSE（404） |
| client session | `O-04`–`O-08` 列表/详情/事件/SSE/raw；404/410/409/429；关联字段 |
| client 文件 | `O-09`/`O-10` 正常/二进制/目录/缺失/逃逸/符号链接/权限；v1 不设上限 |
| client 注册/权限/发现 | run upsert/重启重建/410；`auth=off` 本地、`auth=on` Bearer、非 loopback 拒绝；URL 头/静态配置 |
| client 降级 | bind 失败 `serve` 继续 poll/执行/归档；观测 API 不可用 |
| orchestrator 适配器 | 200/401/404/410/409/415/429/超时/超大/重定向/SSRF |
| orchestrator 产品 | 文件 2 + session 4；SSE/raw 流；无 sessionId 泄露；runId 富化；无迁移；scheduler 不变 |
| 集成 | 真实 client + run 到 `waiting_confirm`；文件列表/读 md/code；session 详情/事件/raw；client 离线 504；`SCN-0305` 3+1、`SCN-0303` 新增断言 |
| 命令 | client `bun test`/`bun run typecheck`；orchestrator `bun run check`；UI `npm test`/`node tools/verify-m1-scenarios.js SCN-0004` |

## 18 待确认

1. 薄 attempt 的字段是否就是 `taskId/attemptNo/instanceId/nodeId/sessionId/state/resultStatus/时间/errorCode`（无日志/SSE）？
2. session 代理 4 个产品 API 的响应是否必须完全不出现 `sessionId`（推荐），还是允许出现？
3. `CMP-observer` / `CMP-observability-client` 的命名与拆分是否接受？
4. `auth=off` 默认 + `127.0.0.1` + `allow_unauthenticated` 非 loopback 显式允许，是否与当前开发期一致？
5. `serve` 降级表是否覆盖你需要保留的能力？
6. v1 不设业务上限确认；是否保留 `client_observability_timeout_ms=60000` 这个技术超时？
7. 是否接受「UI BFF 默认 10s 会成为事实上的大文件限制，观察后再调」？

## 19 与现有文档的关系

| 文档 | 关系 |
|---|---|
| `2026-11-17-run-file-browser` | 产品文件 API/DTO/UI 沿用；poll 传输为备选；client 文件端点 `O-09`/`O-10` |
| `REQ-0002` | 约束改为 client 只读观测面直连；文件验收不变 |
| `executor-http-v3` | 加 `runId`/URL 头；无新端点；不升版本 |
| client 观测 P1 | 本提案是其 session 为主的修正；attempt 只保留薄视图 |
| client `CMP-observability`/`CMP-workspace`/`CMP-store`/`CMP-runtime`/`CMP-cli` | 组件规格修订；新增 `CMP-observer` |
| orchestrator `architecture.md` | 新增 `CMP-observability-client` 适配器；run 用端口；scheduler 不变 |
| `openapi.yaml` | 6 个产品 path；`x-api-count` 60 |
| `OQ-34`/`OQ-35`/`OQ-36` | 归档/快照/鉴权仍待定；本提案不关闭 |
