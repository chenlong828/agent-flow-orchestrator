---
layer: works
module: global
status: closed
updated: 2026-11-17
procedure: 2026-11-17-client-observability-fix-verification
level: P2
---

# 评审：client 观测面修复复验（P2）

## 结论

**通过**。P0/P1 关键修复已通过真实 HTTP 复验；blocker 0。残余为 `CF-07` Range 切片（契约可选）、`CF-09` degraded、`CF-15` 大目录性能与 client 全量 signals 用例，不阻塞 orchestrator 对接。

## Blocker

无。长 SSE 16.5s、Last-Event-ID、run_gone 410、session meta、raw Accept-Ranges、ended snapshot+end 均通过。

## Decision now

| 决策 | 内容 | 落点 |
|---|---|---|
| `D-01` | `CF-07` 只要求 `Accept-Ranges`，Range 切片按契约可选后置 | 契约/客户端规格 |
| `D-02` | `CF-09` 的 `degraded` 暂接受固定 `ok`；写盘失败汇总后置 | client 后续 |
| `D-03` | client 修复版本继续作为 orchestrator 对接基线；client 工作区提交后再按 commit 复跑 | 交接 |

## Hold

| 项 | 不阻塞理由 | 去向 |
|---|---|---|
| `CF-15` 大目录全量 readdir+lstat | 当前 task-space 文件量小 | client 后续 |
| `CF-02` 清理每小时/首次不立即 | 保留策略已存在；容量风险可控 | client 后续 |
| `signals.test.ts` UC-14 | 与观测面无关；单独复跑仍失败 | client 排查 |
| UI BFF 流式 | O-11/raw 的 UI 实时消费需 UI 改 | UI 项目 |
| client 未提交 | 复验基于工作区快照 | 提交后按 commit 复验 |
| `SCN-0305`/`SCN-0303` 场景 | 产品/组件测试已覆盖；场景登记另立 | 后续工序 |

## Verified sound

| 项 | 查了什么 | 结论 |
|---|---|---|
| `CF-19` | 真实 SSE 16.5s | 未提前关闭，heartbeat 1 |
| `CF-04` | O-05 `Last-Event-ID=1` | snapshot seq `[2,3]` |
| `CF-03` | run tombstone | 410 `run_gone` |
| `CF-07` | raw | `Accept-Ranges: bytes` |
| `CF-08` | recorder 后 meta | 文件存在、字段完整 |
| `CF-13` | ended attempt | snapshot + end |
| `CF-09`（部分） | health | startedAt/uptime 真实、计数非 200 截断 |
| orchestrator | adapter-real 探针 | 文件/session/events/raw/SSE 通过 |
| 门禁 | client `bun test`/typecheck/docs、orchestrator 416/0/quality 0 | 仅 signals 无关失败 |

## 备注

- client 反馈写 `bun test 169 pass`；本机为 168 pass / 1 fail（signals），差异不影响观测面结论。
- 本轮不改两侧代码；client 修复清单的残余项由 client 后续处理。
