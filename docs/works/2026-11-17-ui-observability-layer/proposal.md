---
layer: works
module: global
status: active
updated: 2026-11-17
procedure: 2026-11-17-ui-observability-layer
level: P1
---

# UI 观测层接入方案（文件 / 会话 Tab + BFF 流式）

## 1 目标与边界

**目标**：在运行详情的人工确认节点上，让观察者能只读浏览 task-space/workspace 文件、查看运行中/已结束 session 的详情/事件/富事件流/raw，并保持现有 5s run 轮询、90% 节点弹层、确认/终止行为不变。

**不属于本方案**：文件编辑/上传/删除、终端、运行后归档浏览、attempt 产品端点、UI 直连 client、跨机 TLS/token 轮换。

**定级：P1**。理由：新增两个用户可见视图组件、扩展 `CMP-run-data` 公共读契约、改变 `CMP-bff` 热路径的响应方式（由全量缓冲改为流式）；需人确认组件拆分与 BFF 契约后再编码。

## 2 现状与变化轴

| 现状 | 本方案的变化 | 不变 |
|---|---|---|
| `CMP-instances` 节点弹层只有 `summary`/`log` 两 Tab | 增加 `files`/`session` Tab；confirm 卡增加“查看任务文件” | 90% 弹层、轮次 Tab、confirm 决策、5s 轮询 |
| `CMP-run-data` 只有 6 个操作 | 增加 6 个只读操作 + 2 个 URL 构造器 + 错误文案 | list/get/start/cancel/decide/sessionLogUrl 不变 |
| `CMP-bff` 用 `upstream.arrayBuffer()` 全量转发 | SSE/raw 走流式转发；JSON 仍完整转发 | 白名单、方法/头透传、502/504/413/405、无 DTO 映射 |
| 节点消息用 `renderMarkdown` | 文件预览复用 Markdown + 代码高亮 | 现有 XSS 转义/链接白名单 |
| 运行页只读 run 图 | 文件/会话只读 | 不推断 run 状态机、不缓存 |

**主要变化轴**：B4 端点/DTO、BFF 传输方式、节点弹层 Tab 生命周期。前两者集中在 `run-data`/`bff`，后者集中在 `instance-detail` 与两个新视图。

## 3 候选方案与选择

### 3.1 组件拆分

| 方案 | 内容 | 取舍 |
|---|---|---|
| **A（推荐）** | 新增 `CMP-run-files`、`CMP-run-session` 两个 L2 只读视图；`CMP-instances` 只做 Tab/上下文编排 | 视图可独立测试、SSE 生命周期可隔离；多两个组件 |
| B | 全部写进 `instance-detail.js` | 文件少；页面继续变大，文件树/SSE/轮询状态纠缠，测试只能整页跑 |
| C | 文件/会话各开独立详情页 | 页面简单；破坏“双击节点在弹层内审查”的主流程，confirm 入口割裂 |

**选择 A**。删除测试：删掉 run-files/session 后，节点弹层无法完成文件/会话审查，能力消失；不是透传。

### 3.2 BFF 流式

| 方案 | 内容 | 取舍 |
|---|---|---|
| **A（推荐）** | 在现有 `CMP-bff` 内按路径识别 SSE/raw，`Readable.fromWeb(upstream.body).pipe(res)` | 不新增进程/端口；复用白名单/请求 ID/错误处理；需严格处理“headers 已发出后的错误” |
| B | 单独 streaming 代理 | 部署复杂、双入口/双超时；无收益 |

**选择 A**。BFF 仍是 L0 技术边界，不引入业务/DTO。

### 3.3 SSE 传输

| 方案 | 取舍 |
|---|---|
| **EventSource（推荐）** | 同源 BFF、自动重连/自动带 `Last-Event-ID`；不能自定义请求头，但本场景不需要；关闭用 `close()` |
| fetch stream | 可自定义头/中止；需手写重连、事件帧解析；代码更多 |

**选择 EventSource**；若后续需要自定义鉴权头，再切 fetch stream，不改变产品契约。

## 4 组件地图与依赖

