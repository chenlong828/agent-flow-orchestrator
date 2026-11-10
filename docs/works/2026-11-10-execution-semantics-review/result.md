---
layer: works
module: global
status: closed
updated: 2026-11-10
---

# 结果：执行容错语义提议评审（fan-out / 卡死处理）

## 1. 验收

| 判据（brief） | 结果 | 证据 |
|---|---|---|
| 逐条答复 Q1–Q8 | 满足 | `review.md` §3 |
| 契约影响：指出提案遗漏的加法项 | 满足 | `review.md` §4–§7；最终以 v2 契约整体吸收，不再逐字段打补丁 |
| 证据可指到契约条款或代码 | 满足 | `review.md` 每条带证据 |

## 2. 结论与 v2 契约的对应

| 编号 | 原结论 | v2 中的落点 | 状态 |
|---|---|---|---|
| `SA-01` | 「实例不可用」缺汇报载体（Blocker） | v2 删除实例级派发与 `claim`，任务自带 `workspacePath`；故障以 `failed(workspace)` 上报，调度器按 `S-02` 重派 | 机制层面消解 |
| `SA-02` | idle 与总超时不可区分 | `contract-v2.md` §4.2 #4：`code` 约定 `prompt_timeout` / `idle_timeout` | 已落契约；client 总超时仍报 `timeout`（`OQ-15`） |
| `SA-03` | idle 默认 10 分钟会误杀 | `C-06`：默认关闭，`N` 由本地配置决定 | 已落契约，client 缺省 0 |
| `SA-04` | fan-out 需要「放行槽位」 | v2 §9：并发只由 `capacity.free` 表达，同 `instanceId` 允许并发，条件为 `S-06` 同 digest + `C-03` 安装临界区 | 已决议（不引入槽位字段） |
| `SA-05` | 实例不可用的解除条件未定义 | v2 无该机制，条目失效 | 关闭 |
| `SA-06` | 撤回（写冲突不机制化） | v2 §9 只约束技能集一致，不作写域隔离 | 已撤回 |
| `SH-01` | `renew` 未接线 | v2 删除租约与 `renew` | 失效 |
| `SH-02` | 「并发重叠」表述不准 | v2 允许重派与重叠，表述问题消失 | 失效 |
| `SH-03` | `locked` 应改 `cancelled(superseded)` | v2 删除实例锁与 `run_superseded`，该路径不存在 | 失效 |
| `SH-04` | `lastEventAt` 有价值 | v2 `RunningTask.lastEventAt` 为可选；client 未实现（`OQ-18`） | 转后续 |

## 3. 收口说明

- 评审对象（client 执行容错语义提案）的结论已被 `executor-http-v2` 契约整体吸收，本评审不再作为后续设计依据；`review.md`、`simplification.md` 随目录归档为历史证据。
- 两条遗留转出：`OQ-15`（总超时错误码）、`OQ-18`（`lastEventAt` 实现）——均为 client 侧，不阻塞本工序。
