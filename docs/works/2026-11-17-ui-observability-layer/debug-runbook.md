---
layer: works
module: global
status: active
updated: 2026-11-17
procedure: 2026-11-17-ui-observability-layer
---

# 调测 runbook：UI 文件/会话 Tab + BFF 流式

> 目标：UI 实现前/后，用真实 orchestrator + client v1.2 + 同源 BFF 跑通文件、session 详情/事件/SSE/raw，并定位“缓冲、无 session、client 停机、归档未完成”四类问题。
> 固定端口：UI 3000、orchestrator 3100、client observer 17890（默认；可配）。页面只访问 3000，不直连 3100/client。

## 0 前置版本

| 侧 | 版本/入口 |
|---|---|
| orchestrator | 当前工作区；`bun run src/main.ts`，`127.0.0.1:3100`；`/openapi.yaml` 含 `API-48`–`API-53` |
| client | `client-observability-v1.2`（`e0946f4`）；176/0；`serve` 开启观测面 |
| UI | 当前 `agent-flow-ui`；`node server.js` 同源 3000；BFF `API_BASE=http://127.0.0.1:3100` |
| 运行 | 一个 `waiting_confirm` 或 running 的 run；节点 n1 已 dispatch 或已完成 |

## 1 启动

### 1.1 orchestrator

```bash
cd /Users/chenlong/harness/agent-flow-orchaster
export PATH="$PWD/.local/bun:$PATH"
bun run src/main.ts            # config/local.toml -> 3100
curl -s http://127.0.0.1:3100/healthz
```

### 1.2 client（真实或 fake ACP）

真实 DSH：

```bash
cd /Users/chenlong/harness/agent-flow-client
bun src/cli.ts serve --config <client-config.toml> --state-root <state-dir>
```

配置要点：

```toml
[scheduler]
url = "http://127.0.0.1:3100"
token = "<harness-binding-token>"

[observability.http]
enabled = true
bind = "127.0.0.1"
port = 17890
advertise_url = "http://127.0.0.1:17890/api/v1/observability"
```

- client 启动成功后，poll 请求带 `X-Observability-Url`；orchestrator 内存登记。
- `curl -H 'Authorization: Bearer <token>' http://127.0.0.1:17890/api/v1/observability/health` 应 200。
- fake ACP 的 raw 会 409；真实 DSH 才有 session 归档。

### 1.3 UI

```bash
cd /Users/chenlong/harness/agent-flow-ui
API_BASE=http://127.0.0.1:3100 PORT=3000 node server.js
```

打开：

```text
http://127.0.0.1:3000/pages/instance-detail.html?id=<runId>
```

## 2 先验 BFF（不依赖页面）

### 2.1 文件

```bash
# 列 task-space 根
curl -s 'http://127.0.0.1:3000/api/v1/runs/<runId>/files?root=task-space&path=' | jq

# 读文件
curl -s 'http://127.0.0.1:3000/api/v1/runs/<runId>/files/content?root=task-space&path=notes.md' | jq
```

预期：200；`entries`/`truncated`；`content`/`binary`/`reason`；无 `sessionId`。

### 2.2 session

```bash
curl -s 'http://127.0.0.1:3000/api/v1/runs/<runId>/nodes/n1/session' | jq

curl -s 'http://127.0.0.1:3000/api/v1/runs/<runId>/nodes/n1/session/events?limit=20' | jq

# SSE：必须逐帧到达，不能等全部结束
curl -N -H 'Accept: text/event-stream' \
  'http://127.0.0.1:3000/api/v1/runs/<runId>/nodes/n1/session/events/stream'

# raw：真实 DSH 完成后才 200；fake ACP 通常 409
curl -D - -o /tmp/session.zst \
  'http://127.0.0.1:3000/api/v1/runs/<runId>/nodes/n1/session/raw'
```

预期：

