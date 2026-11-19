---
layer: works
module: run
status: active
updated: 2026-11-19
procedure: 2026-11-17-run-file-browser
level: P1
---

# 设计提案：运行文件浏览（人工确认节点）

> 状态：**P1 设计提案，未冻结**。2026-11-17 用户已裁决：以 `confirm` 为主、API 按 run 级；v1 只做运行中实时只读。文件通道先后考虑 poll 反向请求与 client 观测面直连，**最终方向为观测面直连**（见文首修订注）；poll 方案保留为备选。
> 本文只写方案、契约与落点；不改代码、不改组件规格、不建迁移。设计冻结后才进入实现。
>
> **2026-11-17 方向修订**：传输层改为 **client 只读观测面直连**；本文件 §5/§7 的 poll 反向请求保留为 NAT/离线备选，不再作为 v1 实施依据。产品 API/DTO/UI 与错误口径仍有效；**client v1 已确认 2000 条 / 1 MiB**，`maxFileListEntries`/`maxFileReadBytes` 作为现状口径。实施以 [`../2026-11-17-client-observability/proposal.md`](../2026-11-17-client-observability/proposal.md) 为准。

## 0 结论

> 下表 `D-01`/`D-04`–`D-07`/`D-09` 的传输细节属于 poll 备选；v1 观测面直连见新提案。

| # | 决策 | 内容 |
|---|---|---|
| `D-01` | 通道（备选） | poll 反向请求：poll 响应带 `fileRequests`，client 读本地文件后回传；**已被 2026-11-17 方向修订取代，保留为 NAT/离线备选** |
| `D-02` | 范围 | run 级只读 API；`confirm` 为主场景，`review` 后续可复用同一接口 |
| `D-03` | 生命周期 | v1 只覆盖运行中、client 在线；不做 confirm 快照、不做结束后归档浏览、不做下载 |
| `D-04` | 契约 | 执行面加法变更：poll 可选字段 + 新回传端点；`X-Executor-Protocol` 仍为 `3`；不落库、不改表 |
| `D-05` | 落点 | 请求代理放 `CMP-run` 的只读模块；`CMP-scheduler` 增加 `wake(clientId)`；不新增组件、不新增依赖边 |
| `D-06` | 限制 | 目录 ≤2000 条、文本 ≤1 MiB（超出截断）、等待 8s、请求有效期 60s、每 client 待处理 ≤8 |
| `D-07` | 客户端 | 文件读取在后台任务执行，最多 2 个并发，不阻塞 poll 与任务执行 |
| `D-08` | 展示 | 服务端只返回原始文本、`contentType` 与 `language`；Markdown 渲染与代码高亮由 UI 负责（Markdown 渲染已有；Prism 在 Milkdown bundle 中，需确认复用或补轻量封装） |

一句话：**UI 要文件时，服务端把请求放进该 client 的下一次 poll；client 读本地文件后回传；服务端把结果同步返回给 UI。** 全程只读、run 级、有界、不落库。

## 1 现状与缺口

### 1.1 已有事实

- `workflow_run` 已有 `workspace_path`、`task_space_path`、`client_id`（[`run/spec.md`](../../design/components/run/spec.md) §2）。`confirm` 节点不产生任务，run 进入 `waiting_confirm`（§4.3）。
- `CMP-run` 目前只保存运行终态后的归档：`P-05` 把 task-space 打成 tar.gz 上传到 `history/<instanceId>/<runId>/`（§4.7）。运行中没有任何文件读取面。
- UI 节点详情当前明确写「输入与输出、工作区文件留痕：当前执行面未提供对应端点」（`agent-flow-ui/docs/design/components/instances/spec.md`、`assets/js/pages/instance-detail.js`）。
- 执行面契约只有 `poll` / `result` / `skill-packages` / `session-log` / `run archive` 五个端点（[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md) §2）。

### 1.2 硬约束

- `REQ-0001` §4：**服务端不访问 client 工作区**；归档只写服务端 `archive.root`。
- client 只出站 poll；没有入站控制面；观测 HTTP 仍是未实现的 P1 稿，且不承接控制。
- `CMP-run` 的禁止依赖包含「发起对 client 的网络请求」（[`run/spec.md`](../../design/components/run/spec.md) §5）。
- 文件可能含 `.env`、凭据、业务数据；当前服务仅监听本机、无鉴权（`R-005`）。
- `confirm` 等待期间 run 未终态，`P-05` 归档不会发生；所以不能等归档。

### 1.3 可复用的原语