```text
L0 基础设施
  CMP-bff                同源转发；新增 SSE/raw 流式路径
  shared/http            既有 fetch/JSON/ApiError
  shared/markdown        既有 Markdown 只读渲染
  assets/vendor/*        既有 Prism（若未暴露，新增本地 highlight 适配，不引 CDN）

L1 数据服务
  CMP-run-data           唯一 B4 读入口；新增 6 个只读方法 + URL 构造器

L2 页面/视图
  CMP-instances          页面控制器：列表/详情/弹层/Tab/确认/轮询
  CMP-run-files          L2 只读视图：根切换、懒加载目录、预览
  CMP-run-session        L2 只读视图：session 详情/事件/SSE/raw

组合根
  server.js              静态 + 挂载 CMP-bff
```

**依赖边**：

| 调用方 | 被调方 | 契约 | 说明 |
|---|---|---|---|
| `CMP-instances` | `CMP-run-files` / `CMP-run-session` | `mount/unmount` | 页面只给 run/node/visit 与容器，不介入内部取数 |
| `CMP-run-files` / `CMP-run-session` | `CMP-run-data` | 只读方法/URL | **不直接 fetch**；不 import 页面/`DF` 业务逻辑 |
| `CMP-run-data` | `shared/http` | request | 统一错误归一 |
| `CMP-bff` | 后端 | `/api/v1/*` | 流式/非流式；无 DTO 映射 |
| 页面/视图 | `DF` / `shared/markdown` | 公共 UI/渲染 | 允许；不得复制弹层/表格 |

**禁止边**：页面直连 3100；新视图 import 其他页面；`CMP-bff` import 页面/DF/MOCK；`run-data` 缓存 run/session 数据；UI 展示 `sessionId`/`attemptId`。

## 5 契约

### 5.1 产品 API（UI 只读）

| ID | 路径 | 用途 | 关键点 |
|---|---|---|---|
| `API-48` | `GET /runs/{id}/files?root=&path=` | 列一层目录 | `entries[]` + `truncated` |
| `API-49` | `GET /runs/{id}/files/content?root=&path=` | 读文件 | `content/truncated/binary/reason/contentType/language` |
| `API-50` | `GET /runs/{id}/nodes/{nodeId}/session?visit=` | session 详情 | 无 sessionId |
| `API-51` | `GET /runs/{id}/nodes/{nodeId}/session/events?visit=&cursor=&limit=` | preview 事件 | 无 sessionId；`truncatedBefore?` |
| `API-52` | `GET /runs/{id}/nodes/{nodeId}/session/events/stream?visit=` | O-11 SSE | `snapshot/event/heartbeat/end`；`Last-Event-ID` |
| `API-53` | `GET /runs/{id}/nodes/{nodeId}/session/raw?visit=` | raw zstd | `application/zstd`；`content-length`/`etag`/`x-checksum-sha256` |

- 文件限制：client 2000 条 / 1 MiB；UI 只显示 `truncated`，不自行补全。
- 所有 session 响应/SSE data **不含** `sessionId`/`attemptId`；UI 不构造/展示。
- `RunSessionRichEvent`：`seq/ts/kind/lifecycle/messageId/toolCallId/acpType/text/tool/usage/permission/stopReason/error/data/truncated/originalBytes`。
- 错误：`404 session_not_linked`、`404 not_found`、`409 session_archive_not_ready`、`410 run_gone`、`503 client_observability_*`、`504`、`400 path_escape`。

### 5.2 `CMP-run-data` 新增

```js
listFiles(runId, { root, path })
readFile(runId, { root, path })
getSession(runId, nodeId, { visit })
listSessionEvents(runId, nodeId, { visit, cursor, limit })
sessionStreamUrl(runId, nodeId, { visit }) // EventSource
sessionRawUrl(runId, nodeId, { visit })    // 下载/新窗口

// errorText 增补
session_not_linked / run_gone / client_observability_unavailable /
client_observability_unauthorized / session_archive_not_ready / path_escape
```

- 输入 `runId`/`nodeId` 必须 `encodeURIComponent`；`root` 只接受 `task-space|workspace`；`visit` 可选。
- 不新增缓存；不把 `sessionId` 拼进 URL。

### 5.3 `CMP-bff` 流式契约

