---
layer: design
module: execution-plane
component: CMP-observability-client
status: active
updated: 2026-11-17
---

# `CMP-observability-client` 组件规格

> 范围：orchestrator 侧对 client 只读观测面（`client-observability-v1`）的 HTTP 客户端适配器。
> 不包含：client 观测面实现、run 编排、产品 DTO、调度、UI。

## 1 主目标

把 client 的观测 HTTP 面封装成稳定的领域端口，让 `CMP-run` 能取运行文件与 session 数据，而不直接依赖 HTTP、URL、token 或 client 的错误格式。

**不负责**：

- run 状态机、节点推进、产品 DTO 与 HTTP 路由（`CMP-run`/`CMP-http-gateway`）；
- client 观测面实现与保留策略（client 仓库）；
- 数据库、文件存储、调度与鉴权策略；
- 缓存与重试（只读、调用方重试）。

## 2 拥有的数据

无。URL 目录由 `CMP-platform` 的内存 `ObservabilityDirectory` 持有；token 由 `CMP-harness` 读取；本组件不持久化。

## 3 公共契约

### 3.1 端口实现

```ts
type ClientRunFiles = {
  listFiles(input: { clientId; runId; root: "task-space" | "workspace"; path }): Promise<ClientRunFileListing>;
  readFile(input: { clientId; runId; root; path }): Promise<ClientRunFileContent>;
};

type ClientSessionObservability = {
  getSession(input: { clientId; sessionId }): Promise<ClientSessionView>;
  listEvents(input: { clientId; sessionId; cursor?; limit? }): Promise<ClientSessionEventPage>;
  openEvents(input: { clientId; sessionId; lastEventId? }): Promise<ReadableStream<Uint8Array>>;
  openRaw(input: { clientId; sessionId }): Promise<ClientStream>;
};
```

输入输出类型定义在 [`kernel`](../../architecture.md) 的端口层；适配器只做传输与形状映射。

### 3.2 行为

- URL：`ObservabilityDirectory.resolve(clientId)`；URL 必须是 `http(s)`、无 userinfo/fragment；末尾 `/` 归一。
- 鉴权：`ClientCredentialReader.clientToken(clientId)`；有值才带 `Authorization: Bearer`。
- 一元请求：5s 超时；JSON 响应 ≤2 MiB；不跟随重定向；4xx/5xx 按错误类映射。
- O-11 SSE：透传 `Last-Event-ID`；解析 SSE 帧并剥离 `sessionId`/`attemptId` 后重发；不缓存。
- raw：读取 `content-length`/`x-checksum-sha256`/`etag`，返回流。
- 错误：`ClientObservabilityUnavailableError`（网络/超时/5xx）、`ClientObservabilityUnauthorizedError`（401）、`ClientObservabilityInvalidError`（URL/JSON/缺头）、`ClientObservabilityHttpError`（其它 4xx，保留 client 状态码/错误码）。

## 4 依赖与边界

- 允许依赖：`kernel`（端口/类型/错误）、`platform`（内存地址目录）、`harness`（client token 端口）、Bun `fetch`。
- 禁止依赖：`run`、`http-gateway`、`catalog`、数据库、`FileStore`、UI。
- 组合根注入：`createObservabilityClient({ directory, credentials, fetchImpl? })`；`main.ts` 装配。
- 数据所有权：无；client 是观测数据权威。

## 5 验证

- 适配器单测（stub HTTP）：文件/会话/SSE/raw、401/404/500/超时/缺地址/非法 URL、SSE ID 剥离。
- 真实 client observer HTTP 对接：工序 `2026-11-17-client-observability-integration` 的探针；不纳入 CI。
- 单独运行：`bun test tests/components/observability-client`。

## 6 预算与运行

- 预算：目标 ≤15k token，上限 120k；当前源码约 10 KB。
- 状态：`active`（2026-11-17 接入）。
- 待定：静态 URL 配置/allowlist、流式空闲超时、跨机 TLS（见集成工序）。