| 原语 | 现状 | 对本方案的用途 |
|---|---|---|
| poll 长轮询与唤醒 | `scheduler/poll.ts` 在无任务时挂起 `pollHoldMs`；`scheduler/waiters.ts` 提供 `notify` | 文件请求入队后唤醒挂起的 poll，避免等满 30s |
| 电平信号 | `archiveRequests` 在 poll 响应里持续下发，直到 client 确认 | `fileRequests` 沿用同一模式，丢失一次下一跳还会带 |
| 后台任务 | client `serve-loops.ts` 的 `archiveRun` 在后台打包上传，不阻塞 poll | 文件读取/回传也放后台，不阻塞 poll |
| 路径约束 | client `FileWorkspace` 已有 `readdir`/`stat`/`realpath`/`assertInsideWorkspace` | 扩成只读的目录列举与文本读取 |
| 展示 | UI 已有 `shared/markdown.js`；Prism 在 Milkdown bundle 中 | 服务端只给原文与语言；Markdown 直接用现有渲染，代码高亮需 UI 确认 Prism 复用方式 |

## 2 通道取舍

| 方案 | 做法 | 结论 |
|---|---|---|
| **A. poll 反向请求（选定）** | poll 响应新增 `fileRequests[]`；client 读本地文件后 `POST /api/v1/executor/file-responses/{requestId}`；服务端产品 API 等待结果 | 与现有出站模型、电平语义、后台任务一致；只加执行面字段与端点；需要 client 升级 |
| B. 直连 client 观测 HTTP | orchestrator 调 client 的只读 HTTP | **否决**：需要 client 入站、base URL 发现、鉴权与网络可达；观测面尚未实现；与「client 不提供入站控制面」的边界冲突 |
| C. 只做归档浏览 | 复用 `P-05` 的 task-space tar.gz | **否决为 v1**：`confirm` 时 run 未终态，看不到；只有 task-space；还要在服务端解包/索引 |
| D. 服务端直读工作区 | 直接按 `workspace_path` 读文件 | **否决**：工作区在 client 机器上；远端部署不可用；违反 `REQ-0001` §4 |
| E. 解析 session-log | 从 `P-04` 日志还原文件内容 | **否决**：日志是 ACP 事件流，不保证含最终文件全文；格式耦合，不能作为浏览面 |
| F. 中途复用归档 | 让 `P-05` 接受非终态 run，把 task-space 打个包 | **否决为 v1**：改归档语义、需要服务端解包、只覆盖 task-space，且每次浏览都要重打包 |

**为什么不是 protocol v4**：这是可选能力，加法变更即可。旧 client 会忽略 poll 响应里的未知字段（client `parsePollResponse` 只读已知字段）；旧调度器也不会给新 client 发 `fileRequests`。升 v4 会把「部署顺序 + 回滚」耦合进协议，收益不成立。若将来需要强制能力协商，再加 `X-Executor-Capabilities` 头或 v4。

### 2.1 如果 client 已实现可观测 API

**结论：只有四个前提同时成立时，直连才会更精简；当前不成立，所以 v1 仍走 poll 反向请求。**

直连能省掉的是传输层：`fileRequests` 电平、`file-responses` 回传端点、`FileBroker` 的待处理/超时/唤醒、client `serve` 的文件回传任务。产品 API、DTO、UI 文件树与渲染都不变。

但会新增或前置：

1. **client 观测 HTTP 已实现并常驻**。当前只是 client 仓库的 P1 稿（`docs/works/2026-11-06-observability-http/proposal.md`），未实现。
2. **调度器能发现每个 client 的 base URL**。P1 稿的选择是「调度器侧配置 base URL，不自动注册」；`X-Client-Address` 是 client 自报的接入地址，不等于观测 base URL。要么加配置，要么在 poll/注册里新增 `observabilityUrl` 字段。
3. **调度器 → client 的鉴权**。P1 稿的观测 token 可空（空即不鉴权）；文件浏览会把工作区文件放到入站面上，暴露风险高于只回传日志。需要独立 token、轮换与失败关闭。
4. **client 能把 `runId` 映射到 `workspacePath`/`taskSpacePath`**。当前 `TaskRequest` 没有 `runId`，client journal 也不存路径；观测 P1 明确「不提供文件系统路径参数」。要么给 `TaskRequest` 加 `runId` 并持久化映射，要么让观测接口接受路径参数（会破坏它自己的安全原则）。
5. **服务端要有能发 HTTP 的落点**。`CMP-run` 明确禁止向 client 发网络请求；`http-gateway` 只做入站协议翻译。直连需要新组件/适配器（P1 结构决策），或改 `CMP-run` 的边界。
6. **网络可达**。client 可能在 NAT/防火墙后；出站 poll 不受影响，入站观测需要端口映射/中转/TLS。

