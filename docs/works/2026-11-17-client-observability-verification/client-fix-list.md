---
layer: works
module: global
status: active
updated: 2026-11-17
procedure: 2026-11-17-client-observability-verification
level: P2
---

# client 观测面需要调整的清单（交给 client 仓库）

> 来源：`client-observability-v1` 验证（`result.md`）与真实 HTTP 探针；本清单只列 client 需要改的部分，不改 orchestrator。
> **2026-11-17 复验**：CF-01/03/04/05/08/13/19 已通过真实 HTTP；CF-07 只加 Accept-Ranges、CF-09 degraded、CF-15 大目录为残余；见 [`fix-verification/result.md`](../2026-11-17-client-observability-fix-verification/result.md)。
> **2026-11-17 hardening/v1.2**：client `v1.2`（`e0946f4`）修复 SSE cancel、启动失败不广告 URL、raw/session 410 tombstone；`signals` 根因是测试临时配置未传 CLI，v1.2 已修，176/0。见 [`client-blocker-review.md`](../2026-11-17-client-ui-handoff/client-blocker-review.md)。

> 优先级按「生产可用性 / 契约完整性 / 性能」排序；P0/P1 不阻塞本轮 orchestrator 只接 `O-06`–`O-11`，但上线前应清掉。

## 0 前置

- client 观测面当前在**未提交工作区**；交接前先提交/打 tag，orchestrator 侧按 commit 对接。
- 本文以 `agent-flow-client/docs/design/contracts/client-observability-v1.md` 为验收基准；改契约时同步更新该文件与测试。
- 不要求 client 改 attempt/preview/O-11 的产品范围；这些是 client 契约已选的。

## 1 P0（建议上线前必做）

| ID | 契约/问题 | 现状与证据 | 需要调整 | 落点 / 测试 |
|---|---|---|---|---|
| `CF-01` | SSE 取消时不应抛异常 | `probe-output.txt`：abort 时 `server.ts:321` 抛 `TypeError: Controller is already closed` | `attemptStream`/`sessionStream` 的 abort/cleanup 先判 `closed`，`controller.close()` 只调一次；`cancel()` 与 `request.signal` 共用清理 | `observer/server.ts`；新增 abort/reader.cancel 用例 |
| `CF-02` | 保留与上限必须执行 | `retentionDays`/`maxBytes`/`maxAttemptEventBytes` 只解析，未用于清理/截断；attempts/sessions 无界增长；`observation_gone` 不会出现 | 增加周期清理：attempt 事件按 `max_attempt_event_bytes` 截断；attempt/session/run 按 `retention_days`/`max_bytes` 清理；保留 tombstone 以便 410；活跃 attempt/session 不清理 | `observer/attempt-store.ts`、`archive.ts`、`store/runs.ts`、`cli/serve-compose.ts`；清理单测 |
| `CF-03` | 已清理 run 应区分 404/410 | `O-09`/`O-10` 清 run 后返回 `404 run_not_found`，契约 §14 有 `410 run_gone` | run 注册表删除时留 tombstone（或保留记录标记 `goneAt`）；O-09/O-10 对 tombstone 返回 410 | `store/runs.ts`、`observer/server.ts`；run_gone 用例 |
| `CF-19` | SSE 长连接不能被 server idle 超时切断 | 真实适配器探针首轮：`Bun.serve() timed out a request after 10 seconds`，`/sessions/s1/events/stream` 被 `ECONNRESET`；`startObserverServer` 未设 `idleTimeout`，而 heartbeat 是 15s | `Bun.serve` 设 `idleTimeout: 0`（或 ≥30s）；补 >15s 长连接测试 | `observer/server.ts`；SSE 长连接用例 |

## 2 P1（契约完整性）

