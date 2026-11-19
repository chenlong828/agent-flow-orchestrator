---
layer: works
module: global
status: closed
updated: 2026-11-17
procedure: 2026-11-17-client-observability-integration
level: P1
---

# 评审：orchestrator 对接 client 观测面（P1）

> 2026-11-17 复验：client `CF-19` 已修，长 SSE 16.5s/适配器真实探针通过；原 Hold 中 SSE idleTimeout 关闭。

## 结论

**通过**。orchestrator 侧 6 个产品 API、适配器、run 产品读、poll URL/runId 对接已实现并通过全量测试/质量门禁/真实 client observer 探针；无 UI 的真实 `serve` + fake ACP 联调也通过。blocker 0；O-11 的 UI 实时消费依赖 UI BFF 流式改造与 client SSE 修复，记为 Hold，不影响本轮 orchestrator 交付。

## Blocker

无。文件/内容/session/events/raw/O-11 首帧均通过真实 HTTP；无 sessionId/attemptId 泄露。

## Decision now

| 决策 | 内容 | 落点 |
|---|---|---|
| `D-01` | 只代理 `O-06`–`O-11` + 文件；`O-02` 仅内部反查 sessionId；attempt 产品端点不进入产品 API | `run/spec.md` §3.3、`http-gateway/spec.md` §4.1.1 |
| `D-02` | 发现 v1 用 poll `X-Observability-Url` 自报 + 内存目录；静态配置/allowlist 后置 | 集成设计 §4、组件规格 §6 |
| `D-03` | 接受 client 2000 条 / 1 MiB；产品以 `truncated` 表达；2 MiB/5s 在适配器/BFF | 集成设计 §7、`REQ-0002` 澄清 |
| `D-04` | session 产品 DTO 剥离 `sessionId`/`attemptId`；`run_node.session_id` 为空时内部用 O-02 反查；不代理 attempt | run 端口/路由实现 |

## Hold

| 项 | 不阻塞理由 | 去向 |
|---|---|---|
| UI BFF 全量缓冲 | orchestrator SSE/raw 代理可用；UI 实时消费需 BFF 流式 | UI 项目 |
| client SSE idleTimeout 10s / Last-Event-ID / 慢消费者 / 保留 / health | 首帧与短请求可用；长连接/重连/容量后续 | `client-fix-list.md` `CF-01`–`CF-19` |
| `SCN-0305`/`SCN-0303` 场景卡 | 组件/HTTP 测试已覆盖；场景登记另立 | 后续工序 |
| 静态 URL 配置/allowlist | v1 loopback 自报可用；生产跨机再补 | 组件规格 §6 待定 |
| 未 commit | 工作区混有其它在办改动；按任务拆分提交 | 交付前 |

## Verified sound

| 项 | 查了什么 | 结论 |
|---|---|---|
| 适配器 | stub HTTP 4 条用例：文件/会话/SSE/raw、401/404/500/超时/非法 URL | 通过 |
| run 产品读 | 4 条：文件映射、session 剥 ID、O-02 反查、`session_not_linked` | 通过 |
| 网关路由 | 2 条：6 路由/头、非法 root/path/visit | 通过 |
| 真实对接 | client observer 真实端口：文件/内容/session/events/raw/SSE | 通过 |
| 无 UI 联调 | client `serve` + fake ACP + orchestrator 3100：运行中文件/session/O-11、完成后 session/events/SSE、confirm pass/end、client 停机 504 | 通过 |
| 全量门禁 | typecheck、416 tests、docs、quality 0 违规 | 通过 |
| OpenAPI | 60 端点、44 path、61 operation、6 新 path/schema | 测试通过 |

## 备注

- 真实探针首轮复现 client SSE `idleTimeout` 10s 切断；已记 `CF-19`，不是 orchestrator 适配器错误。
- 本轮未改 client 代码；client 工作区仍未提交，orchestrator 集成以当前工作区快照验证。