| 维度 | poll 反向请求（v1） | 观测 API 直连 |
|---|---|---|
| 传输方向 | client 出站，复用现有 poll | orchestrator → client 入站 |
| 服务端新增 | poll 字段 + 回传端点 + run 请求代理 | 出站适配器/组件 + base URL 发现 + 调度器→client token |
| client 新增 | poll 处理 + 文件读取 + 回传 | 观测 HTTP 服务（未实现）+ 文件端点 + runId 映射 + 鉴权 |
| run 身份/路径 | 请求里直接带 run 的路径，client 不需要 run 映射 | 需要 runId→路径映射；当前任务信封无 `runId`，journal 不存路径 |
| 网络 | NAT/防火墙友好 | 需要 client 可被调度器访问 |
| 安全 | 文件经已认证出站通道回传；client 不新增入站文件面 | 新增入站文件面；token 为空即无鉴权 |
| 延迟 | 一次 poll 唤醒 + 往返，8s 超时 | 直连更低，但连接失败/超时语义另做 |
| 协议变更 | 执行面加法字段 + 端点；不升版本 | 观测 API 新端点 + 发现/鉴权；可能还需 `TaskRequest.runId` |

**判断**：如果观测面已经按「自动上报地址 + 调度器→client token + runId 映射」落地，直连的文件浏览确实更短；但那是另一个 P1 工程。**2026-11-17 用户决定走观测面直连**；本文的 poll 反向请求保留为 NAT/离线备选，产品 API 与传输解耦，UI/DTO 不变。

## 3 总体设计

```text
UI                         http-gateway                     CMP-run
│ GET /runs/{id}/files        │                               │
├────────────────────────────▶│ listFiles/readFile            │
│                             ├──────────────────────────────▶│ FileBroker.request()
│                             │                               │   ├─ 校验 run/root/path/上限
│                             │                               │   ├─ 建 requestId + expiresAt
│                             │                               │   └─ scheduler.wake(clientId)
│                             │                               │
│                             │           poll response       │
│                             │◀──────────────────────────────┤ pendingFileRequests(clientId)
│                             │                               │
│                        client ◀── fileRequests[] ───────────┤
│                             │  读 workspace/task-space       │
│                             │  POST /executor/file-responses │
│                             ├──────────────────────────────▶│ acceptFileResponse()
│                             │                               │   └─ resolve promise
│◀── 200 listing/content ─────┤◀──────────────────────────────┘
```

- 文件请求是**冷路径**：不在任务派发/结果结算的事务里，不写库，不持有数据库事务。
- 服务端只做「请求排队 + 等待 + 校验 + 映射」；文件内容的权威在 client。
- 请求状态只在进程内存；服务重启丢失，UI 重试；不做补偿。

## 4 产品 API（对 UI）

### 4.1 端点

| ID | 方法 / 路径 | 用途 |
|---|---|---|
| `API-48` | `GET /api/v1/runs/{id}/files` | 列目录（含子目录项）；`root` 默认 `task-space`，`path` 默认根 |
| `API-49` | `GET /api/v1/runs/{id}/files/content` | 读文本文件内容与元数据 |

查询参数：

| 参数 | 端点 | 必填 | 规则 |
|---|---|---|---|
| `root` | 两者 | 否 | `task-space`（默认）/ `workspace` |
| `path` | 两者 | 否（列表）/ 是（内容） | 相对 POSIX 路径；`""` 表示根；拒绝 `..`、`.`/空段、绝对路径、反斜杠、NUL；≤1024 字符、≤64 段 |

不提供：写、删除、重命名、上传、下载、搜索、递归全树、按节点/轮次的历史快照。

### 4.2 响应 DTO

```ts
type RunFileRoot = "task-space" | "workspace";

type RunFileEntry = {
  name: string;
  path: string;                 // 相对请求根的路径
  type: "file" | "dir" | "symlink" | "other";
  sizeBytes: number | null;     // 目录为 null
  modifiedAt: string | null;    // ISO-8601
  hidden: boolean;              // 名称以 "." 开头
  previewable: boolean;         // 非目录且非已知二进制；真正可读性由 content 判断
  contentType: string | null;   // 文本类才有
  language: string | null;      // 代码高亮提示；未知为 null
};

type RunFileListing = {
  runId: string;
  root: RunFileRoot;
  path: string;
  entries: RunFileEntry[];
  truncated: boolean;           // 条目超过上限
  fetchedAt: string;
};

type RunFileContent = {
  runId: string;
  root: RunFileRoot;
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string | null;
  contentType: string;          // 文本为 text/markdown|text/plain；二进制为 application/octet-stream
  language: string | null;
  content: string | null;       // 二进制或不可预览时为 null
  truncated: boolean;           // 超过 1 MiB，返回前 1 MiB
  reason: "binary" | "too_large" | null;
  fetchedAt: string;
};
```

