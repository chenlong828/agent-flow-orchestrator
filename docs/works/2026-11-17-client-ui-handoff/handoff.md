---
layer: works
module: global
status: active
updated: 2026-11-17
procedure: 2026-11-17-client-ui-handoff
---

# 交接：client / UI 补充工作

> 面向两个独立项目：client（`../agent-flow-client`）与 UI（`../agent-flow-ui`）。
> orchestrator 侧 6 个产品 API 已实现并验证；本仓库不再改 client/UI 代码。
> 本文是工作清单，不是新契约；契约以 orchestrator `API-48`–`API-53` 与 client `client-observability-v1` 为准。

## 0 当前基线

| 侧 | 已完成 | 仍需做 |
|---|---|---|
| orchestrator | `API-48`–`API-53` 文件/session/SSE/raw；适配器、poll URL/runId；416 测试/quality 0 | 场景卡 `SCN-0305`/`SCN-0303`、端到端 `confirm` run |
| client | P0/P1 修复；`CF-19` 16.5s 长 SSE、`CF-04`、`CF-03`、`CF-08`、`CF-13` 等复验通过 | 提交修复；`CF-07/09/15/02` 残余；`signals` 用例；契约/部署说明 |
| UI | 运行详情/节点弹窗/确认卡/会话日志 Tab 已存在 | BFF 流式；文件 Tab；会话 Tab；O-11/raw；测试与文档 |

**依赖顺序**：client 提交 → UI BFF 流式 → UI 数据层/Tab → Playwright/真实 run → orchestrator 场景与端到端。

## 1 client 侧

> 2026-11-17 阻塞复核：观测面/文件/session/O-11 **无 blocker**；client `v1.2`（`e0946f4`）已修 SSE cancel、启动失败不广告 URL、raw/session 410 tombstone，并修好 `signals` 测试的目录/配置隔离；本机 176/0，发布门禁闭合。见 [`client-blocker-review.md`](client-blocker-review.md)。

### 1.1 发布前必须完成

| ID | 事项 | 证据/现状 | 交付 |
|---|---|---|---|
| `CL-01` | 提交观测面修复 | 已提交/推送；`client-observability-v1.2` = `e0946f4`；`main` HEAD `cf9ebf7` 为门禁文档 | orchestrator pin `v1.2` / `e0946f4` |
| `CL-02` | 全量测试门禁 | **已通过**：v1.2 signals 270ms；全量/串行 176/0；typecheck/docs/quality 全绿；根因是测试临时 `.config` 未传 CLI | 无（已闭合） |
| `CL-03` | 部署口径 | `serve` 必须开启观测面；非 loopback 需 token；`advertise_url` 必须是 orchestrator 可达地址 | 部署说明/示例；真实 `serve` 截图或日志 |
| `CL-04` | 契约同步 | `Accept-Ranges`、2000/1 MiB、2 MiB/5s 归属、`degraded` 现状 | `client-observability-v1.md` 更新；与 orchestrator 文档一致 |

### 1.2 残余修复（按优先级）

| ID | 优先级 | 现状 | 需要 client 做 | 落点 |
|---|---|---|---|---|
| `CF-09` | P1 | `health.startedAt/uptimeMs` 已真实；`status` 仍固定 `ok` | 汇总事件写盘/归档持续失败，置 `degraded`；失败恢复后回 `ok` | `observer/server.ts`、`attempt-store.ts`、`archive.ts`；health 用例 |
| `CF-15` | P2 | 目录列表仍 `readdir` 全量 + 逐项 `lstat` | 提前停止到 `limit+1`；大目录不阻塞 | `workspace/files.ts`；大目录基准/用例 |
| `CF-02` | P2 | prune 已实现；每小时执行、首次启动不立即清 | 启动时执行一次；清理失败不阻塞；记录日志 | `cli/serve-compose.ts`、`store/runs.ts`；清理用例 |
| `CF-07` | P2（可选） | `Accept-Ranges: bytes` 已加；无 Range 切片 | 实现单 Range `206`，或契约明确 v1 不支持 Range | `observer/server.ts`；Range 用例/契约 |
| `CF-06` | P2（测试） | 慢消费者代码已按 `desiredSize` 限额 | 补真实慢消费者测试（或压测证据） | `tests/components/observer/server.test.ts` |
| `CF-10` | P2（测试） | `logRange.firstSeq` 从首事件算 | 补截断后 firstSeq 用例 | `tests/components/observer` |

