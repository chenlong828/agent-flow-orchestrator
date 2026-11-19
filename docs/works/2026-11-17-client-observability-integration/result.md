---
layer: works
module: global
status: closed
updated: 2026-11-17
procedure: 2026-11-17-client-observability-integration
level: P1
---

# 结果：orchestrator 对接 client 观测面（文件 + session）

> **2026-11-17 复验**：client `CF-19` SSE idleTimeout 已修为 30s，真实 16.5s 长 SSE 通过；适配器真实探针复跑通过。残余见 [`fix-verification/result.md`](../2026-11-17-client-observability-fix-verification/result.md)。

## 1 结论

orchestrator 侧对接已实现：`CMP-observability-client` 适配器、kernel 端口、platform 内存 URL 目录、harness client token 读取、`CMP-run` 文件/session 产品读、6 个产品 API（文件 2 + session 4，含 O-11 SSE）、poll URL 注册与 `runId` 富化、OpenAPI/规格/测试。

验证：`bun test --max-concurrency=1` **416 pass / 0 fail**；typecheck、docs:check、quality 报告 **0 违规**；真实 client observer HTTP 探针通过（文件/内容/session/事件/raw/O-11，SSE 无 sessionId/attemptId 泄露）。

**未完成/未纳入**：UI BFF 流式改造（UI 项目）、client 残余 `CF-07`/`CF-09`/`CF-15`/`CF-02`（client 仓库）、`SCN-0305`/`SCN-0303` 场景卡更新。无数据库迁移，`CMP-scheduler` 不变。

## 2 交付物

| 范围 | 落点 |
|---|---|
| kernel 端口/错误 | `src/core/kernel/ports.ts`（ClientRunFiles/ClientSessionObservability/ObservabilityDirectory/ClientCredentialReader）、`errors.ts`（4 个观测错误 + session_not_linked）、`index.ts` 导出 |
| URL 目录 | `src/core/platform/observability-directory.ts` + `index.ts` |
| harness token | `src/components/harness/types.ts`、`service.ts`（`clientToken` 只读） |
| 适配器 | `src/components/observability-client/{adapter,index}.ts`：URL/鉴权/超时/2 MiB/SSE 剥 ID/raw/错误映射 |
| run 产品读 | `src/components/run/{types,deps,service,index,client-observability}.ts`：文件/session/runIdForTask + DTO 映射 |
| 网关 | `routes/run.ts`（API-48–53）、`executor.ts`（X-Observability-Url）、`executor-types.ts`、`respond.ts`（错误码）、`openapi.yaml`（6 path、x-api-count 60） |
| 组合根 | `src/executor-backend.ts`（URL 注册 + task runId）、`src/main.ts`（目录/适配器/run 注入） |
| 规格/文档 | `design/components/observability-client/spec.md`、`run/spec.md` §3.3、`http-gateway/spec.md` §4.1.1/§5.9、`executor-http-v3.md` §3/§5/§7/§11.6、`architecture.md` 组件地图 |
| 测试 | `tests/components/observability-client/adapter.test.ts`、`tests/components/run/client-observability.test.ts`、`tests/components/http-gateway/{run-observability,executor-observability}.test.ts`、`openapi.test.ts` 计数/描述同步 |
| 真实探针 | `probe/adapter-real.ts` + `probe-output.txt` |

## 3 验证记录

- `bun run typecheck`：通过。
- `bun test --max-concurrency=1`：**416 pass / 0 fail**（含新增 O-02 反查、连接失败归一、事件 data 去 ID 等用例）。
- `bun run docs:check`：通过（16 个场景索引）。
- `bun run quality:report`：**违规 0 条**；仍有报告级 WARN（可选字段比例、导出数等），不含 ERROR。
- 真实 client observer → orchestrator 适配器探针输出：

```json
{"files":["a.md"],"content":"# hi\n","session":{"status":"running","eventCount":1},"events":1,"raw":{"sizeBytes":11,"sha256":"485e67...","hasEtag":true},"sse":{"hasSnapshot":true,"leaksSessionId":false,"leaksAttemptId":false}}
```

