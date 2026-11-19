---
layer: works
module: global
status: closed
updated: 2026-11-17
procedure: 2026-11-17-client-observability-verification
level: P2
---

# 结果：client 观测面 v1 契约验证

> **2026-11-17 复验**：client 已修 P0/P1；`CF-19` 长 SSE 16.5s、`CF-04` Last-Event-ID、`CF-03` 410、`CF-08` session meta 等已通过。本文保留首次验证快照，最新结论见 [`fix-verification/result.md`](../2026-11-17-client-observability-fix-verification/result.md)。

## 1 结论

client 观测面 `client-observability-v1`（`2026-11-17.1`）的**核心文件与会话路径可用**：`O-01`–`O-11` 的基础 200、鉴权 401/200、文件列表/内容、session 详情/事件、raw、O-11 snapshot 均通过真实 HTTP 探测与单元测试。**没有阻塞 v1 人工确认文件浏览的 blocker**。

但契约与实现存在若干差异，主要影响**生产观测/重连/容量**，不影响 task-space 的 md/代码审阅：

- `O-05`/`O-11` 忽略 `Last-Event-ID`；snapshot 不带 `truncatedBefore`；没有慢消费者队列；SSE abort 会抛 `Controller is already closed`。
- `O-01` 的 `startedAt`/`uptimeMs`/`status` 是占位值；attempt/session 计数按 `limit=200` 截断。
- `O-08` 缺 `Accept-Ranges`；`sessions/<id>/meta.json` 未落盘（O-06 从 attempt 推导）。
- `O-09`/`O-10` 的已清理 run 返回 `404 run_not_found`，不是契约的 `410 run_gone`。
- `retentionDays`/`maxBytes`/`maxAttemptEventBytes` 只进配置，没有清理/截断逻辑；`2 MiB/5s` 未在 client 侧落地（实际是 2000 条/1 MiB）。
- 契约保留 attempt/preview/O-11 与文件限制，和此前口头「少量 attempt / 先不设限制」不一致；这是**口径决策**，不是实现崩溃。

**对接判断**：orchestrator v1 可以只消费 `O-06`/`O-07`/`O-08` + `O-09`/`O-10`；`O-02`/`O-03` 可作运维薄视图；`O-04`/`O-05`/`O-11` 不阻塞，先不代理。

## 2 验证基准与证据

- 契约：`agent-flow-client/docs/design/contracts/client-observability-v1.md`（`2026-11-17.1`）。
- 实现：client 工作区（**未提交**）`src/components/observer/*`、`src/components/store/runs.ts`、`src/components/workspace/files.ts`、`src/components/cli/{config,serve-compose,serve}.ts`。
- 命令与结果：

| 命令 | 结果 |
|---|---|
| `bun test tests/components/observer tests/components/store/runs.test.ts tests/components/workspace/files.test.ts` | **20 pass / 0 fail** |
| `bun test`（全量） | **166 pass / 1 fail**；唯一失败是 `tests/components/cli/signals.test.ts` UC-14（单独复跑仍失败，等待 `child.pid` 超时；与本观测面无关，需 client 侧单独排查） |
| `bun run typecheck` | 通过 |
| `bun run docs:check` | 通过（2 个场景索引） |
| `probe/probe.ts`（handler 级契约探针） | 覆盖 health/attempt/session/files/raw/SSE/auth/错误；结果见 `probe-output.txt` |
| `probe/http-probe.ts`（真实 HTTP） | health/attempt/files/content/session/raw/auth/SSE snapshot 均可达；结果见 `http-probe-output.txt` |

真实 HTTP 探针关键输出：

```text
HTTP health 200
HTTP attempts 200 + items
HTTP files 200 + a.md
HTTP file content 200 + "# hi\n"
HTTP session 200
HTTP raw 200 + contentType=application/zstd（accept-ranges=null）
HTTP O-11 SSE snapshot 200（首帧 snapshot）
HTTP auth missing 401 / valid 200
```

## 3 契约 → 实现 → 证据

| 契约 | 实现落点 | 证据 | 结论 |
|---|---|---|---|
| `O-01` health | `server.ts#health` | handler/HTTP 200 | 基础可用；字段占位（见 §4） |
| `O-02` attempt 列表 | `server.ts#listAttempts` + `attempt-store.ts#list` | 测试 + 探针 | 通过 |
| `O-03` attempt 详情 | `server.ts#attemptDetail` | 探针 | 基础通过；`logRange.firstSeq` 恒 1 |
| `O-04` attempt 日志 preview | `server.ts#attemptLogs` + `mapper.ts` | 测试 + 探针 | 通过；无 prompt/工具完整 I/O |
| `O-05` attempt 日志 SSE | `server.ts#attemptStream` | 探针 | 基础首帧；续传/慢消费者缺口 |
| `O-06` session 元数据 | `server.ts#sessionDetail` | 探针 | 通过 |
| `O-07` session 事件 | `server.ts#sessionEvents` | 探针 | 通过 |
| `O-08` raw | `server.ts#raw` | 探针 | 200/403/409 通过；缺 `Accept-Ranges` |
| `O-09` 文件列表 | `server.ts#runFiles` + `workspace/files.ts` | 测试 + 探针 | 通过；`run_gone` 缺口 |
| `O-10` 文件内容 | `server.ts#runFileContent` + `workspace/files.ts` | 测试 + 探针 | 通过；二进制/1 MiB 截断有测试 |
| `O-11` 富事件 SSE | `server.ts#sessionStream` + `rich-hub.ts` | 测试 + 探针 | 基础 snapshot/503 通过；续传/慢消费者缺口 |
| 鉴权 | `server.ts#authorized` + `config.ts` | 探针 401/200 | 通过；无显式 `auth=on/off` 开关 |
| run 注册表 | `store/runs.ts` | 4 条单测 | 通过；清理未被 observer 调用 |
| 文件读取 | `workspace/files.ts` | 4 条单测 | 通过；路径/符号链接/截断 |