> `CF-07` 不阻塞 UI 的文件预览；session raw 下载仍可全量。`CF-09` 不阻塞 UI；影响运维健康判断。

### 1.3 client 不要做

- 不要为 orchestrator 增加 attempt 代理、产品 DTO 或 UI 字段；orchestrator 只消费 `O-06`–`O-11` + `O-09`/`O-10`。
- 不要把 `sessionId` 从观测面移除；orchestrator 内部使用并在产品响应剥离。
- 不要把文件限制改成“不设限”；已确认接受 2000/1 MiB。

## 2 UI 侧

> UI 层的组件/BFF/页面生命周期设计见 [`2026-11-17-ui-observability-layer`](../2026-11-17-ui-observability-layer/proposal.md)；已确认方案 A/EventSource/30s，本节是任务清单。

### 2.1 `U-01` BFF 流式（P0，O-11/raw 的前置）

当前 `bff/index.js`：

- `const payload = Buffer.from(await upstream.arrayBuffer())`：全量缓冲；
- `DEFAULT_TIMEOUT_MS = 10000`：SSE/raw 会超时；
- `RESPONSE_HEADERS` 未含 `content-length`/`x-checksum-sha256`/`x-accel-buffering`。

需要：

1. 识别流式路径：`/api/v1/runs/{id}/nodes/{nodeId}/session/events/stream` 与 `/session/raw`。
2. 对这两类**不缓冲**：拿到 `upstream.body` 后 `Readable.fromWeb(...).pipe(res)`（或等价），先 `res.writeHead`/`flushHeaders`。
3. 透传请求头 `Last-Event-ID`（SSE 重连）与响应头 `content-type`、`cache-control: no-store`、`x-accel-buffering: no`、`content-length`、`content-disposition`、`etag`、`x-checksum-sha256`。
4. 请求关闭/abort 时销毁 upstream，避免悬挂；SSE 不设总超时，raw 可用大超时/无总超时。
5. 普通 JSON 仍保留 10s；文件列表/内容可按需提高（如 30s），不要把 SSE 套进 10s。

验收：BFF 单测用假 upstream 验证“首个 SSE 帧在 upstream 未结束时已写给客户端”、raw 字节不被 `arrayBuffer` 聚合；UI 端 `EventSource` 能持续收到 heartbeat。

### 2.2 `U-02` 数据层（P0）

`assets/js/run/data.js` 增加：

```js
listFiles(runId, { root, path })
readFile(runId, { root, path })
getSession(runId, nodeId, { visit })
listSessionEvents(runId, nodeId, { visit, cursor, limit })
sessionStreamUrl(runId, nodeId, { visit })  // EventSource 用
sessionRawUrl(runId, nodeId, { visit })     // 下载/新窗口
```

要求：

- 6 个路径对应 `API-48`–`API-53`；`root` 缺省 `task-space`；`path` 用 `URLSearchParams` 编码。
- 不把 `sessionId`/`attemptId` 放进 URL 或 DOM；只用 runId/nodeId/visit。
- 统一 `errorText` 增加：`session_not_linked`、`run_gone`、`client_observability_unavailable`、`client_observability_unauthorized`、`session_archive_not_ready`、`path_escape`。
- 文件/内容返回 `truncated`、`binary`、`reason`；UI 不得自行假设完整。

### 2.3 `U-03` 文件 Tab（P0，人工确认主入口）

`assets/js/pages/instance-detail.js` 节点弹窗当前 Tab 为 `summary`/`log`；增加 `files`（可再加 `session`）。

要求：

- **入口**：`confirm` 节点确认卡增加“查看任务文件”按钮，打开 `files` Tab；默认 `root=task-space`；保留 `workspace` 切换。
- **目录树**：懒加载，一次一层；面包屑；目录/文件图标；`truncated=true` 显示“仅显示前 2000 条”；`hidden` 文件可按现有约定弱化。
- **预览**：
  - `.md` 用现有 `renderMarkdown`（已做 HTML 转义）；
  - 代码用 `contentType`/`language` 映射到现有 Prism 高亮；无语言时纯文本 `<pre><code>`；
  - `binary`/`reason=too_large` 显示原因与 `sizeBytes`，不渲染；
  - `truncated` 显示“文件超过 1 MiB，已截断”并保留已读内容；
  - 加载中/空目录/错误三态；刷新按钮；只读，不提供编辑/上传/删除。
