---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-12-drop-instance-blocked
level: P2
---

# 工序：删除实例 `blocked` 状态

> 触发：`OQ-32`（验证 `slug` 时实测：失败的 run 把实例置 `blocked`，同工作区再启动静默 `queued`）。
> 用户裁决（2026-11-12）：**连状态一起删**——大模型调度失败直接重跑即可，不需要跨 run 的摘除态。

## 1 问题

`scheduler` 收到 `failed(workspace)` 结果时把实例置 `blocked` 并结算同实例排队任务。前半句造成两个后果：

- 实例状态跨 run 生效：下一次显式启动复用同一实例，任务永远 `queued`，界面无提示；
- `unblock` 没有 REST 面，只能写脚本恢复。

后半句（结算同实例排队任务）是必要的，避免同批 fan-out 逐个失败。

## 2 范围

| 做 | 不做 |
|---|---|
| 删除 `blocked`：状态闭集收敛为 `active`/`retired`；删 `block`/`unblock` 与 `block_reason` 列 | 实例 `retired` 的 REST 面（仍无） |
| `failed(workspace)` 只结算同实例排队任务，不摘除实例 | 契约（`executor-http-v3`）改动 |
| 迁移 `0007` 把存量 `blocked` 恢复为 `active` | 失败结果的自动重派（仍不重派） |

## 3 验收标准

1. 实例状态只有 `active`/`retired`；`isDispatchable` 只认 `active`。
2. `failed(workspace)`：同实例其余 `queued` 任务结算失败，实例状态**仍为 `active`**。
3. 同一工作区（曾失败）再次启动：任务能正常派发，不再静默排队。
4. 迁移把存量 `blocked` 行改为 `active`，并删除 `block_reason` 列与相关 check。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-DBL-01` | change | `CMP-instance` | 状态机收敛、删 `block`/`unblock`/`BlockReason`/`block_reason` | 完成 |
| `T-DBL-02` | change | `CMP-scheduler` | 去掉自动 block，保留同实例排队任务结算 | 完成 |
| `T-DBL-03` | migration | db | `0007_drop_instance_blocked.sql` | 完成 |
| `T-DBL-04` | docs | instance/scheduler/run/scenarios | 规格与场景同步 | 完成 |
| `T-DBL-05` | test | 上述 | 更新 `TC-EXR-004` 与实例服务用例 | 完成 |
