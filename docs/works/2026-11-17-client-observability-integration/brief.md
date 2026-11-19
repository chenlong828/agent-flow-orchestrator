---
layer: works
module: global
status: closed
updated: 2026-11-17
procedure: 2026-11-17-client-observability-integration
level: P1
---

# 工序：orchestrator 对接 client 观测面（文件 + session）

> 输入：client 已实现 `client-observability-v1`（`2026-11-17.1`）；验证结论见 [`2026-11-17-client-observability-verification/result.md`](../2026-11-17-client-observability-verification/result.md)。
> 用户指令（2026-11-17）：启动对接测试并准备实现，按约定流程走。
> 本工序是 **P1 实现准备**：先定消费范围、产品 API、适配器与测试，再动代码；未获 P1 确认前不编码。

## 0 P1 确认记录（2026-11-17）

- 范围：文件 + session（含 O-11 富 SSE）；attempt 日志/SSE 不代理。
- 文件限制：接受 client 2000 条 / 1 MiB；2 MiB/5s 在适配器/BFF 侧。
- 门禁：真实 client observer 探针 + CI stub。
- client 已知缺口：转 `2026-11-17-client-observability-verification/client-fix-list.md`，不阻塞本轮。

## 1 背景

client 观测面 v1 已可用：文件 `O-09`/`O-10`、session `O-06`/`O-07`/`O-08`、attempt `O-02`–`O-05`、富事件 `O-11`。验证发现核心文件/会话路径无 blocker，但 client 契约与上一轮 orchestrator 提案分叉：

- client 保留完整 attempt/preview/O-11；orchestrator 只需 session + 文件；
- client 文件仍限制 2000 条 / 1 MiB；与此前「先不设限制」不同；
- client 默认 loopback、无 token；非 loopback 需 token；没有显式 `auth` 开关。

本工序只做 **orchestrator 侧**：新增 client 观测适配器、文件产品 API、session 代理、poll URL/runId 对接；不改 client 观测面代码，不修验证 Hold 项。

## 2 范围

| 做 | 不做 |
|---|---|
| 新增 `CMP-observability-client` L0 适配器 + 端口（文件/session） | 代理 `O-04`/`O-05` attempt 日志/SSE |
| session 代理：`/runs/{id}/nodes/{nodeId}/session`、`/events`、`/events/stream`、`/raw` | 改 client 代码/契约/限制 |
| poll `X-Observability-Url` 注册 + `TaskRequest.runId` 富化 | 改 `CMP-scheduler` 派发/任务表 |
| `run_node.session_id` 内部读取；sessionId 不进入产品响应/SSE data | 新增数据库表/列/迁移 |
| 适配器 URL/SSRF/超时/鉴权/错误映射 | 做 TLS/token 轮换/跨 NAT 中继 |
| 契约测试、真实 observer HTTP 对接、产品 API 测试 | 修 client 验证 Hold 项（另行 client 工序） |
| O-11 产品 SSE 代理 | UI BFF 流式改造（UI 项目任务） |

## 3 验收标准

1. 适配器能对真实 client observer 完成文件列表/内容、session 详情/事件/raw、O-11 SSE；错误/超时/鉴权可判定。
2. 产品 API 6 个：文件 2 + session 4（详情/事件/富事件流/raw）；session 响应与 SSE data 不含 `sessionId`；run/node 不存在/未关联 session 有明确 404。
3. poll 能登记 `X-Observability-Url`；run 任务带 `runId`；无 URL/旧 client 时文件/session API 返回 503，不影响任务。
4. 无数据库迁移；`CMP-scheduler` 不变；`CMP-run` 不直接发 HTTP。
5. 测试：适配器契约测试（stub）、run/gateway 产品测试、真实 observer HTTP 对接；`bun run check` 全绿。
6. `openapi.yaml` 5 个新 path、`x-api-count` 54 → 59；契约/组件规格同步。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-INT-01` | design | kernel/platform/harness | 端口、URL 目录、token 读取、适配器契约 | 完成 |
| `T-INT-02` | change | observability-client | HTTP 适配器：URL/SSRF/超时/鉴权/DTO/错误/流 | 完成 |
| `T-INT-03` | change | run | 文件产品方法、`runIdForTask`、`sessionForNode`、DTO 映射 | 完成 |
| `T-INT-04` | change | http-gateway | 6 个产品 API（含 O-11 SSE 代理）、poll URL 头、runId 富化、OpenAPI | 完成 |
| `T-INT-05` | change | tests | 适配器/产品/真实 observer 对接测试 | 完成 |
| `T-INT-06` | docs | global | 组件规格、架构、契约 diff、场景/开放问题 | 完成 |

## 5 装载清单

- client 契约：[`client-observability-v1.md`](../../../../agent-flow-client/docs/design/contracts/client-observability-v1.md)
- 验证结论：[`result.md`](../2026-11-17-client-observability-verification/result.md)、[`review.md`](../2026-11-17-client-observability-verification/review.md)
- 集成设计：[`integration-proposal.md`](integration-proposal.md)
- orchestrator 现有：`src/components/run/*`、`src/components/http-gateway/routes/run.ts`、`src/executor-backend.ts`、`src/main.ts`、`docs/design/components/run/spec.md`、`docs/design/components/http-gateway/spec.md`
- 契约：`docs/design/contracts/executor-http-v3.md`

## 6 待确认（P1）

1. 产品范围：文件 2 + session detail/events/stream/raw 4；O-11 已确认纳入，attempt 日志/SSE 不代理？
2. 文件限制：按 client 契约 2000/1 MiB 先跑，2 MiB/5s 由适配器/BFF 体现？
3. 验证 Hold 项：接受为已知缺口、不阻塞本轮集成？
4. 鉴权/发现：默认 loopback 无 token；v1 `X-Observability-Url` 自报 + 内存目录，静态配置后置？
5. session 响应不回 `sessionId`、raw 走产品流（BFF 缓冲已知）？
6. 真实 observer 对接测试纳入本工序门禁（已确认）；CI 用 stub，真实探针作为工序证据？
7. O-11 产品 SSE 已纳入；UI BFF 流式改造由 UI 项目配套，本工序只保证 orchestrator SSE 代理可用？
