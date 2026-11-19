---
layer: works
module: global
status: closed
updated: 2026-11-17
procedure: 2026-11-17-client-observability-verification
level: P2
---

# 评审：client 观测面 v1 契约验证（P2）

## 结论

**通过（有条件）**。核心文件/会话路径可用，blocker 0；条件为 orchestrator v1 只消费 `O-06`–`O-10`，`O-04`/`O-05`/`O-11` 先不代理；§Hold 项转 client 后续修复，不阻塞本轮对接。

## Blocker

无。文件浏览/会话浏览的 200、鉴权 401/200、文件路径逃逸、raw 403/409、O-11 503 均有真实 HTTP 或单元测试证据。

## Decision now

| 决策 | 内容 | 落点 |
|---|---|---|
| `D-01` | 文件限制按 client 契约 v1（2000/1 MiB；2 MiB/5s 由适配器/BFF 侧体现）先跑；要 no-limits 另立 client 改动 | `result.md` §4；集成 brief |
| `D-02` | orchestrator 只消费 `O-06`–`O-10`；`O-02`/`O-03` 薄用；`O-04`/`O-05`/`O-11` 不代理 | 集成 brief |
| `D-03` | 鉴权接受「token 空 = 本地不鉴权，非 loopback 无 token 拒绝」；显式 `auth` 开关后置 | `result.md` §4 |

## Hold

| 项 | 不阻塞理由 | 去向 |
|---|---|---|
| `Last-Event-ID` 未实现（O-05/O-11） | 首帧 snapshot 可用；重连只重复数据 | client 后续 |
| snapshot 缺 `truncatedBefore` | 当前会话未触发保留截断 | client 后续 |
| SSE abort `Controller already closed` | 只在取消/断开路径；不损坏已返回数据 | client 后续 |
| SSE 慢消费者队列缺失 | 受 `maxStreams=20` 限制，短期风险可控 | client 后续 |
| raw 缺 `Accept-Ranges` | 下载可用；断点续传不可用 | client 后续 |
| `run_gone` 实为 404 | 404 也能表达不存在；只是无法区分过期 | client 后续 |
| `sessions/meta.json` 未落盘 | O-06 从 attempt 推导，接口可用 | client 后续或修订契约 |
| 保留/上限未执行 | v1 数据量小；先观察 | client 后续 |
| health 字段占位/计数截断 | 不影响接口调用；运维判断需修正 | client 后续 |
| `logRange.firstSeq` 恒 1 | 当前无保留截断 | client 后续 |

## Verified sound

| 项 | 查了什么 | 结论 |
|---|---|---|
| 基础端点 | handler + 真实 HTTP：health/attempt/files/content/session/raw/auth/SSE snapshot | 全部可达；状态码符合 |
| 文件 | 4 条 files 单测 + 探针 | 目录优先、文本/二进制、路径逃逸、1 MiB 截断符合 |
| attempt/session 存储 | attempt-store 2 条 + recorder/mapper | create/append/update/list/session 过滤/预览映射符合 |
| run 注册表 | 4 条 runs 单测 | upsert/重建/prune/非法 runId 符合 |
| 鉴权 | 401/200 真实 HTTP | token 有/无行为符合 |
| 测试基线 | `bun test` 全量 166/167 | observer 相关 20/20；唯一失败是无关 signals 用例 |

## 未验证

- 真实 `serve` + DSH 任务链路的观测面联调；本次只验证 observer HTTP 与 handler。
- `O-05`/`O-11` 的断线续传、慢消费者、长会话压力。
- 文件 2 MiB/5s 的上限行为（client 未实现，需适配器/BFF 侧测）。

## 备注

client 工作区当前未提交；验证对象是该工作区快照，不是某个 commit。`signals.test.ts` 的失败单独复跑仍存在，需 client 侧排查，不计入观测面结论。