- 识别：路径匹配 `/api/v1/runs/{id}/nodes/{nodeId}/session/events/stream` 或 `/session/raw`；其余走现有 JSON 路径。
- 写流：
  1. 不读/缓冲 `upstream.body`；先 `res.writeHead(upstream.status, headers)`/`flushHeaders`。
  2. `Readable.fromWeb(upstream.body).pipe(res)`；`req.on("close")`/`res.on("close")` abort upstream。
  3. headers 透传：`content-type`、`cache-control`、`x-accel-buffering:no`、`content-disposition`、`content-length`（raw）、`etag`、`x-checksum-sha256`、`accept-ranges`。
  4. 请求头 `last-event-id` 加入 `REQUEST_HEADERS`。
  5. SSE 不设总超时；raw 不设总超时；JSON 仍用 `BFF_TIMEOUT_MS`（文件/session JSON 建议 30s，可由 `BFF_FILE_TIMEOUT_MS` 配置）。
  6. headers 已发后上游错误：`res.destroy()`，不再写 JSON；headers 前错误：502/504 JSON。
- 不允许把流式响应设置 `content-length`（SSE）；不要 `arrayBuffer()`。

### 5.4 视图契约

```js
// CMP-run-files
mount(container, { runId, nodeId, visit })
unmount()

// CMP-run-session
mount(container, { runId, nodeId, visit })
unmount()
```

- `mount` 期间只通过 `CMP-run-data` 取数；`unmount` 必须关闭 EventSource、清理定时器与在飞请求。
- 视图不拥有业务数据；不写 `sessionStorage`/`MOCK`；不修改 run 状态。

## 6 页面生命周期（关键）

现状：`CMP-instances` 在非终态每 5s 拉详情并 `render()`；节点弹层由 `DF.modal` 持有。若轮询重建弹层，文件/会话 Tab 会丢失选中项并重复创建 EventSource。

**设计**：

- `state.modal = { nodeId, visit, tab, files, session }`；`openNodeModal` 只在节点/轮次变化时重建。
- `render()` 更新 `state.run` 后，仅刷新弹层**概要区/状态标记**；不重新 `mount` 当前 `files`/`session`。
- Tab 切换：先 `unmount` 旧视图，再 `mount` 新视图；`session` 离开时关闭 EventSource。
- 弹层关闭/节点/轮次切换：`unmount` 全部视图并清空缓存状态。
- 文件 Tab 内部保留 `root/path/selected`；轮询不重置。
- 只有用户操作（root/目录/文件）触发新的 `listFiles`/`readFile`；轮询不重复请求文件。

## 7 UX 与错误

### 文件 Tab

- 默认 `root=task-space`；可切 `workspace`；面包屑；懒加载目录；目录/文件图标；`hidden` 弱化。
- 预览：`.md` 用 `renderMarkdown`；代码按 `contentType/language` 高亮；无语言纯文本；`binary`/`too_large` 显示原因和 `sizeBytes`；`truncated` 显示“超过 1 MiB/2000 条”提示。
- 加载/空/错误三态；重试；只读；不编辑器/上传/删除。
- confirm 卡“查看任务文件”切到 `files`，默认 task-space；`confirm` 节点无 session 时 `session` Tab 显示“该节点无会话”。

### 会话 Tab

- 详情：status/cwd/startedAt/finishedAt/eventCount/archive.status；**不显示 sessionId/attemptId**。
- 事件：seq/ts/kind/event/message；`truncatedBefore` 提示早期截断。
- 实时：`EventSource(sessionStreamUrl)`；`snapshot` 初始化、`event` 追加、`heartbeat` 忽略、`end` 停止；自动重连由 EventSource + BFF `Last-Event-ID`。
- raw：下载链接；BFF 流式；不在前端 `arrayBuffer`。
- 保留现有“会话日志”Tab，区分调度日志 vs client session。

### 错误文案

