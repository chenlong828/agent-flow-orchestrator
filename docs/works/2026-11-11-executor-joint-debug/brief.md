---
layer: works
module: global
status: active
updated: 2026-11-11
procedure: 2026-11-11-executor-joint-debug
level: P2
---

# 工序：节点登记 × `agent-flow-client` 联调（计划）

> 2026-11-11 更新：执行面三端点已于 `92135de` 实现，本文件的「前置未满足」判断已过期；实测结果见 [`result.md`](result.md)。

## 1 结论：可以联调，但分两层

**可以，但不是写计划时就能跑完整链路。** 两边的接口边界是：

- `agent-flow-client` 只调执行面三端点：`POST /api/v1/executor/poll`、`POST /api/v1/executor/tasks/{taskId}/result`、`GET /api/v1/executor/skill-packages/{packageId}`；
- 本仓库已实现的 Harness 接口（`API-01`–`API-07`、`API-41`）是**管理面**，client 不会调用；两边的连接点只有一个：`API-41` 登记的 `clientId` + token，client 用同一枚 token 去调执行面三端点；
- 执行面三端点（`EXE-01`–`EXE-03`）已于 `92135de` 实现（`CMP-scheduler`/`CMP-instance` 转 `active`），写计划时仍为 `planned`；实测见 [`result.md`](result.md)。

现状基线（2026-11-11 实测，`3100` 端口）：

| 探测 | 结果 | 含义 |
|---|---|---|
| `POST /api/v1/executor/poll`（`X-Executor-Protocol: 2` + Bearer） | `400 validation_error`，`details.field=id` | 路由把 `poll` 当资源 id 校验；执行面路由还不存在 |
| `GET /api/v1/executor/skill-packages/foo` | `400 validation_error` | 同上 |
| client 对 400 的映射 | `unsupported_protocol` → **terminal，退出** | 联调时不能把 400 当「凭据/契约问题」，它只是「端点未实现」 |
| `PATCH /api/v1/harnesses/{id}/client`（`API-41`） | 200，详情回读 `clientId`/`clientToken` | 节点登记可用（2026-11-10 已实现） |
| `ExecutorAuthenticator.resolveClientId` | 已实现并有测试（295 pass） | 凭据解析这一环可用，但还没有执行面消费者 |

所以本工序分三段：**P0 连通性基线（现在可做）→ P1 前置实现（被 P1 设计门挡住）→ P2 真实执行联调**。

## 2 前置条件与门

| 条件 | 状态 | 说明 |
|---|---|---|
| 调度层实现与收口 | 已实现（`92135de`） | `EXE-01`–`EXE-03` 已可用；P1 收口的用户确认仍待（见 `2026-11-11-scheduler-layer-implementation/result.md` §5） |
| 任务注入通道 | 临时接缝 | 无对外启动端点（`OQ-22`）；联调用 [`tools/jd.ts`](tools/jd.ts) 直接调 `SchedulerService.enqueue` |
| client 仓库可运行 | 满足 | `bun install` 后可跑 `serve`/`doctor`；DSH 用 `DSH_BIN=/Users/chenlong/agent/deepseek-harness/apps/cli/lib/bin.js`（node v26.8.1；本机无 PATH `dsh`） |
| 模型端点与凭据 | 需用户提供 | client 通过环境变量读取（`AF_LLM_BASE_URL`、`AF_MODEL` 等）；凭据只进本地环境，不进仓库 |
| 本仓库服务 | 满足 | `3100`（`config/local.toml`），`/healthz` 与 `/openapi.yaml` 已验证 |

## 3 阶段与任务

### P0 连通性基线（现在可做，不改代码）

目的：把「地址、协议头、token、登记」四件事先对齐，避免真联调时把环境问题误判成契约问题。

1. `API-41` 登记一个联调节点：`clientId=joint-debug-01`、token 用一次性随机值（只在本机终端传递，不写文档/日志）。
2. 用 curl 打三个执行面端点，记录当前返回（预期 `400`/`404`），写入本工序 result。
3. 在 client 仓库建 `.config`（loopback 地址 + 同一 token + `max_concurrent`），跑 `doctor`：确认配置校验通过、`scheduler.url`/`scheduler.token` 两项为 pass；**不启动 `serve`**（会因 400 直接退出，没有信息增量）。
4. 产出：联调基线记录（含「400 会被 client 判为 `unsupported_protocol`」这一注意事项）。

### P1 前置实现（已完成，`92135de`）

按调度层设计实现执行面最小闭环，联调只依赖其中一部分：

- `EXE-01` poll（`S-01`–`S-04`，含 `pollHoldMs`、`maxTasksPerPoll`、`capacity.free` 截断）；
- `EXE-02` 结果回收（`S-05`、`S-06`，首份结果为准、`accepted=false`、未知 `taskId` 404 `task_not_found`）；
- `EXE-03` 技能包供给（`P-03`，`ETag`/304/`X-Checksum-Sha256`）；
- 鉴权走 `ExecutorAuthenticator`（本次已落），`401` 只用于未知/已解绑 token；
- 任务注入：`SchedulerService.enqueue` 需要一个本地入口（见 `OQ-24`）；联调期优先用**开发脚本直接调服务**，不加对外端点。

### P2 真实执行联调（依赖 P1）

启动顺序：PostgreSQL → orchaster `3100` → client `serve`；每轮先确认 `/healthz` 与 `/openapi.yaml` 是本次版本。

## 4 用例矩阵

