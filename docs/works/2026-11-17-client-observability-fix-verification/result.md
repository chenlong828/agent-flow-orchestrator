---
layer: works
module: global
status: closed
updated: 2026-11-17
procedure: 2026-11-17-client-observability-fix-verification
level: P2
---

# 结果：client 观测面修复复验

## 1 结论

client `client-fix-response.md` 的 P0/P1 修复基本成立，**key 项全部通过真实 HTTP 复验**：`CF-19` 长 SSE 16.5s 保持连接并收到 heartbeat；`CF-04` `Last-Event-ID=1` 只补 `seq=2,3`；`CF-03` run tombstone 返回 `410 run_gone`；`CF-07` raw 带 `Accept-Ranges: bytes`；`CF-08` recorder 落 `sessions/<id>/meta.json`；`CF-13` 已结束 attempt 先 snapshot 再 end；health `startedAt`/`uptimeMs` 为真实值。

残余：`CF-09` `degraded` 仍固定 `ok`；`CF-07` 未实现 Range 切片（契约标可选）；`CF-15` 大目录提前停止未做；`CF-02` 清理为每小时执行、首次启动不立即清。均不阻塞 orchestrator 对接，转 client 后续。

## 2 复验证据

### 2.1 client 测试/类型

- `bun test`（client）：**168 pass / 1 fail**；唯一失败仍是无关的 `tests/components/cli/signals.test.ts` UC-14（等待 `child.pid` 超时，单独复跑仍失败）。
- `bun run typecheck`、`bun run docs:check`：通过。
- client 反馈写 169 pass；本机为 168/169，差异在 signals 用例，不影响观测面结论。

### 2.2 真实 HTTP 探针

`probe/reverify.ts` 输出（`probe-output.txt`）：

```json
{
  "health": {"uptimeMs": 23, "startedAt": "2026-11-17T13:56:35.031Z", "status": "ok"},
  "lastEventId": {"status": 200, "seqs": [2, 3], "truncatedBefore": null},
  "runGone": {"status": 410, "body": {"error": {"code": "run_gone", "message": "run 已按保留策略清理"}}},
  "raw": {"status": 200, "acceptRanges": "bytes", "checksum": "485e67..."},
  "longSse": {"closedEarly": false, "heartbeat": 1, "bytes": 385},
  "ended": {"hasSnapshot": true, "hasEnd": true},
  "sessionMeta": {
    "sessionId": "s2", "attemptId": "...", "instanceId": "i2", "nodeId": "n4",
    "runId": "run-2", "taskId": "t2", "cwd": "/ws", "status": "completed",
    "eventCount": 3, "archive": {"status": "pending", "sizeBytes": null, "sha256": null}
  }
}
```

- `longSse` 在 16.5s 窗口内未提前关闭，收到 1 次 heartbeat；若 `idleTimeout` 仍为 10s 会在 10s 被切断，故 `CF-19` 通过。
- `lastEventId` 的 `seqs=[2,3]` 证明 `Last-Event-ID=1` 生效；`truncatedBefore` 字段存在。
- `runGone` 410、`raw acceptRanges=bytes`、`sessionMeta` 文件存在均直接验证。

### 2.3 orchestrator 适配器回归

`docs/works/2026-11-17-client-observability-integration/probe/adapter-real.ts` 在修复后的 client 上通过：

```json
{"files":["a.md"],"content":"# hi\n","session":{"status":"running","eventCount":1},"events":1,"raw":{"sizeBytes":11,"sha256":"485e67...","hasEtag":true},"sse":{"hasSnapshot":true,"leaksSessionId":false,"leaksAttemptId":false}}
```

orchestrator 门禁此前为 `bun run check` **416 pass / 0 fail**、quality **0 违规**；client 修复未改 orchestrator 代码。

## 3 CF 矩阵

| ID | 状态 | 证据 |
|---|---|---|
| `CF-01` SSE abort | 已修/通过 | 长 SSE 无异常；client 新增 abort 测试 |
| `CF-02` 保留/上限 | 已修（基础） | `prune` 实现 + run prune 测试；attempt/session 清理为代码/每小时，未做长周期实测 |
| `CF-03` run 404/410 | 通过 | 真实 410 `run_gone` |
| `CF-04` Last-Event-ID | 通过（O-05） | 真实 seq `[2,3]`；O-11 代码同路径 |
| `CF-05` snapshot truncatedBefore | 通过 | 字段存在；旧 probe 复跑为 true |
| `CF-06` 慢消费者 | 已修（静态） | `desiredSize<=0` pending >1000 关闭；未做真实慢消费者压测 |
| `CF-07` raw Range | 部分 | `Accept-Ranges: bytes` 已加；未实现 Range 切片（契约可选） |
| `CF-08` session meta | 通过 | recorder 后 `meta.json` 存在且字段完整 |
| `CF-09` health | 部分 | 真实 startedAt/uptime、计数不截断；`degraded` 仍固定 `ok` |
| `CF-10` logRange.firstSeq | 已修（静态） | 从首事件计算；无截断时 1 |
| `CF-11` 文件限制 | 已确认 | 保留 2000/1 MiB；契约写明 |
| `CF-12` 2 MiB/5s | 已澄清 | 归适配器/BFF，不在 client |
| `CF-13` ended snapshot | 通过 | 真实 snapshot + end |
| `CF-14` session.closed | 已修（静态） | recorder.settle close 前 publish |
| `CF-15` 大目录提前停止 | 未做 | 仍全量 readdir+lstat |
| `CF-16` raw sha 复用 | 已修（静态） | meta size/sha 优先 |
| `CF-17` auth 开关 | 维持 | token 语义：非空 Bearer，空仅 loopback |
| `CF-18` attempt 重复 | 维持 | 非缺陷；orchestrator 不代理 |
| `CF-19` SSE idle 超时 | 通过 | 16.5s 长 SSE heartbeat 1、未提前关闭 |

## 4 未完成 / 残余

| 项 | 影响 | 去向 |
|---|---|---|
| `CF-09` degraded | health 不能反映写盘持续失败 | client 后续 |
| `CF-07` Range 切片 | 大文件断点续传不可用；`Accept-Ranges` 已声明，客户端若发 Range 会得到 200 全量 | client 后续/契约注明 |
| `CF-15` 大目录性能 | `readdir` 全量 + 逐项 `lstat` | client 后续 |
| `CF-02` 清理时机 | 每小时执行，首次启动不立即清 | client 后续 |
| `signals.test.ts` UC-14 | client 全量非全绿；与观测面无关 | client 排查 |
| client 工作区未提交 | 复验对象为工作区快照 | client 提交后按 commit 再验证 |
| UI BFF 流式 | O-11/raw 的 UI 实时消费仍需 BFF 改造 | UI 项目 |

## 5 结论落点

- 原 `client-fix-list.md` 的 P0/P1 项已可标为核实；`CF-09`/`CF-07`/`CF-15` 保留残余。
- orchestrator 对接可继续使用当前 client 修复版本；O-11 长 SSE 已验证 16.5s。
- 下一步仍是 client 提交、UI BFF/文件 Tab、`SCN-0305`/`SCN-0303` 场景登记与端到端 run。
