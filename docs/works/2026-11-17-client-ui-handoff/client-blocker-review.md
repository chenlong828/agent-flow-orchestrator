---
layer: works
module: global
status: active
updated: 2026-11-17
procedure: 2026-11-17-client-ui-handoff
---

# client 阻塞复核（2026-11-17）

> 结论：**观测面/文件/session/O-11 对接没有 blocker；client 发布门禁已闭合**。client `client-observability-v1.2`（`e0946f4`）修复了 signals 测试的目录/配置隔离问题，本机 176/0；P1 代码项已在 hardening 修复；P2 仍有活跃 run 保护等。
> 证据：真实 HTTP 复验（`fix-verification/probe-output.txt`）、client `bun test`/`typecheck`/`docs:check`/`quality:gate`、hardened E2E（`probe/e2e-core-output.txt`）、代码走查。

## 1 结论

| 判断 | 结论 |
|---|---|
| orchestrator 对接 client 文件/session/O-11 | **无 blocker**；6 个产品 API 的真实探针通过 |
| client P0/P1 修复 | 通过；`CF-19` 长 SSE、`CF-04`、`CF-03`、`CF-08` 等复验通过 |
| client 发布门禁 | **已闭合**：v1.2 `e0946f4`；`signals` 270ms 通过；全量/串行 176/0；工作区干净 |
| UI O-11 实时 | **UI 侧阻塞**：BFF 仍缓冲；不是 client 阻塞 |
| 生产加固 | 2 个 P1、2 个 P2（见下） |


## 1.1 2026-11-17 hardening 复核

- client 基线：`client-observability-v1.2` = **`e0946f4`**（`fix: signals 测试显式传临时配置`）；`main` HEAD `cf9ebf7` 只在其后追加 v1.2 门禁文档。orchestrator 应 pin **v1.2 / e0946f4**。
- 已修复：SSE `cancel()` 统一走 `finish()`；`observer-setup` 的 `record`/`advertiseUrl` 解耦（bind 失败仍记录、不广告）；raw/session 对 `gone` tombstone 返回 410；session prune 保留 `gone` 文件。
- **已闭合**：`signals.test.ts` 在 v1.2 修复后 270ms 通过；全量/串行 `bun test` **176/0**；typecheck/docs/quality 全绿。根因是测试临时 `.config` 未传 CLI（`resolveRunDir` 落到 client 仓库），不是产品取消逻辑。
- **仍未改**：`observer-setup` 的 `activeRunIds` 只来自 `status=running` 的 attempt；`waiting_confirm` 等无 running attempt 的活跃 run 仍可能在 30 天后被 tombstone（P2）。
- 无 UI 联调（hardened client）通过：运行中文件/session/O-11、完成后 session/events/SSE、confirm/end、client 停机 504。

## 2 发布门禁（已闭合）

### 2.1 `signals.test.ts` UC-14（v1.2 已修）

- v1.2 命令：`bun test tests/components/cli/signals.test.ts` → **1 pass / 0 fail（270ms）**；全量/串行 **176 pass / 0 fail**。
- hardening 版本曾是：`ENOENT child.pid`，10s 超时；全量/串行 175 pass / 1 fail。
- **失败点不是 SIGINT 断言**：测试先等 `prompt-started.txt` 最多 10s，然后无条件读 `child.pid`；失败发生在第 71 行读 pid 时，`child.kill("SIGINT")` 和 130/取消断言都还没执行。
- **临时目录证据**：失败后目录只有 `.config`、`pkg`、`request.json`、`workspace`；**没有 `prompt-started.txt`，也没有 `child.pid`**，说明 fake ACP 没有走到 prompt，不是 pid 写入竞态。
- **根因**：测试把 `.config` 写在临时 `runDir`，但启动命令是 `bun src/cli.ts run --request ...`，**没有 `--config`**；`resolveRunDir` 从模块目录解析到 client 仓库，临时配置被忽略。测试里的 `dsh_home`/`state` 还是相对路径，即使传 `--config` 也会相对 client 仓库解析。
- **产品信号路径本身正常**：用同一请求，显式传 `--config`（绝对路径）+ `--state-root` + `env -u DSH_HOME` 手工跑：`prompt=yes`、`pidfile=yes`；SIGINT 后 `exit=130`、stdout `status:"cancelled"`、sleep 进程已退出（`sleep_alive=no`）。
- 影响：这是 **测试隔离/配置传递 bug**，不是调度/取消产品 bug；v1.2 已修测试，CI 不再红。
- 修复：测试显式传 `--config <绝对路径>` 与 `--state-root <绝对路径>`；超时输出 child exit/stderr，先断言 prompt 再读 pid。
- 证据：`tests/components/cli/signals.test.ts:69-71`；手工复现输出。