- **根切换**：task-space 与 workspace 都可用；workspace 默认展示任务工作区，不主动遍历 `node_modules`（按点击懒加载）。

### 2.4 `U-04` 会话 Tab（P1）

节点弹窗增加 `session` Tab（任务节点可用；`confirm` 节点无 session 时显示“该节点无会话”，引导到文件 Tab）。

- 详情：`RunSessionView` 的 `status`、`cwd`、`startedAt`/`finishedAt`、`eventCount`、`archive.status`；**不显示 sessionId/attemptId**。
- 事件：`RunSessionEventPage` 分页列表（seq/ts/kind/event/message）；`truncatedBefore` 有值时提示“早期事件已截断”。
- 实时：`API-52` SSE（`snapshot`/`event`/`heartbeat`/`end`）；用 `EventSource` 或 fetch stream；`snapshot.events` 初始化，`event` 追加；自动重连依赖 BFF 透传 `Last-Event-ID`。
- raw：`API-53` 下载按钮/新窗口；由 BFF 流式转发；不要在前端 `arrayBuffer` 全量读。
- 保留现有“会话日志”（`API-47` gzip JSONL）Tab，不要混用：`log` 是调度面日志，`session` 是 client 观测面。

### 2.5 `U-05` 错误/限制/只读

| 场景 | UI 行为 |
|---|---|
| `404 session_not_linked` | “该节点结果未关联会话”；文件 Tab 仍可用 |
| `404 not_found`（run/node/file） | 明确“运行/节点/文件不存在” |
| `410 run_gone` | “运行记录已按保留策略清理”；不重试 |
| `409 session_archive_not_ready` | “会话归档尚未完成”；稍后刷新 |
| `503 client_observability_*` | “执行节点观测面不可用”；提示 client 未启动/未开启观测面 |
| `504` | “执行节点未响应”；可重试 |
| `400 path_escape`/`validation_error` | 路径非法；回到根目录 |
| `truncated`/`binary` | 按 `U-03` 显示；不伪造完整 |
| 文件限制 | 2000 条/1 MiB；UI 文案与契约一致 |

边界：UI 只调 orchestrator 同源 BFF；**不得直连 client**；产品响应/SSE 中不应出现 `sessionId`/`attemptId`；无编辑/上传/删除/终端。

### 2.6 `U-06` 测试与文档（P1）

- BFF 单测：SSE 首帧不缓冲、raw 透传、`Last-Event-ID`、abort 清理、超时。
- Playwright（`tools/verify-m1-scenarios.js`）：扩展 `SCN-0004` 或新增场景，覆盖：
  1. confirm 节点打开文件 Tab，task-space 列目录，打开 `.md` 渲染；
  2. 代码文件高亮、`truncated`/`binary` 文案；
  3. workspace 根切换；
  4. 会话 Tab 详情 + 事件 + SSE 首帧 + raw 下载；
  5. 503/504/404/410 错误文案；
  6. 无 `sessionId` 出现在 DOM/请求。
  按项目规范 3+1 条测试并登记场景。
- 文档：`design/components/run-data/spec.md` 增 6 个方法；`design/components/instances/spec.md` 节点弹窗 Tab 与只读约束；`design/contracts/bff-http.md`（若存在）补流式。

## 3 API 对照（UI 只读）

| ID | 方法/路径 | 用途 | 关键 DTO/头 |
|---|---|---|---|
| `API-48` | `GET /api/v1/runs/{id}/files?root=&path=` | 列一层目录 | `RunFileListing{entries,truncated}`；entry 含 `path/type/sizeBytes/hidden/previewable/contentType/language` |
| `API-49` | `GET /api/v1/runs/{id}/files/content?root=&path=` | 读文件 | `RunFileContent{content,truncated,binary,reason,contentType,language}` |
| `API-50` | `GET /api/v1/runs/{id}/nodes/{nodeId}/session?visit=` | session 详情 | `RunSessionView`；无 sessionId |
| `API-51` | `GET /api/v1/runs/{id}/nodes/{nodeId}/session/events?visit=&cursor=&limit=` | preview 事件 | `RunSessionEventPage`；无 sessionId |
| `API-52` | `GET /api/v1/runs/{id}/nodes/{nodeId}/session/events/stream?visit=` | O-11 SSE | `text/event-stream`；`snapshot/event/heartbeat/end`；`Last-Event-ID` |
| `API-53` | `GET /api/v1/runs/{id}/nodes/{nodeId}/session/raw?visit=` | raw zstd | `application/zstd`；`content-length`/`etag`/`x-checksum-sha256` |

