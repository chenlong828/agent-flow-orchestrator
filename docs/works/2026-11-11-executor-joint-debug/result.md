---
layer: works
module: global
status: active
updated: 2026-11-11
procedure: 2026-11-11-executor-joint-debug
---

# 结果：节点登记 × `agent-flow-client` 联调（当前版本实测）

> 被测版本：本仓库 `92135de`（执行面调度层已实现）、client 仓库 `4c8f8b0`。
> 本机 `3100` 端口服务（本次启动的进程），PostgreSQL `54329`，开发库已迁移并灌种子。

## 1 结论

**当前版本能跑通真实执行链路。** 从「`API-41` 登记节点」到「client 取任务、执行、回报、结算」全程走通：client 用登记时的 token 长轮询到任务，调用 DSH 执行后回报 `succeeded`，调度器结算 `done/outcome=succeeded`。

上一轮计划里「执行面三端点未实现、只能做连通性基线」的判断已被 2026-11-11 的调度层实现推翻，本文件按实测重写。

## 2 用例结果

| ID | 场景 | 结果 | 证据 |
|---|---|---|---|
| `T-JD-01` | 未登记/解绑后的 token 调执行面 | **通过** | 伪造 token → `401 unauthorized`；解绑后原 token → `401`（`details` 不含 token）；client 用错误 token `serve` → **退出码 3**（`auth`） |
| `T-JD-02` | 已登记节点 + active 实例 + 队列有任务 | **通过（含真实执行）** | `enqueue` 后 poll 返回 1 个任务，`taskId`/`instanceId`/`workspacePath=/tmp/jd/ws-1`/`nodeId`/`attempt=1` 与注入一致；client 日志 `task.received` → `task.reported status=succeeded`，结果 `message="OK"`、`stopReason=end_turn`；调度器 `state=done/outcome=succeeded` |
| `T-JD-03` | 节点 `enabled=false`（token 仍有效） | **通过** | `API-05` 停用后 poll 返回 `tasks=[]`、`stop=false`，任务仍 `queued`、`attempt` 未变；重新启用后同一任务被派发（`attempt=1`） |
| `T-JD-04` | 首份结果与重复回报 | **通过** | 首份 `200 {"accepted":true}`；重复同 `taskId` 回报 `{"accepted":false}`；未知 `taskId` → `404 task_not_found` |
| `T-JD-05` | `stop=true` 下发 | **不可从外部触发** | `requestStop` 只作用于进程内 presence；没有 HTTP/管理端点能触发。当前只能由自动测试覆盖（`tests/components/scheduler`）。client 侧 `stop` 处理逻辑存在，但本次无法端到端验证 |
| `T-JD-06` | `cancelInstances` | **通过** | 派发后调 `cancelInstances(instanceId)`：下一次 poll 返回该实例，client 侧会调 `cancelInstance`；回报 `cancelled` 后任务 `done/outcome=cancelled`，再 poll `cancelInstances=[]` |
| `T-JD-07` | `P-03` 技能包下载 | **通过** | `200` + `ETag: "sha256-…"` + `x-checksum-sha256: 5c966a…` + `application/zip`（999 字节）；带 `If-None-Match` → `304`；不存在的 `packageId` → `404 package_not_found` |
| `T-JD-08` | 协议闸门 | **通过** | 缺 `X-Executor-Protocol` → `400 unsupported_protocol`（`actual=null`）；值 `1` → 同码（`actual="1"`） |
| 追加：未回报回队 | `S-02` + `taskMaxAttempts` | **通过** | `timeoutMs=5000` 的任务派发后不回报，约 65s（`timeout + resultGraceMs`）后再次 poll 收到同一 `taskId`、`attempt=2` |
| 追加：派生节点状态 | `harness` §3.3 | **通过** | client `serve` 轮询后，`GET /harnesses/{id}` 返回 `health=online`、`lastHeartbeatAt` 为最近 poll 时间（此前为 `unknown`） |

## 3 关键观测

