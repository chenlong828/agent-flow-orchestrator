---
layer: works
module: global
status: active
updated: 2026-11-10
---

# 交付说明：执行面契约 v2

## 1. 交付物

| 文件 | 内容 |
|---|---|
| 契约正文（现移至 [`design/contracts/executor-http-v2.md`](../../../design/contracts/executor-http-v2.md)） | 3 个端点、5 个类型、调度器 8 条职责、client 9 条承诺、失败矩阵、验收 |
| 本文件 | 交付说明：改了什么、client 怎么改、怎么验收 |

## 2. 一句话

**7 个端点 → 3 个；20 条 `SCH` → 8 条；13 条 `CLT` → 9 条；1,105 行 → 455 行。**

## 3. 三个端点

| ID | 端点 | 承担的事 |
|---|---|---|
| `P-01` | `POST /api/v1/executor/poll` | 取任务 + 上报 `running`/`finished` + 收 `stop`/`cancelInstances`；**常驻长轮询，兼判活** |
| `P-02` | `POST /api/v1/executor/tasks/{taskId}/result` | 交结果，`accepted` 确认 |
| `P-03` | `GET /api/v1/executor/skill-packages/{packageId}` | 取技能包 |

没有 `register`、`heartbeat`、`claim`、`renew`、`bindSession`、`cleanup`。

## 4. 四个关键设计选择

**① 判活由 poll 自带，不设心跳端点。**
client 常驻一条 poll 长轮询：没空位时它只上报 `running`，服务端挂起 30s 返回空批。连接在 = 活着，不需要客户端租约、`serverTime`、时钟容忍。

**② 控制用「电平信号」而不是「事件流」。**
`stop` / `cancelInstances` 每次都随 poll 响应下发，直到 client 的 `running` 不再包含对应任务。丢一次下一跳还带，因此不需要 `seq`、`ackSeq`、补发、`issuedAt` 作用域。`pause`/`resume` 消失——调度器不下发就是暂停。

**③ 用「未确认重发」代替幂等键。**
`S-03`：派出去的 `taskId` 既不在 client 的 `running[]`、也不在 `finished[]`、也没有回报 → 下一跳重发同一 `taskId`。响应丢失自然收敛，不需要 `claimRequestId`。

`finished[]` 是这套机制的关键补丁：如果没有它，「结果已算出、上报响应丢了」会被判成「没收到」→ 重发 → 重复执行。加上它，重复执行只发生在真正的崩溃/失联，而不是每次网络抖动。

**④ 重派就是重试，不设租约。**
`S-02`：`dispatched` 未回报，且「超过 `timeoutMs + 60s`」或「client 静默 120s」→ 回 `queued`，`attempt + 1`。同一 `taskId` 重派时 prompt/技能集/工作区不变（`S-05`），所以重跑能认出去哪、看什么痕迹。

## 5. 明确放弃的保证

| 放弃 | 代价 | 兜底 |
|---|---|---|
| exactly-once | 极端情况同一任务跑两次，浪费 token | `S-08` 首份结果为准 |
| 控制指令有序 / 至少一次 / 断连补发 | 停止延迟最多一个 poll 周期 | `S-07` 电平持续下发 |
| 崩溃后清理意图补偿 | 容器/目录要运维回收 | 工作区默认保留 |
| 迟到结果审计 | 无 | `accepted=false` |
| 单实例单写者 | 偶发 last-write-wins | skill 按模块拆分 + 工具写前重读 |

## 6. client 改造清单（按现有文件）

| 文件 | 动作 |
|---|---|
| `gateway/state.ts` | **整文件删除**：`ClaimIdempotency`、`ControlSeq`、`IdempotencyCache`、`CleanupAckQueue` |
| `gateway/gateway.ts` | 删 5 个方法，实现 `poll`/`report`/`package`；删租约计时、`run_superseded` 处理 |
| `gateway/wire.ts`、`errors.ts` | 按 §5 重写类型；HTTP 错误码从 15 个降到 6 个 |
| `executor/ports.ts` | `SchedulerPort` → `poll`/`reportResult`/`downloadPackage`；删 7 个值类型 |
| `executor/executor.ts` | 删 `reconcileCleanup`、技能集冲突守卫；状态机 7 态 → 3 态 |
| `cli/serve-loops.ts` | 心跳循环 + 领取循环**合并成一条 poll 循环**；删 `run_superseded`/`pause`/`cleanupAcks` |
| `cli/serve-events.ts` | 删对账逻辑；`stop`/`cancelInstances` 按 `C-07` |
| `cli/serve.ts`、`serve-context.ts` | 删退出码 7、`assignmentsVersion`、`pausedInstances`；`buildState` → `buildPollRequest` |
| `cli/local-scheduler.ts` | 按新端口适配 `run` 模式 |
| `store/` | 保留 in-flight + 结果表；删 journal 多态与压缩；孤儿记录可简化 |
| `assets/` | 技能集来源从 `bindSession` 改为 `TaskRequest.skillSet`；保留 digest 短路与原子替换；删冲突守卫 |
| `result/` | 保留组装/截断/分类；删 `retryable` |
| `docs/design/contracts/executor-http-v1.md` | 归档到 `docs/history/`，换 v2 |

## 7. 验收（桩调度器 + client 门禁）

桩调度器最小面 8 条、client 门禁 6 条，见契约 §10。其中三条是这次简化的核心证明：

1. **不重复**：`finished[]` 有记录时，`S-03` 不得重发；
2. **不卡死**：client 停止 poll 120s 后任务回队重派；任务超 `timeoutMs + 60s` 回队；
3. **吞吐**：1000 个任务同一技能集只装一次，其余走 digest 短路。

## 8. 需要 client 侧确认的两点

1. `maxConcurrent` 默认值（建议 2–4，按机器核数）；
2. `idle_timeout` 默认关闭是否接受（避免误杀长工具调用；如需开启，阈值按任务类型约定）。

## 9. 时序上的一个说明

调度器侧对该契约的实现为零（2026-11-10 核实），所以这次是**纯文档替换**，没有数据迁移、没有线上兼容期。client 侧已有 5,531 行实现，改造代价集中在 `gateway/`（约一半代码）与 `cli/` 的两个循环合并；`runtime/`、`workspace/`、`result/` 基本不动。