- 首轮真实探针暴露 client `Bun.serve` 未设 `idleTimeout`，SSE 10s 被切断（`ECONNRESET`）；已记入 client 修复清单 `CF-19`；第二轮按增量读首帧通过。


## 3.1 真实联调（无 UI，2026-11-17）

用真实 orchestrator `3100` + client `serve`（`client-observability-v1.2` / `e0946f4`）+ fake ACP 跑通核心路径，探针 [`probe/e2e-core.ts`](../2026-11-17-client-ui-handoff/probe/e2e-core.ts)，输出 [`probe/e2e-core-output.txt`](../2026-11-17-client-ui-handoff/probe/e2e-core-output.txt)：

| 用例 | 结果 |
|---|---|
| 运行中文件 | `workspace` / `task-space` 均 200；workspace `review.md`、task-space `slow.md` |
| 运行中 session | client O-02 已有 `sessionId=s-1` 且直接 O-06 200；产品 `API-50` 由 404 `session_not_linked` 修好后为 **200** |
| 运行中 O-11 | `API-52` 200，snapshot 首帧，无 sessionId 泄露 |
| 完成后 session | `API-50` 200；`API-51` 4 条事件，顶层与 data 均无 sessionId；`API-53` 409 `archive_not_ready`（fake ACP 无 session 归档） |
| 完成后 O-11 | snapshot + end；无 ID 泄露 |
| 文件内容 | `API-49` 200 `# normal\n` |
| confirm | pass 后 end 任务完成，run `done/succeeded` |
| client 停机 | 产品 session 返回 **504 `client_observability_unavailable`**（修复前 500） |

联调修复了 orchestrator 侧问题（client `v1.2` / `e0946f4` 复跑仍通过）：
1. `run_node.session_id` 为空时用 client `O-02` 按 `runId/nodeId/taskId` 反查运行中 sessionId；否则 O-11/运行中 session 不可用。
2. 适配器把 fetch 连接失败归一为 `ClientObservabilityUnavailableError`（504），不再落到 500；session 事件 `data` 中的 `sessionId`/`attemptId` 也剥离。

> client v1.2 复核：`signals` 测试已修（目录/配置隔离），本机 **176/0**；orchestrator 416/0 与 E2E 通过；client 发布门禁已闭合。

## 4 已知限制

| 项 | 影响 | 去向 |
|---|---|---|
| UI BFF 全量缓冲 | O-11 SSE/raw 经 BFF 不会实时，需 UI 改流式；orchestrator 代理本身可用 | UI 项目任务 |
| client SSE `idleTimeout=10s`、`Last-Event-ID`/慢消费者/保留等 | 长会话/重连/容量 | [`client-fix-list.md`](../2026-11-17-client-observability-verification/client-fix-list.md) |
| 发现只做自报 URL + 内存目录 | 无静态配置/allowlist；重启后由下一次 poll 自愈 | 集成设计待定项 |
| attempt 端点不代理 | 调度面已有 attempt；client `O-02` 仅内部反查 sessionId，不进入产品 API | 决策 |
| 文件限制 | client 2000 条 / 1 MiB；产品以 truncated 表达 | 已接受 v1 |
| `SCN-0305` / `SCN-0303` 场景卡 | 尚未创建/更新，测试 ID 未登记 | 后续工序 |
| 提交 | 本轮未 commit；工作区含其它在办改动 | 需按任务拆分提交 |

## 5 数据与边界

- 无新增表/迁移；`run_node.session_id` 仅内部读取，不进入 `RunNodeView` 或产品响应。
- `CMP-scheduler` 未改；`CMP-run` 不直接发 HTTP，文件/session 只经端口。
- 产品 API 54 → 60；执行面仍 5 个端点；`TaskRequest.runId?` 与 `X-Observability-Url` 为加法，不升协议。
- 文件/session 内容不落库、不写 `FileStore`；只做流式/JSON 转发。
