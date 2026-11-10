---
layer: history
module: global
status: frozen
updated: 2026-11-10
---

# 结果：执行面接口契约评审（调度器侧）

## 1. 验收

| 判据（brief） | 结果 | 证据 |
|---|---|---|
| 四档裁决：每条带档位、证据、后果、修法 | 满足 | `review.md` §2–§5、§8 |
| 交互方向：给选项、代价、触发条件 | 满足 | `review.md` §6（结论：不在 S1/M1 做，登记为备选） |
| 冻结输入：Blocker 与 Decision now 可逐条照改 | 满足 | `review.md` §7–§8.5；三轮复核后裁决为「通过」 |

## 2. 对象与结论去向

- 评审对象是 client 提案 v0.1–v0.4（client 侧已归档到 `docs/history/works/2026-11-04-scheduler-contract-proposal/`）。
- 提案最终冻结为 `executor-http-v1`，2026-11-10 又被 `executor-http-v2` 整体替换（v1 在 client 侧归档）。
- `RB-01`–`RB-04`、`RD-01`–`RD-05`、`ND-01`–`ND-06`、`N2-01`/`N2-02` 在 v1 修订中逐条关闭（`review.md` §8）；v2 删除对应机制后不再有承载对象。
- `OB-01`–`OB-09` 是 client 只读观测面的独立对象，client 侧已按 `review.md` §9.6 处置（`OB-02`–`OB-09` 落稿，`OB-01` 按产品决策接受为风险）。

## 3. 转出与失效项

| 编号 | 处置 | 依据 |
|---|---|---|
| `H-01`（结果保留窗口） | 失效 | v2 `C-04`：结果先落盘，`finished[]` 持到 `accepted` |
| `H-02`/`H-03`（`limits`/容量两个来源） | 失效 | v2 无 `register`/`limits`，容量只由 `capacity.free` 表达 |
| `H-04`（GET 是否带协议头） | 失效 | v2 §3 要求所有请求带 `X-Executor-Protocol: 2`；client 在 `P-03` GET 上也发送（验证 S10） |
| `H-05`/`H-06`（`activeAttempts` 冗余、`attemptNo` 口径） | 失效 | v2 无 attempt 级控制面状态，`attempt` 只随任务下发与结果回报 |
| `H-07`（404 分类） | 失效 | v2 明确 `task_not_found` / `package_not_found` 两个码与 client 行为 |
| `OB-01`（非 loopback + 空 token fail-open） | 转出 | `plan/open-questions.md` `OQ-19` |

## 4. 收口说明

- 评审对象已被归档与替换，本评审不再作为现行依据；`review.md` 随目录归档为历史证据。
- 唯一的未采纳建议（`OB-01`）已转出为开放问题，不阻塞收口。