## 4 缺口与分级

### Blocker

无（对 v1 文件/会话浏览）。

### 决策（需要口径）

| 项 | 事实 | 影响 | 建议 |
|---|---|---|---|
| 文件限制 vs「先不设限制」 | 契约/实现保留 2000 条 / 1 MiB；2 MiB/5s 未在 client 落地 | task-space 小文件影响低；workspace 大目录/大文件会截断 | v1 先按契约跑；要真不设限需改 client `WorkspaceFileReader`/server 并动契约 |
| attempt/preview/O-11 范围 | client 恢复完整 attempt/preview/O-11，超出「少量 attempt」 | 文件浏览不受影响；orchestrator 全消费会增加范围/BFF 流式成本 | orchestrator 只消费 `O-06`–`O-10`；`O-02`/`O-03` 薄用；`O-04`/`O-05`/`O-11` 先不代理 |
| 鉴权开关 | 契约没有 `auth=off/on` 字段；token 空 = 不鉴权，非 loopback 无 token 拒绝启动 | 默认本地透传已满足；「显式开关」未落地 | 接受当前 token 语义，或 client 补 `auth` 开关 |

### 待修（Hold）

| # | 缺口 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| 1 | `O-05`/`O-11` 忽略 `Last-Event-ID` | 探针带 `Last-Event-ID: 1`，snapshot 仍含 seq 1 | 断线重连重复全量 | client 按 `seq > Last-Event-ID` 补发 |
| 2 | `O-05` snapshot 无 `truncatedBefore` | 探针 `snapshot.truncatedBefore=false` | 客户端无法知道保留截断 | 在 snapshot 带 `truncatedBefore` |
| 3 | SSE abort 抛 `Controller is already closed` | `probe-output.txt` 的 TypeError（server.ts:321） | 取消/断开时可能留下异常日志 | 在 abort/cleanup 中判 `closed` 再 close |
| 4 | SSE 无慢消费者队列 | `server.ts` 直接 `controller.enqueue` | 慢消费者内存膨胀 | 队列上限 1000 + `slow_consumer` |
| 5 | raw 缺 `Accept-Ranges` | HTTP 探针 `acceptRanges=null` | Range 请求/大文件断点不可用 | 加 `Accept-Ranges: bytes` |
| 6 | `run_gone` 实际 404 | 探针清 run 后返回 `404 run_not_found` | 无法区分「地址错」与「数据过期」 | run 注册表保留 tombstone / 410 |
| 7 | `sessions/<id>/meta.json` 未落盘 | 探针 `missing` | 与契约 §15 存储不符；O-06 依赖 attempt | 落 session meta 或修订契约 |
| 8 | 保留/上限未执行 | `retentionDays`/`maxBytes`/`maxAttemptEventBytes` 仅解析；无清理/截断 | 磁盘无界；`observation_gone`/`run_gone` 不会出现 | 加清理任务与 attempt 事件上限 |
| 9 | `health` 字段占位 | `startedAt=now`、`uptimeMs=0`、`status=ok` 恒真；计数 `limit=200` | 运维判断失真 | 记录真实 startedAt/uptime/degraded；计数用 count |
| 10 | `O-03` `logRange.firstSeq` 恒 1 | `server.ts#attemptDetail` 固定 1 | 截断后范围不准 | 从首事件 seq 计算 |

## 5 对接结论

- **可用于 v1 文件浏览**：`O-09`/`O-10` 真实 HTTP 验证通过，路径逃逸/二进制/1 MiB 截断有测试。
- **可用于 session 代理**：`O-06`/`O-07`/`O-08` 真实 HTTP 验证通过；raw 头缺 Range，但下载本身可用。
- **不建议 v1 代理**：`O-04`/`O-05`（attempt 日志/SSE）、`O-11`（富 SSE）；UI BFF 当前全量缓冲，SSE/raw 需要 BFF 流式；attempt 归调度面。
- **限制**：client 仍按 2000/1 MiB；orchestrator 产品面会体现 `truncated`；要 no-limits 需 client 改动。
- **联调风险**：client 工作区未提交；full suite 的 signals 失败与观测面无关，但 client 仓库当前不是全绿。

## 6 未做 / 后续

- 未启动真实 `serve` + DSH 跑完整任务；本次验证 observer HTTP 与 handler，真实任务链路由联调工序覆盖。
- 未修任何 client 缺口；§4 Hold 项转 client 仓库后续工序。
- 未改 orchestrator 代码；集成实现见 [`2026-11-17-client-observability-integration/brief.md`](../2026-11-17-client-observability-integration/brief.md)。
