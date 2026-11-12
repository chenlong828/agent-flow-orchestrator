---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-12-drop-instance-blocked
---

# 评审与裁决：删除实例 `blocked`

定级 **P2**：改调度层的结果结算语义与实例状态机，不改线协议；schema 仅删列/收紧枚举。

## Blocker

无。

## Decision now

| ID | 决定 | 影响 |
|---|---|---|
| `D-01` | 删除 `blocked`，状态闭集 `active`/`retired` | 实例不再有「摘除但保留」的中间态；工作区坏了就每次显式启动失败一次，错误可见 |
| `D-02` | 保留「`failed(workspace)` 结算同实例其余 `queued` 任务」 | 同批 fan-out 不逐个失败；这一句与状态无关 |
| `D-03` | 迁移 `0007` 把存量 `blocked` 恢复为 `active` 并删 `block_reason` | 一次性数据修正；没有审计需求，旧原因不留 |

## Verified sound

| 区域 | 查了什么 / 怎么查 | 结果 |
|---|---|---|
| 状态机 | 迁移后查库：所有实例 `active`/`retired` | 通过（原 2 条 `blocked` 已恢复） |
| 失败结算 | `TC-EXR-004`：workspace 失败后实例 `active`、兄弟任务 `failed`、新任务可派发 | 通过 |
| 重跑 | 在曾失败的 `/tmp/af-slug-check` 起 run | 任务正常派发，n1 `succeeded` |
| 回归 | `bun test --max-concurrency=1` | 390 pass / 0 fail |
| 门禁 | `typecheck`、`docs:check`、`quality:report` | 通过；违规 0 |

## Hold

无。