| 状态 | 文案/行为 |
|---|---|
| `404 session_not_linked` | “该节点结果未关联会话”；文件 Tab 仍可用 |
| `404 not_found` | 运行/节点/文件不存在 |
| `410 run_gone` | 记录已清理，不重试 |
| `409 session_archive_not_ready` | 归档未完成，稍后刷新 |
| `503 client_observability_*` | 执行节点观测面不可用；提示 client 未启动/未开启观测面 |
| `504` | 执行节点未响应；可重试 |
| `400 path_escape` | 路径非法，回根目录 |

## 8 冷热、超时与资源

| 路径 | 冷热 | 超时 | 失败 |
|---|---|---|---|
| 文件列表/内容、session 详情/事件 | 热（用户操作/分页） | BFF JSON 30s（建议） | 快速错误 + 重试 |
| O-11 SSE | 热（实时） | 无总超时；15s heartbeat | EventSource 重连；页面隐藏可保留/关闭 |
| raw 下载 | 冷（用户主动、大文件） | 无总超时 | 403/404/409/410；BFF 流式 |
| run 5s 轮询 | 热 | 现有 | 不因 SSE 失败阻塞轮询 |

- BFF 每个流独立 `res`/upstream；无共享队列/锁；SSE/raw 不进入 JSON 超时定时器。
- 页面隐藏时 EventSource 可保留（浏览器节流）或关闭；方案默认保留，弹层关闭必关。

## 9 测试与场景

### BFF

- `tests/bff/stream.test.js`（新增，`npm run test:bff`）：
  1. SSE 首帧在 upstream 未结束时已写给客户端，未全量缓冲。
  2. `Last-Event-ID` 透传。
  3. raw 透传 `content-length`/`etag`/`x-checksum-sha256`/`content-disposition`。
  4. 客户端断开 → upstream abort，不悬挂。
  5. 流式路径错误在 headers 前 502/504，headers 后 destroy。
- 现有 JSON/304/409 用例保持。

### UI

- 建议扩展 `SCN-0004`（同一运行详情页），由 UI `req-scenario` 流程确认编号；至少 3+1：
  1. confirm 节点打开文件 Tab，task-space 列目录并渲染 `.md`；
  2. 代码高亮、`truncated`/`binary` 文案、workspace 根切换；
  3. 会话 Tab 详情/事件/SSE 首帧/raw 链接；
  4. 503/504/404/410 错误文案；无 `sessionId` 出现在 DOM/请求。
- `tools/verify-m1-scenarios.js SCN-0004` 或新 runner；fake BFF 支持 SSE/raw；真实 run 走 `debug-runbook.md`。
- UI 文档：`components/run-data/spec.md` 增方法；`components/instances/spec.md` 增 Tab；新建 `components/run-files/spec.md`、`components/run-session/spec.md`；`bff/spec.md` 增流式；`architecture.md` 组件地图更新。

## 10 实施顺序

1. **P1 确认**：本方案 A + EventSource + BFF 超时 + 场景编号。
2. UI 项目：`run-data` 6 方法 + errorText；BFF 流式 + 单测。
3. `CMP-run-files` + 页面 files Tab + confirm 入口。
4. `CMP-run-session` + events/SSE/raw。
5. Playwright 3+1 + 真实 run 调测。
6. UI 规格/架构更新，发布门禁。

## 11 非目标

- 文件编辑/上传/删除、终端、二进制预览、运行后归档浏览。
- 代理 attempt `O-02`–`O-05` 为产品端点；UI 不展示 attempt。
- UI 直连 client；BFF 鉴权/TLS/CORS。
- 新 vendor/CDN；Prism 复用现有本地资源。

## 12 P1 确认记录

| 决策 | 结论 | 确认时间 |
|---|---|---|
| 组件拆分 | **A：新增 `CMP-run-files` / `CMP-run-session`**；`CMP-instances` 只做 Tab/上下文编排 | 2026-11-17 |
| SSE 传输 | **`EventSource`**；BFF 透传 `Last-Event-ID` | 2026-11-17 |
| BFF 超时 | **文件/session JSON 30s；SSE/raw 无总超时；stream 不缓冲** | 2026-11-17 |
| 场景 | 推荐扩展 `SCN-0004`；最终编号由 UI 项目确认 | 待 UI |

> 已确认方案 A 冻结。下一步在 `agent-flow-ui` 实现组件/BFF/页面；本仓库不改 UI 代码。