- `language` 由服务端按扩展名映射（md→markdown、ts→typescript、js→javascript、py→python、go→go、rs→rust、sql→sql、sh→bash、json→json、yaml→yaml、toml→toml、xml/html/css、java/kotlin/swift/c/cpp/csharp/ruby/php 等）；未知为 `null`，UI 可用 `plaintext`。
- `contentType` 只用于展示提示；Markdown 用 `text/markdown; charset=utf-8`，其余文本用 `text/plain; charset=utf-8`。
- `truncated=true` 时 `reason=too_large`，`content` 仍是前 1 MiB；二进制时 `content=null`、`encoding=null`、`reason=binary`；完整文本时 `reason=null`。
- `previewable` 对已知二进制扩展名（png/jpg/gif/pdf/zip/gz/exe/woff 等）为 `false`；其余文件为 `true`，真正是否可读由 content 接口返回 `reason`。
- 目录列表只返回**一层**；UI 展开子目录时再请求 `path`。不返回递归树，避免工作区过大。
- client 只回传每个条目的 `name`、类型、大小与修改时间；产品面的 `path` 由服务端按「请求 path + name」拼接，**不信任 client 提供的路径**。

### 4.3 示例

`GET /api/v1/runs/01a1.../files?root=task-space&path=`

```json
{
  "runId": "01a1...",
  "root": "task-space",
  "path": "",
  "entries": [
    { "name": "reports", "path": "reports", "type": "dir", "sizeBytes": null, "modifiedAt": "2026-11-17T08:10:00Z", "hidden": false, "previewable": false, "contentType": null, "language": null },
    { "name": "intent.md", "path": "intent.md", "type": "file", "sizeBytes": 2048, "modifiedAt": "2026-11-17T08:00:00Z", "hidden": false, "previewable": true, "contentType": "text/markdown; charset=utf-8", "language": "markdown" }
  ],
  "truncated": false,
  "fetchedAt": "2026-11-17T08:12:00Z"
}
```

`GET /api/v1/runs/01a1.../files/content?root=task-space&path=reports/design.md`

```json
{
  "runId": "01a1...",
  "root": "task-space",
  "path": "reports/design.md",
  "name": "design.md",
  "sizeBytes": 2048,
  "modifiedAt": "2026-11-17T08:10:00Z",
  "contentType": "text/markdown; charset=utf-8",
  "language": "markdown",
  "content": "# 方案\n...",
  "truncated": false,
  "reason": null,
  "fetchedAt": "2026-11-17T08:12:01Z"
}
```

## 5 执行面契约（对 client）

### 5.1 poll 响应新增字段

```json
{
  "tasks": [],
  "stop": false,
  "cancelInstances": [],
  "archiveRequests": [],
  "fileRequests": [
    {
      "requestId": "01a1f0...",
      "kind": "list",
      "runId": "01a1...",
      "instanceId": "0193...",
      "workspacePath": "/abs/instance-a",
      "taskSpacePath": "/abs/instance-a/task-spaces/20261117-081000",
      "root": "task-space",
      "path": "reports",
      "maxBytes": 1048576,
      "expiresAt": "2026-11-17T08:13:00Z"
    }
  ],
  "nextPollAfterMs": 0
}
```

- `fileRequests` 可选；服务端总是下发 `[]` 或数组。旧 client 忽略未知字段。
- 只发给该 run 所属的 `clientId`（`instance.client_id`）。
- 电平：同一 `requestId` 持续下发，直到收到回传或 `expiresAt` 过期；client 按 `requestId` 去重。
- `kind`：`list` / `read`。`maxBytes` 只对 `read` 有意义；`list` 忽略。
- `path` 为相对 POSIX；`root` 决定 base 是 `taskSpacePath` 还是 `workspacePath`。
- `expiresAt` 用于客户端丢弃过期请求；服务端仍以收到回传时的请求状态为准。

### 5.2 回传端点

```http
POST /api/v1/executor/file-responses/{requestId}
Authorization: Bearer <token>
X-Executor-Protocol: 3
Content-Type: application/json; charset=utf-8
```

请求体：

```ts
type ExecutorFileResponse = {
  requestId: string;
  status: "ok" | "error";
  listing?: {
    entries: Array<{
      name: string;
      type: "file" | "dir" | "symlink" | "other";
      sizeBytes: number | null;
      modifiedAt: string | null;
    }>;
    truncated: boolean;
  };
  file?: {
    content: string | null;
    encoding: "utf-8" | null;
    binary: boolean;
    truncated: boolean;
    sizeBytes: number;
    modifiedAt: string | null;
  };
  error?: { code: string; message: string };
};
```

响应：

```json
{ "requestId": "01a1f0...", "accepted": true }
```