### 2.2 版本 pin

- `client-observability-v1.2` = `e0946f4`；`main` HEAD `cf9ebf7` 是其后文档提交；工作区干净。
- orchestrator pin **v1.2 / e0946f4**；不要继续用 v1.1。

## 3 P1 代码级风险（不阻塞当前对接，建议上线前修）

### 3.1 SSE `cancel()` 未统一走 `finish()`（hardening 已修）

- `src/components/observer/sse.ts`：
  - `attemptStream.cancel()` 只 `close()`；`createWriter` 的 `poll`/`heartbeat` 仍可能继续。
  - `sessionStream.cancel()` 只 `close()`；`finish()` 才 `clearInterval` 和 `unsubscribe`/`unsubscribeClose`。
- 影响：客户端直接 `reader.cancel()`（不 abort request）时，`request.signal` 未必触发；每个取消的流可能留下 500ms poll、15s heartbeat 和 rich 订阅，EventSource 频繁重连会累积。
- 建议：`cancel()` 调 `writer.finish()` / `finish()`；`finish` 幂等；补“cancel 后不再收到事件/不再增长 activeStreams”的测试。
- 证据：`sse.ts` 的 `cancel()` 与 `finish` 定义；`sse-writer.ts`。

### 3.2 observer 启动失败时仍自报观测面 URL（hardening 已修）

- `serve-compose.ts` 的 `transport` 用 `config.observability.enabled` 决定是否带 `X-Observability-Url`；
- `observer-setup.ts` 在 `required=false` 且 `startObserverServer` 失败时返回 `observer: undefined`，但 serve 继续、transport 仍上报 URL。
- 影响：orchestrator 登记一个不可达 URL；UI 503/504；任务本身不受影响。
- 建议：只有 `setup.observer !== undefined` 时才设置 `observabilityUrl`；或启动失败时清空/不发送；补“端口冲突 + required=false”用例。
- 证据：`serve-compose.ts`、`observer-setup.ts`。

## 4 P2 一致性/边界

| 项 | 现状 | 影响/建议 |
|---|---|---|
| raw 不检查 `goneAt` | **已修**：raw/session/events 检查 `goneAt` 与 `archive.isGone`，返回 410 | 已补 prune 后 raw/session 用例 |
| 清理活跃 run 保护不全 | `observer-setup.ts` 只用 `status=running` 的 attempt 生成 `activeRunIds` | `waiting_confirm` 等无 running attempt 的活跃 run 可能在 30 天后被 tombstone；建议 run 侧提供活跃集合或把非终态 run 纳入保护 |
| session prune 无 tombstone | **已修**：保留 `gone` 文件，raw/session/events 410 | 已补 prune 后 410 用例 |
| 文件列表截断顺序 | `WorkspaceFileReader.list` 读 `limit+1` 后排序再切 | 目录条目 >2000 时，被截掉的条目不一定在排序后应被截掉；UI 只显示 truncated，不阻塞 |
| `maxStreams`/慢消费者 | `sessionStream` 有 pending 逻辑；`attemptStream` 用 `createWriter` | 逻辑存在；建议补真实慢消费者压测 |

## 5 已确认不阻塞

- `CF-19`：16.5s 长 SSE 未提前关闭、heartbeat 1；`idleTimeout:30`。
- `CF-04`：O-05 `Last-Event-ID=1` 补 `seq=[2,3]`。
- `CF-03`：run tombstone 410。
- `CF-07`：`Accept-Ranges: bytes`（Range 切片可选）。
- `CF-08`：recorder 写 `sessions/<id>/meta.json`。
- `CF-13`：ended snapshot+end。
- `runId` 接入：`wire.ts` 解析 `runId`；`executor.ts` 在 `#prepareTask` upsert run 注册表；orchestrator 侧 `TaskRequest.runId` 已下发。
- 运行中 session：client O-02 可按 run/node/task 返回 sessionId；orchestrator 已用其反查，真实 `serve` + fake ACP 联调中产品 session/O-11 均 200。
- hardening 的 raw/session `gone` 410、SSE cancel 清理、启动失败不广告 URL 均已由代码/测试核实。
- 文件路径：`WorkspaceFileReader` 对 `..`/绝对路径/符号链接逃逸有校验；read 拒绝 symlink。

## 6 建议顺序

1. client 门禁已绿；pin `v1.2` / `e0946f4`。
2. client P1 已由 hardening 修复；补 `waiting_confirm` 活跃 run 保护（P2）。
3. orchestrator：按 v1.2 复跑已完成；继续 UI BFF/场景/真实 DSH。
4. UI：BFF 流式 + Tab；之后做真实 `confirm` run 端到端。