- SSE 首帧 `event: snapshot` 立即出现，随后 heartbeat/event/end；
- 响应头 `content-type: text/event-stream`、`cache-control: no-store`、`x-accel-buffering: no`；
- raw 200 时 `content-type: application/zstd`、`content-length`、`etag`、`x-checksum-sha256`；
- 任何响应都不含 `sessionId`/`attemptId`。

### 2.3 BFF 缓冲判定

若 SSE 在 `curl -N` 下等到流结束才一次性出现，或首帧延迟等于整个任务时长：

1. 查 `bff/index.js` 是否仍 `await upstream.arrayBuffer()`；
2. 查 BFF 是否把 `/session/events/stream` 走了 JSON 超时；
3. 查响应是否缺少 `x-accel-buffering: no`；
4. 查 UI `EventSource` 是否直连了 3100（应只连 3000）。

## 3 页面调测

1. 打开运行详情，双击节点 n1 打开 90% 弹层。
2. `files` Tab：
   - 默认 task-space；切 workspace；面包屑/懒加载；
   - 打开 `.md`（Markdown）、`.ts`（代码高亮）、二进制、超大文件；看 `truncated` 文案；
   - confirm 卡“查看任务文件”跳 files。
3. `session` Tab：
   - 详情字段；事件分页；`EventSource` 首帧；
   - 切 Tab/关闭弹层/切轮次，确认 EventSource 关闭（DevTools → Network/EventStream 无残留）；
   - run 5s 轮询期间，当前 Tab 的选中路径/SSE 不被重置。
4. Network 过滤：
   - 只出现 `127.0.0.1:3000/api/v1/...`；
   - 无 `127.0.0.1:3100`/`client` 直连；
   - SSE `text/event-stream`；raw `application/zstd`。

## 4 自动化

```bash
cd /Users/chenlong/harness/agent-flow-ui
npm run test:bff
node tools/verify-m1-scenarios.js SCN-0004   # 扩展后的 T7-T10
npm run test:scenario-trace
```

- BFF 单测需覆盖：SSE 首帧不缓冲、`Last-Event-ID`、raw 头、客户端断开 abort、流式错误。
- UI Playwright：文件/会话/错误/无 sessionId；3+1。
- 真实 run 的 raw 200 需要在真实 DSH 产出 session 归档后补验；fake ACP 仅验证 409。

## 5 失败矩阵

| 现象 | 首查 | 处理 |
|---|---|---|
| 文件/内容 503 `client_observability_*` | client `serve` 是否开启观测面；`X-Observability-Url` 是否登记 | 启 client/检查 token/bind |
| 504 `client_observability_unavailable` | client observer 是否存活；端口/防火墙 | 重启 client；BFF 把连接失败归一 504 |
| 404 `session_not_linked` | 节点是否有 task/session；client O-02 是否有 sessionId | 任务未启动/未绑定；文件 Tab 仍可用 |
| 409 `session_archive_not_ready` | client session 归档是否完成 | 完成后再下载 raw；fake ACP 预期 409 |
| 410 `run_gone`/`observation_gone` | client 保留策略 | 不重试；提示已清理 |
| SSE 一次性到达/超时 | BFF 是否缓冲；是否套 10s | 改流式；SSE 无总超时 |
| EventSource 反复重连 | BFF 是否透传 `Last-Event-ID`；heartbeat | 修 BFF/检查 client SSE |
| 轮询后 Tab 重置 | 页面是否每次轮询重建弹层 | 按 proposal §6 保持 modal 稳定 |
| 页面出现 sessionId | DTO/SSE 是否剥离；UI 是否误用 | 修产品映射/UI 展示 |

## 6 版本与边界

- client 必须 `client-observability-v1.2`（`e0946f4`）；不要用 v1.1。
- UI 只访问 3000 同源 BFF；不直连 3100/client。
- 文件限制 2000 条/1 MiB；UI 显示 `truncated`，不补全。
- 本 runbook 不包含文件编辑/上传/终端；raw 只读下载。
- 真实 DSH 的 raw 200 与 UI 发布门禁需另跑；fake ACP 只验证协议/UI。
