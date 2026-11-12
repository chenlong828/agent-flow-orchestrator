---
layer: works
module: global
status: frozen
updated: 2026-11-12
---

# 影响规格：`taskSpacePath` 入队必填（P2）

## 1 背景

联调 `SCN-0301` 时 client 拒收任务：`TaskRequest.taskSpacePath` 落库为空串，client 按
[`executor-http-v3`](../../../design/contracts/executor-http-v3.md) §5（必填、非空、绝对路径）判为非法字段。

直接原因已修（`07e7a38`）：`CMP-scheduler.validateDraft` 返回值漏掉 `taskSpacePath`，入队写入 `""`。
残留风险：`TaskDraft.taskSpacePath` 仍是可选字段，`enqueue` 用 `?? ""` 兜底；任何调用方漏传都会重复「静默下发空串 → client 拒收 → 重派」。
这与「业务字段为空是缺陷，不要用兜底掩盖」冲突。本次把该字段收紧为入队必填，收掉「空串表示旧任务」语义。

## 2 范围

做：

- `TaskDraft.taskSpacePath` 由可选改为必填；入队校验非空、绝对路径（以 `/` 开头）。
- 删除 `enqueue` 的 `?? ""` 兜底。
- `CMP-scheduler` 规格 §3.1/§4.4 与 `SCN-0201` 同步字段口径。
- 单测：补齐调用点、增加「缺失/相对路径被拒」用例。

不做：

- 不改 `task` 表结构与既有迁移：历史行仍可能有 `task_space_path = ''`，加 `<> ''` 约束会因这些行失败，且无源可回填；待历史行自然结算后再评估迁移。
- 不改外部契约：`executor-http-v3` §5 早已规定 `TaskRequest.taskSpacePath` 必填，本次是内部入队契约向已冻结契约对齐。
- 不新增「必须位于 `workspacePath` 之下」的服务端校验：该判断需要实例快照，且契约把根内校验定为 client 承诺（`C-10`）。

## 3 契约 diff

```ts
// before
type TaskDraft = { ...; skillIds: string[]; taskSpacePath?: string };
// after
type TaskDraft = { ...; skillIds: string[]; taskSpacePath: string };  // 非空、绝对路径
```

错误模式：缺失或非绝对路径 → `ValidationError("taskSpacePath", ...)`，整批入队拒绝（与 `skillIds` 校验同一入口）。
回滚：恢复可选字段与 `?? ""` 兜底即可，无数据迁移。

## 4 影响面

| 调用方 | 影响 |
|---|---|
| `CMP-run.dispatch` | 已始终传 `run.task_space_path`（非空绝对路径），无改动 |
| 执行面 `P-01` | 无改动：`TaskEnvelope` 早已含 `taskSpacePath` |
| 历史 `task` 行 | 空串行仍按原值下发；本次不回收 |
| 测试 | 调度器/执行面/节点门禁的 21 处入队调用补字段 |

## 5 测试计划

- 入队缺 `taskSpacePath` 或传相对路径 → `ValidationError`，任务不落库。
- `TC-EXD-001`：派发信封的 `taskSpacePath` 与入队值一致。
- 全量 `bun run check`。

## 6 定级与确认

- 定级：**P2**（改组件契约，跨文件；不触碰 schema、依赖、热路径）。
- 确认：2026-11-12 对话中用户选择「把 `taskSpacePath` 改成入队必填，旧任务语义一并收掉」，作为最终确认记录。

## 7 验证结果（2026-11-12）

- `bun run typecheck`、`bun test`（350 pass）、`docs:check` 通过；`quality:report` 违规数与改动前一致（26 条，均为存量）。
- 线上 3100 重启后，用原诉求重起联调 run `01a1cddc-1511-7490-9135-3973e93e9741`：任务落库 `task_space_path` 非空（70 字节），client 正常领取并 `succeeded`，run 到达 `done/succeeded`，归档 `stored`。
- 旧空路径任务（`01a1cdcc-eb98-70dc-9cf8-30e38279f0db`）随 run 取消后仍被 `S-03` 重发，且会污染同一 client 的 poll 响应；已在库内结算为 `cancelled` 以解除阻塞。该「取消后未登记任务」的清理路径未纳入本次范围。