| ID | 场景 | 期望 | 观测点 |
|---|---|---|---|
| `T-JD-01` | 未登记 token 调 `EXE-01` | `401 unauthorized`，client `serve` 终止退出（非 0） | client 退出码与日志 `event=gateway.*` |
| `T-JD-02` | 已登记、节点 `enabled`、实例 `active`、队列有 1 个任务 | poll 返回该任务；`taskId`/`instanceId`/`workspacePath`/`skillSet.digest` 与注入值一致 | orchaster 侧任务状态 `queued→dispatched`；client `state/journal.jsonl` |
| `T-JD-03` | 节点 `enabled=false`（token 仍有效） | 鉴权通过、空批、不派发、不消耗 `attempt`；不返回 `401` | response `tasks=[]`、`stop=false`；任务仍 `queued` |
| `T-JD-04` | 任务执行完成并回报 | 首份结果 `accepted=true`，任务 `done`；同 `taskId` 再回报 `accepted=false` | orchaster 结果与 `attempt`；client 日志 |
| `T-JD-05` | `stop=true` 下发 | client 收口在跑任务后退出；orchaster 不再派发 | client 退出码 0；任务结算状态 |
| `T-JD-06` | `cancelInstances` 含在跑实例 | client 停止该实例的会话，实例转 `blocked`/任务结算失败（按实例规格） | client `cancelInstances` 日志；实例状态 |
| `T-JD-07` | `P-03` 下载技能包（带 `If-None-Match`） | 200 带 `X-Checksum-Sha256`；二次请求 304；旧 `packageId` 404 | client 包缓存目录与摘要 |
| `T-JD-08` | 协议头缺失/错误 | `400 unsupported_protocol`（与 `validation_error` 区分靠 `code`，`OQ-13` 仍待定） | 响应 `error.code` |

每轮联调结束记录： orchaster 端 DB 任务状态、client `state/logs/client.jsonl` 与 `state/journal.jsonl` 的关键行、退出码。

## 5 环境与配置样例

client `.config`（TOML，放 client 仓库运行目录，不提交）：

```toml
[acp]
dsh_home = "AF_DSH_HOME"        # 不能指向 ~/.dsh
[state]
root = ".state-joint-debug"
[scheduler]
url = "http://127.0.0.1:3100"   # loopback 允许 http
token = "<API-41 登记时使用的 token>"
[capacity]
max_concurrent = 2
```

启动：

```bash
# orchaster
export PATH="$PWD/.local/bun:$PATH" && bun run start

# client
cd ../agent-flow-client
DSH_BIN=/Users/chenlong/agent/deepseek-harness/apps/cli/lib/bin.js \
AF_NODE_BIN=node \
AF_LLM_BASE_URL=<用户提供> AF_MODEL=<用户提供> \
bun run src/cli.ts serve --config .config --log-level debug
```

任务注入（P1 后）：用 `docs/works/<调度层实现工序>/` 下的开发脚本直接调 `SchedulerService.enqueue`，`workspacePath` 提前建好（与实例登记口径一致）。

## 6 验收标准

1. `T-JD-01`–`T-JD-08` 全部有断言与结论；失败项附日志片段与定位（不改断言迁就实现）。
2. 每次联调前后 `bun run check` 与 `quality:gate` 通过（本仓库）；client 侧跑其自身 `bun test`。
3. 结论落点：`result.md` 记录每条用例的通过/失败、偏差分级（阻塞/待定/已修）与未覆盖项。
4. 不把联调脚本、token、模型端点凭据提交进任一仓库。

## 7 不做什么

- 不恢复 client 自注册/心跳/租约（契约 v2 已删除，本仓库不新增该面）。
- 不改 `executor-http-v2`；契约偏差先记 `open-questions.md`。
- 不改 client 仓库代码；client 侧缺陷只记录，另立 client 工序修复。
- 不做任务启动正式端点/UI（`OQ-22`）；P1 只用开发脚本注入。
- 不做多 client 并发、优先级队列、`concurrency_max` 强制限流（超出最小联调）。

## 8 风险与待定

| 风险 | 影响 | 处理 |
|---|---|---|
| 执行面三端点 | ~~未实现~~ 已实现（`92135de`）；联调按 `result.md` 实测执行 | `T-JD-02` 完成 |
| 任务注入无正式入口（`OQ-22`/`OQ-24`） | 联调必须依赖开发脚本 | 本轮不新增端点；脚本放工序目录 |
| 模型端点与凭据 | 真实执行需要可用 LLM 端点与额度，凭据不能入库 | 由用户在本机环境提供；联调用最小 prompt |
| DSH 入口不在 PATH | client `serve` 起不来 | 用 `DSH_BIN` 指向本机构建；版本 `0.2.2-alpha.2` |
| `400` 语义歧义（`OQ-13`） | 协议不匹配与请求非法都用 400，client 一律判 `unsupported_protocol` | 联调期以 `error.code` 判别；契约修订另议 |
| 节点/实例联动 | 派发还要求实例 `active` 且绑定同一 `clientId`；实例登记尚无 HTTP 面 | P1 里用开发脚本或直接写库准备实例 |

## 9 任务表

| ID | 类型 | 范围 | 状态 | 出口 |
|---|---|---|---|---|
| `T-JD-01` | verify | 连通性基线：API-41 登记 + 三端点探测 + client `doctor` | 完成 | 见 `result.md` §2 |
| `T-JD-02` | change | 执行面三端点 + 任务注入脚本 | 完成（`92135de` + `tools/jd.ts`） | `EXE-01`–`EXE-03` 可用，执行面场景测试通过 |
| `T-JD-03` | verify | `T-JD-01`–`T-JD-08` 真实联调 | 部分完成 | `result.md` §2：7 通过、`T-JD-05` 无外部触发面 |
| `T-JD-04` | docs | 联调报告与偏差清单 | 完成 | `result.md`；`OQ-25` 记录 stop 触发面 |