| ID | 契约/问题 | 现状与证据 | 需要调整 | 落点 / 测试 |
|---|---|---|---|---|
| `CF-04` | `O-05`/`O-11` 支持 `Last-Event-ID` | 探针带 `Last-Event-ID: 1`，snapshot 仍含 seq 1；`attemptStream`/`sessionStream` 不读该头 | 读 `Last-Event-ID`；snapshot 从 `seq+1` 补发；超出 ring/保留范围时 `reset=true` | `observer/server.ts`；断线重连用例 |
| `CF-05` | `O-05` snapshot 带 `truncatedBefore` | 探针 `truncatedBefore` 缺失；`attemptStream` 只序列化 `{events}` | snapshot 加 `truncatedBefore`（来自 `attempts.events`） | `observer/server.ts`；截断用例 |
| `CF-06` | SSE 慢消费者有界 | 当前直接 `controller.enqueue`，无队列/上限；慢消费者可撑爆内存 | 每流队列 1000；超限发 `event: error`（`slow_consumer`）并关闭；不影响其他流 | `observer/server.ts`；慢消费者用例 |
| `CF-07` | `O-08` raw 支持 Range | HTTP 探针 `accept-ranges=null`；契约 §10 要求 `Accept-Ranges` | 加 `Accept-Ranges: bytes`；可选实现单 Range；无 Range 时保持 200 全量 | `observer/server.ts`；header/Range 用例 |
| `CF-08` | `O-06` 的 session meta 落盘 | 探针 `sessions/<id>/meta.json` 缺失；O-06 从 attempt 推导；契约 §15 写 sessions meta | 由 `CMP-runtime`/`CMP-observability` 落 `sessions/<id>/meta.json`，含 run/node/task/attempt/cwd/status/archive；或修订契约并删除该条 | `observer/archive.ts`/`recorder.ts`/`runtime`；布局用例 |
| `CF-09` | `O-01` health 真实字段 | `startedAt=now`、`uptimeMs=0`、`status=ok` 恒真；计数用 `list(limit=200)` 截断 | 记录真实启动时间/uptime；写盘持续失败置 `degraded`；计数用 store count 而非前 200 条 | `observer/server.ts`；health 用例 |
| `CF-10` | `O-03` `logRange.firstSeq` 准确 | 固定 `firstSeq:1`；保留截断后不准 | 从首事件 seq 计算；无事件为 0/null（按契约定） | `observer/server.ts`；截断用例 |
| `CF-11` | 文件限制与用户口径对齐 | 契约/实现 2000 条 / 1 MiB；用户曾要求 v1 不设限 | 若确认「不设限」：`WorkspaceFileReader.list/read` 去掉 2000/1 MiB clamp，`server.ts#runFiles/runFileContent` 不传固定值，加配置/契约/测试；若保留：在契约写明并接受 | `workspace/files.ts`、`observer/server.ts`、`cli/config.ts`；边界用例 |
| `CF-12` | `2 MiB/5s` 的归属 | 契约 §11 写 2 MiB/5s；client 侧只有 2000/1 MiB，无 5s/2 MiB | 明确是 adapter/BFF 限制还是 client 限制；若是 client，服务器加响应上限/超时；否则改契约措辞 | 契约 §11；client 测试或契约 diff |

## 3 P2（性能/一致性）

| ID | 问题 | 调整 |
|---|---|---|
| `CF-13` | `O-05` 已结束 attempt 只回 `end`，无 snapshot | 按契约/P1 决定是否 `snapshot` + `end`；若保留 `end`，契约写清 |
| `CF-14` | `O-11` 未发 `session.closed` rich 事件 | `recorder.settle` 在 close 前 publish `lifecycle: "session.closed"`（若契约要求） |
| `CF-15` | 大目录先读全部再截断 | `list` 用 `opendir`/提前停止到 limit+1，避免大目录全量 `lstat` |
| `CF-16` | raw 每次请求重读全文算 sha | 归档时把 size/sha 写入 meta，O-06/O-08 复用 |
| `CF-17` | 鉴权无显式 `auth=on/off` 开关 | 若需要与开发期 executor 同款开关：加 `auth` 配置；否则保留 token 语义并在契约写明 |
| `CF-18` | `O-04`/`O-05` attempt 与调度面重复 | 非缺陷；保持 client 本地排障用途，orchestrator 不代理即可 |

## 4 建议的验收补充

- `Last-Event-ID` 重连：断线后从 seq+1 补发，超出保留范围 `reset=true`。
- 慢消费者：队列满发 `slow_consumer` 并关闭，不影响其他流。
- abort/reader.cancel：无未捕获异常，定时器/订阅清理。
- 保留清理：过期 attempt/session/run 删除，410/`observation_gone` 可测。
- health：真实 uptime、`degraded`、计数不被 200 截断。
- raw：`Accept-Ranges`；Range 请求（如实现）。
- 文件限制按最终口径：2000/1 MiB 或配置化/不设限。

## 5 与 orchestrator 的关系

- orchestrator v1 只接 `O-06`–`O-11` + 文件；CF-01/02/03 等 P0 不阻塞当前文件审阅，但上线前应清。
- O-11 产品代理需要 **UI BFF 改流式**；这是 UI 项目任务，不在本清单的 client 修复项内。
- 若 client 改文件限制/契约，orchestrator 的 `RunFileContent.truncated`/adapter 2 MiB/5s 需同步；见 `2026-11-17-client-observability-integration/integration-proposal.md`。