- **长轮询**：空队列时 `POST /executor/poll` 会挂起到 `pollHoldMs`（默认 30s），curl 需给足超时；这解释了「空批立刻返回」与「空批挂起」两种观察的差异——前者是刚上报结果/取消后命中唤醒，后者是正常长轮询。
- **结果与 `attempt`**：回队重派复用同一 `taskId`，`attempt` 递增；client 以 `taskId` 去重，重复任务不会重启执行。
- **client 退出码**：鉴权失败为 `3`（`auth`），不是通用错误码；联调脚本要按退出码判定。
- **环境陷阱**：client 的 `dsh_home` 校验会读环境变量 `DSH_HOME`（本机全局指向 `~/.dsh`），必须显式覆盖为可写目录；`AF_NODE_BIN` 必须是绝对路径，否则 `doctor` 的 `dsh.binary` 检查会失败。
- **client 侧既有偏差**：`doctor` 的 `scheduler.connectivity` 仍是 `none`（S0 占位），实际 `serve` 已能连调度器；属 client 仓库待办，本仓库只记录。
- **真实执行**：client 用 S0 默认模型路由（`hundsun-public/hs-deepseek-flash-latest`）完成一次 `message="OK"` 的执行；凭据由 client 侧环境提供，未写入本仓库。

## 4 复跑命令

```bash
# 1) 本仓库服务（3100）
export PATH="$PWD/.local/bun:$PATH" && bun run start

# 2) 登记节点与凭据（token 自取，不要写进文档）
curl -sS -X POST http://127.0.0.1:3100/api/v1/harnesses -H 'content-type: application/json' \
  -d '{"name":"joint-debug-01","kind":"server","address":"127.0.0.1:jd","accessMode":"agent","concurrencyMax":4,"queuePolicy":"fifo","tags":["joint-debug"]}'
curl -sS -X PATCH http://127.0.0.1:3100/api/v1/harnesses/<id>/client -H 'if-match: "1"' \
  -H 'content-type: application/json' -d '{"clientId":"joint-debug-client-01","token":"<随机 token>"}'

# 3) 登记实例与入队（联调临时工具）
bun run docs/works/2026-11-11-executor-joint-debug/tools/jd.ts enroll <instanceId> joint-debug-client-01 /tmp/jd/ws-1
bun run docs/works/2026-11-11-executor-joint-debug/tools/jd.ts enqueue <instanceId> jd-node-01 45000 '只回复 OK'

# 4) client
cd ../agent-flow-client
DSH_HOME=/tmp/jd/dsh-home \
DSH_BIN=/Users/chenlong/agent/deepseek-harness/apps/cli/lib/bin.js \
AF_NODE_BIN=$(which node) \
~/.bun/bin/bun run src/cli.ts serve --config /tmp/jd/client.config --log-level debug
```

## 5 联调中发现并修复

1. **presence 时间戳用了系统时钟**：`presence.ts` 用 `new Date()`，而调度器其余部分用注入的 `Clock`。后果是 `TC-EXR-005`（静默回队）只在「真实时间距测试基准时间 < 2 分钟」时通过，过点必红；生产用 `systemClock` 时行为不变。已改为把 `Clock` 注入 `createPresenceTracker`，`bun test tests/components/scheduler` 16 例稳定通过。
2. **空批长轮询的实测口径**：空队列时 `POST /executor/poll` 恰好挂起 `pollHoldMs=30s` 后返回 200（实测 `total=30.008s`）。同一 `clientId` 的 poll 走 `singleFlight` 串行；被中断的请求仍占满自己的 30s 槽位，所以「反复用同一个 clientId 打超时 curl」会看到越来越长的等待（我实测累计到 100s+），换新 `clientId` 立即恢复 30s。生产 client 的超时是 40s > 30s，不会主动中断，但被强杀的 client 重连时可能等一个周期。
3. **`doctor.scheduler.connectivity` 仍是 `none`**（client 侧 S0 占位）：不能作为联调门禁，实际 `serve` 轮询正常。

## 6 未覆盖与待办

| 项 | 原因 | 去向 |
|---|---|---|
| `stop=true` 端到端 | 没有外部触发面（`requestStop` 仅进程内） | 需要任务启动/运维控制端点时一并设计（`OQ-22`）；当前由自动测试覆盖 |
| 多 client 并发、优先级队列 | 超出本轮最小联调 | `plan/open-questions.md` 既有条目 |
| `concurrency_max` 参与派发 | 契约 §9 规定容量只由 `free` 表达 | 不实现；仅展示 |
| `doctor` 连通性检查 | client 侧未实现（S0 占位） | client 仓库待办 |
| 结构化的联调自动化 | 本轮为交互式实测 | 若需回归，另立脚本化用例（可用 `tools/jd.ts` 扩展） |

## 7 数据清理

- 联调使用演示库：Harness `joint-debug-01`、实例 `0191f2f0-0000-7000-8000-000000000101`、5 个 `task` 记录保留作证据；token 只存在于 `/tmp/jd/token`（权限 600），需要轮换用 `API-41`。
- client 侧状态在 `/tmp/jd/`，未写入两个仓库；`git status` 均为干净（client 仅新增本机 `/tmp` 文件）。