- `accepted=false`：请求已过期、已取消或已由更早的回传结算；client 丢弃。
- `404 request_not_found`：请求不存在、已过期或不属于该 `clientId`；client 丢弃，不重试。
- `400 validation_error`：字段未知/类型非法/与 `kind` 不匹配。
- `413 payload_too_large`：回传体超过上限；client 应改为返回 `error` 或截断。
- 同一 `requestId` 重复回传：首份为准，后续 `200 accepted=false`；不要求 client 持久化首份字节。
- 服务端校验每个 `entries[].name` 是单段（不含 `/`、`\`，不是 `.`/`..`）；不合法按 `file_response_invalid` 处理，不进入产品响应。

### 5.3 请求生命周期

1. UI 调产品 API；`CMP-run` 校验 run/root/path/上限，分配 `requestId`（UUIDv7），写内存表，设置 `expiresAt = now + 60s`。
2. `CMP-run` 调 `scheduler.wake(clientId)`，结束该 client 当前的 poll 挂起（没有挂起则 no-op）。
3. 下一次 poll 响应合并 `fileRequests`；client 后台读文件并回传。
4. `CMP-run.acceptFileResponse` 校验 `requestId`、`clientId`、payload 形状与大小，resolve 等待中的 Promise。
5. 产品 API 返回 200；若等待超过 8s，返回 504 `file_request_timeout`，并从内存表移除；之后到达的回传按 `accepted=false` 处理。
6. 服务重启：内存表丢失；未完成的 UI 请求由 UI 重试；迟到回传 404。

### 5.4 限制常量

| 常量 | 值 | 约束对象 |
|---|---:|---|
| `maxFileListEntries` | 2000 | 单次目录列表条目数 |
| `maxFileReadBytes` | 1048576（1 MiB） | 单文件返回文本的截断上限 |
| `maxFilePathLength` | 1024 | 相对路径字符数 |
| `maxFilePathSegments` | 64 | 相对路径段数 |
| `fileRequestWaitMs` | 8000 | 产品 API 等待 client 的上限 |
| `fileRequestTtlMs` | 60000 | 请求在内存中的有效期 |
| `maxPendingFileRequestsPerClient` | 8 | 每 client 同时待处理请求数 |
| `maxFileResponseBytes` | 2097152（2 MiB） | 回传体上限 |
| `maxConcurrentFileJobsPerClient` | 2 | client 后台文件任务并发 |

常量是代码常量，不走配置；与执行面现有上限同一风格（[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md) §3）。

编排侧等待取 8s，而不是 UI BFF 的默认 10s：BFF 在 10s 会先返回 `504 upstream_timeout`，留 2s 余量才能把编排侧结构化的 `file_request_timeout` 带回 UI。若 UI 调整 `BFF_TIMEOUT_MS`，两边需同步。

### 5.5 错误与 HTTP 映射

产品面：

| 情形 | HTTP | `code` |
|---|---:|---|
| 成功（含二进制/截断） | 200 | — |
| `root`/`path` 非法 | 400 | `validation_error` |
| run 不存在 | 404 | `run_not_found` |
| 文件/目录不存在 | 404 | `file_not_found` |
| 权限不足 | 403 | `file_permission_denied` |
| run 没有绑定 client | 409 | `file_access_unavailable` |
| 待处理请求超限 | 429 | `too_many_requests` |
| 目录当文件读/不支持的类型 | 415 | `unsupported_file` |
| client 本地 IO 错误 | 502 | `file_response_invalid` |
| client 回传非法 | 502 | `file_response_invalid` |
| client 超时/离线 | 504 | `file_request_timeout` |
| 服务不可用 | 503 | `service_unavailable` |

执行面：

| 情形 | HTTP | `code` |
|---|---:|---|
| 回传成功/重复 | 200 | — |
| 请求未知/过期/不属于该 client | 404 | `request_not_found` |
| 请求体非法 | 400 | `validation_error` |
| 回传体超限 | 413 | `payload_too_large` |
| 未认证 | 401 | `unauthorized` |

client 回传里的 `error.code` 闭集：`not_found` / `path_escape` / `permission_denied` / `unsupported` / `io_error`。服务端只做映射，不改写 message。

## 6 交互与失败路径

### 6.1 正常

1. `confirm` 节点 `waiting_confirm`，client 空闲长轮询。
2. 用户打开节点弹层「文件」Tab，UI 请求 run 级列表。
3. 服务端入队请求并唤醒 poll；client 收到 `fileRequests`，后台列目录，回传。
4. 服务端返回 entries；UI 懒加载子目录；点文件时再走一次 content。

### 6.2 client 离线/未升级

- 请求 8s 超时 → `504 file_request_timeout`；UI 显示「执行节点未响应（可能离线或版本不支持文件浏览）」。
- 旧 client 忽略 `fileRequests`，行为同上；不阻塞任务、不影响 run。
- 不做服务端重试；UI 可手动刷新/重试；请求过期后不再下发。

### 6.3 路径越界/符号链接

- 服务端先校验 `root` 与相对路径（拒绝 `..`、`.`/空段、绝对路径、反斜杠、NUL、超长）。
- client 再用 `realpath`/`lstat` 校验：目标必须在 base 内；越界符号链接不进；读取时拒绝符号链接，避免检查与使用之间的竞态。
- 返回 `path_escape` → 产品 400；不返回文件内容。

### 6.4 重复与并发

- 同一 UI 请求只生成一个 `requestId`；client 按 `requestId` 去重。
- 同一文件短时间重复点击：产生多个请求（v1 不做服务端缓存）；UI 可自行去抖。
- 每 client 待处理 ≤8；超限 429；client 后台并发 ≤2。
- UI 一次只展开一个目录、读一个文件，不并行预取；避免占满待处理名额，也避免多个 8s 等待同时占住 BFF 连接。

### 6.5 服务端/客户端重启

- 服务端重启：内存请求丢失；UI 重试；迟到回传 404。
- client 重启：未回传请求在下次 poll 继续下发；client 重新读文件；已回传但响应丢失的请求重复下发，回传首份为准。
- run 取消/进入终态：文件请求仍可完成（只读，不改变 run）；UI 仍可看当前文件。

### 6.6 旧协议/部署顺序

- 执行面 `X-Executor-Protocol` 仍为 `3`；新增字段/端点按加法处理。
- 建议顺序：编排服务 → client → UI。编排先上，旧 client 只是超时；client 后上，开始能响应；UI 最后上，避免 404。
- 回滚：去掉产品路由与 poll 合并即可；client 收到不到请求；无数据迁移。

## 7 组件落点与依赖

### 7.1 组件落点候选

| 候选 | 结论 |
|---|---|
| 扩展 `CMP-run`（选定） | run 已拥有 `workspace_path`/`task_space_path`/`client_id` 与 run 的读面；只需一个内存请求表，无新依赖边 |
| 新增 `CMP-file-access` 组件 | **否决**：没有独立业务能力，只多一层门面与端口；等二期加入缓存/快照/归档索引再评估拆分 |
| 放 `CMP-scheduler` | **否决**：scheduler 不理解 run，且 `scheduler → run` 是禁止边 |
| 放 `CMP-http-gateway` | **否决**：网关只做协议翻译与错误映射，不应持有请求状态、超时与 Promise |

### 7.2 落点与依赖

| 单元 | 改动 | 新依赖 | 数据 |
|---|---|---|---|
| `CMP-run` | 新增 `files.ts`：`FileBroker`（请求表、有效期、Promise）、`listFiles`/`readFile`、`pendingFileRequests`/`acceptFileResponse`；`RunService` 增 4 个方法；领域类型 `RunFileRoot`/`RunFileEntry`/`RunFileListing`/`RunFileContent`/`RunFileRequest`/`RunFileResponse` | 无（`scheduler` 已在依赖里） | 仅内存请求状态；无表、无 `FileStore` |
| `CMP-scheduler` | `SchedulerService.wake(clientId): void`；内部 `waiters.notify` | 无 | 无 |
| `CMP-http-gateway` | `routes/run.ts` 增 `files` / `files/content`；`routes/executor.ts` 增 `file-responses/{requestId}`；DTO `ExecutorFileRequest`/`ExecutorFileResponse` 与领域类型互映射；OpenAPI/错误映射 | 无（`run` 已依赖） | 无 |
| `executor-backend.ts` | `poll` 把 `run.pendingFileRequests(clientId)` 合并进响应；`acceptFileResponse` 把 wire DTO 映射为领域 `RunFileResponse` 后转发 `run` | 无 | 无 |
| client `CMP-workspace` | `WorkspacePort` 增只读 `listDir`/`readText`（或 `FileAccessPort`）；路径校验复用 `assertInsideWorkspace`/`resolve` | 无 | 只读文件系统 |
| client `CMP-cli`/`CMP-gateway` | poll 处理 `fileRequests`；后台任务；`uploadFileResponse`；去重/重试 | 无 | 无 |
| UI | `run/data` 加两个方法；节点弹层「文件」Tab；树/预览/Markdown/代码高亮（Prism 复用或轻量封装） | 无（Prism 已在 vendor，需确认导出方式） | 页面内存态 |

- **不新增组件**：文件浏览是 run 的只读投影 + 协议适配；拆独立组件会多一层门面与端口，没有独立业务能力，不符合简单直接（KISS）原则。若二期加入快照/归档索引/缓存，再评估拆分。
- **不新增依赖边**：`http-gateway → run`、`run → scheduler`、`run → platform` 都是既有边；`executor-backend` 是组合根适配器，不是组件。
- **数据所有权不变**：文件内容权威在 client；服务端只暂存请求状态与等待结果；不写 `run_artifact`、不写 `FileStore`、不改 `workflow_run`。
- **预算**：`CMP-run` 当前规格约 12 KB；新增规格约 4–5 KB，源码 + 测试预计 < 25 KB，远低于 120k token。

## 8 安全与边界

| 风险 | 处理 |
|---|---|
| 服务端读 client 工作区 | 不做；只接受 client 回传，符合 `REQ-0001` §4 |
| 任意路径读取 | 只能读该 run 的 `workspacePath`/`taskSpacePath`；`root` 枚举；路径相对且校验；不接受调用方传绝对路径 |
| 路径穿越/符号链接 | 服务端语法校验 + client `realpath`/`lstat` 双重校验；越界 `path_escape`；读取拒绝符号链接 |
| 跨 run 读取 | 请求按 `runId` 与 `instance.client_id` 绑定；回传校验 `clientId`；不能读别的 run |
| 敏感文件 | 工作区可能含 `.env`/凭据；v1 不隐藏、不脱敏；依赖本机监听 + 只读 + 大小上限；生产前必须补鉴权（`R-005`） |
| 日志泄漏 | 只记录 `runId`/`root`/`path`/字节数/结果码；**不记录文件内容**；路径按 debug 级别 |
| 响应注入 | 产品只返回 JSON；`X-Content-Type-Options: nosniff`；Markdown 由 UI 用既有 sanitizer 渲染；不服务端渲染 HTML |
| 回传伪造 | 回传端点走执行面鉴权；`requestId` 绑定 `clientId`；校验请求状态与 payload 上限 |
| 资源耗尽 | 条目/字节/并发/待处理上限；client 后台并发 ≤2；服务端等待 8s；不做无界重试 |

## 9 冷热路径与资源

- **热路径**：poll。新增的 `pendingFileRequests` 只遍历该 client 的少量待处理请求（≤8），不做数据库查询、不读文件；`wake` 只是一次本地通知。不得在 poll 里做文件 IO。
- **冷路径**：UI 文件浏览、client 文件读取/回传。独立 HTTP 请求/后台任务，可慢、可超时；失败不影响任务派发、结果结算、run 状态。
- **不共享资源**：不占用任务执行槽位，不持有数据库事务/锁；client 文件任务与 ACP session 分离。
- **等待语义**：产品 HTTP 请求最多等 8s；超时后释放；client 的迟到回传不影响任何状态。
- **无缓存 v1**：不做服务端文件缓存，避免陈旧与内存预算；UI 在弹层会话内自行保留。

## 10 验证计划

### 10.1 编排侧

| 层 | 用例 |
|---|---|
| `run` 单元 | 请求代理创建/待处理/结算/超时/重复/过期；每 client 隔离；待处理上限；`wake` 调用 |
| `run` 单元 | root/path 校验（`..`、绝对路径、反斜杠、超长、超段）；client `error` 映射；`binary`/`truncated` 映射 |
| `scheduler` | 挂起 poll 被 `wake` 唤醒；无挂起时 no-op；不影响任务派发 |
| `http-gateway` | `API-48`/`API-49` 成功、400/404/409/429/504；`P-06` 回传 200/400/404/413；poll 合并 `fileRequests` |
| `executor-backend` | 合并 `pendingFileRequests`；`acceptFileResponse` 转发；run 未装配时行为 |
| 架构 | 无新依赖边；`run` 不 import `http-gateway`；无 Bun 文件 API；无新表/迁移 |

### 10.2 client 侧（跨项目）

| 用例 | 断言 |
|---|---|
| 列表 | 只列一层、目录/文件/符号链接类型、大小/mtime、条目上限截断 |
| 读取 | UTF-8 文本、1 MiB 截断、二进制识别、缺失/权限错误 |
| 路径 | `..`、绝对路径、越界符号链接、读取符号链接均拒绝 |
| 回传 | 成功、重复、404 丢弃、超时后丢弃、回传体超限 |
| 隔离 | 文件任务不阻塞 poll；并发 ≤2；任务执行不受影响 |

### 10.3 UI 侧（跨项目）

| 用例 | 断言 |
|---|---|
| 文件 Tab | `confirm` 弹层可切到「文件」；默认 task-space；可切 workspace |
| 列表/预览 | 目录懒加载；`.md` 用现有渲染；代码按 `language` 高亮（需补 UI 高亮封装）；二进制/截断提示 |
| 错误 | client 超时、404、路径错误有明确文案；只读无编辑入口 |
| 回归 | 现有概要/会话日志/确认决策不回归；`SCN-0004` 6/6 不降 |

### 10.4 场景

- 新建 `SCN-0305`（draft）：R1 列 task-space、R2 读 Markdown、R3 读代码并返回 `language`、N1 路径越界/超时。
- `SCN-0303` 增补断言：`waiting_confirm` 时可按 run 列出 task-space 并读取文件；决策入口仍在。
- 命令：编排 `bun run check`；client `bun test` + `bun run typecheck`；UI `npm test` + `node tools/verify-m1-scenarios.js SCN-0004`。
- 无数据库迁移；验证 `/openapi.yaml` 端点与计数、Swagger 可试。

## 11 风险与待定

| 项 | 影响 | 处理 |
|---|---|---|
| 文件内容含敏感信息 + 无鉴权 | 本机/内网可读工作区文件 | 沿用 `R-005`；v1 只读/run 级/上限；生产前补鉴权；`OQ-36` |
| client 离线/未升级 | UI 超时 | 8s 超时 + 明确文案；不做服务端重试；能力协商后置 |
| 大目录/大文件 | 列表慢/内容截断 | 2000 条、1 MiB、懒加载、`truncated` |
| 运行中文件变化 | 读到的是请求时刻内容 | 返回 `fetchedAt`；不做一致性快照；UI 提示 |
| 服务端重启/多实例 | 内存请求丢失/不共享 | 当前单进程；UI 重试；多实例需粘性/共享，后置 |
| 符号链接的检查与使用竞态 | 校验后目标变化 | `lstat` + `realpath` + 读取拒绝符号链接；本机可信边界内接受 |
| 无结束后浏览 | 审计场景缺口 | 二期评估归档解包/索引；`OQ-34` |
| 无 confirm 快照 | client 下线后不可看 | 审核期 client 通常在线；`OQ-35` |
| 无下载/二进制 | 大文件/图片不可取 | 二期；v1 只给元数据 |

## 12 P1 确认清单

> 传输项（`fileRequests`、回传端点、请求代理、`wake`）由 [`2026-11-17-client-observability/proposal.md`](../2026-11-17-client-observability/proposal.md) §15 取代；本清单只保留产品 API、UI 与限制口径。

请确认以下默认值；确认后本文冻结，进入 `T-RFB-05` 之后的实现任务：

- [ ] 产品 API 路径与 DTO：`/runs/{id}/files`、`/runs/{id}/files/content`，`root=task-space|workspace`。
- [ ] 执行面（已由观测面方案取代）：poll `fileRequests` + `POST /executor/file-responses/{requestId}`；协议仍为 3。
- [ ] 限制：v1 关闭 2000 条 / 1 MiB 业务上限；保留超时/并发等技术保护（见新提案 §8.3）。
- [ ] 落点（已由观测面方案取代）：`CMP-run` 请求代理 + `CMP-scheduler.wake`，不新增组件、不新增依赖边。
- [ ] 状态：不落库、不写 `FileStore`、无迁移；重启后 UI 重试。
- [ ] 范围：v1 只读、运行中、client 在线；不做快照/归档浏览/下载/二进制预览。
- [ ] UI：只读「文件」Tab；Markdown 用现有渲染；代码按 `language` 高亮；无编辑入口。
- [ ] 场景：新建 `SCN-0305`；`SCN-0303` 增补文件浏览断言。

## 13 冻结后要改的现行文档（本次未改）

| 文档 | 改动 |
|---|---|
| [`run/spec.md`](../../design/components/run/spec.md) | §1 职责、§2 无新数据、§3 类型/方法、§4.9 文件浏览、§5 依赖、§6 测试、§7 预算 |
| [`scheduler/spec.md`](../../design/components/scheduler/spec.md) | §3 `wake(clientId)` 契约 |
| [`kernel/spec.md`](../../design/components/kernel/spec.md) | 新增 `FileRequestTimeoutError`、`TooManyRequestsError`（或复用现有错误类型）；错误码表补 `file_request_timeout` / `file_response_invalid` |
| [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) | §4.1.1 `API-48`/`API-49`、§4.3 `P-06`、§5.9 DTO、§7 测试、§10 计数 |
| [`executor-http-v3.md`](../../design/contracts/executor-http-v3.md) | §2 `P-06`、§3 常量、§4.6、§5 类型、§7 `C-16`、§8 矩阵、§11.6、§12 |
| `openapi.yaml` | 两个产品 path、schema、`x-api-count` 54 → 56、operation 计数 |
| [`architecture.md`](../../design/architecture.md) | `CMP-run` 职责补文件浏览；依赖矩阵无新边 |
| `REQ-0002` / `SCN-0305` / `SCN-0303` | 状态与测试落点 |
| client 仓库 | 契约副本、`CMP-workspace`、`CMP-gateway`/`CMP-cli`、测试 |
| UI 仓库 | `run/data`、`instance-detail`、测试 |