- `RunSessionRichEvent`：`seq/ts/kind/lifecycle/messageId/toolCallId/acpType/text/tool/usage/permission/stopReason/error/data/truncated/originalBytes`；无 `sessionId`/`attemptId`。
- 文件限制：client 2000 条/1 MiB；orchestrator 以 `truncated` 表达；2 MiB/5s 在适配器/BFF。
- 错误码：`not_found`、`session_not_linked`、`run_gone`、`client_observability_unavailable`、`session_archive_not_ready`、`path_escape`、`validation_error`。
- OpenAPI 60 端点；`API-48`–`API-53` 见 `openapi.yaml`。

## 4 验收清单

### client

- [ ] 提交修复 commit/tag；提供 hash。
- [ ] `bun test` 全绿或 `signals` 既有失败有明确结论；`typecheck`/`docs:check`/`quality` 通过。
- [ ] `CF-09`/`CF-15`/`CF-02` 处理或明确接受；`CF-07` 契约注明可选。
- [ ] `serve` 开启观测面，`advertise_url` 可达；真实 `serve` + `Last-Event-ID` 验证。
- [ ] `client-observability-v1.md` 与实现一致。

### UI

- [ ] BFF 流式 SSE/raw，不再 `arrayBuffer` 全量；`Last-Event-ID` 透传。
- [ ] 文件 Tab：task-space/workspace、懒加载、Markdown/代码高亮、truncated/binary、只读。
- [ ] 会话 Tab：详情/事件/SSE/raw；无 sessionId；与 `会话日志` 区分。
- [ ] confirm 卡“查看任务文件”入口。
- [ ] 503/504/404/410/409 文案。
- [ ] Playwright 3+1 通过；BFF 单测通过；文档更新。
- [ ] 不直连 client；产品响应无 sessionId/attemptId。

### 端到端

- [ ] client `serve` + orchestrator `3100` + UI BFF/UI 同源；
- [ ] 跑一次真实 `confirm` run，节点弹窗看 task-space 文件、会话事件/SSE、raw；
- [ ] 文件超 1 MiB/目录超 2000 条的文案；
- [ ] 断网/停 client 的 503/504 文案。

## 5 非目标

- 不做文件编辑/上传/删除/终端；不做运行后归档浏览、confirm 自动快照。
- 不做 attempt `O-02`–`O-05` 产品代理；调度面已有会话日志。
- 不在 UI 直连 client；不在 client 加 UI DTO。
- 不做跨机 TLS/token 轮换/静态 URL 配置；v1 自报 + loopback。

## 6 参考

- orchestrator 集成结果：[`integration/result.md`](../2026-11-17-client-observability-integration/result.md)
- client 修复复验：[`fix-verification/result.md`](../2026-11-17-client-observability-fix-verification/result.md)
- client 修复清单：[`client-fix-list.md`](../2026-11-17-client-observability-verification/client-fix-list.md)
- client 基线：`client-observability-v1.2` = `e0946f4`；`main` HEAD `cf9ebf7` 为门禁文档提交
- client 阻塞复核：[`client-blocker-review.md`](client-blocker-review.md)
- HTTP 契约：[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) §4.1.1
- run 契约：[`run/spec.md`](../../design/components/run/spec.md) §3.3
- client 契约：`agent-flow-client/docs/design/contracts/client-observability-v1.md`
- client 修复反馈：`agent-flow-client/docs/works/2026-11-06-observability-http/client-fix-response.md`
- UI 数据层：`agent-flow-ui/assets/js/run/data.js`
- UI 页面：`agent-flow-ui/assets/js/pages/instance-detail.js`
- UI BFF：`agent-flow-ui/bff/index.js`
