---
layer: works
module: global
status: closed
updated: 2026-11-10
---

# 结果：executor-http-v2 接口验证

## 1. 验收结果

| 判据（brief） | 结果 | 证据 |
|---|---|---|
| 可复跑：一条命令跑完，逐项 PASS/FAIL | 满足 | `harness/verify.ts`，57 项断言，`run-output.txt` 存档 |
| 条款可追溯：结论能指到契约章节与 client 行号 | 满足 | `verification.md` §3 条款矩阵 |
| 差异分级 | 满足 | `verification.md` §1 偏离表、§4 静态发现、§5 未覆盖 |
| 可关闭判定有证据 | 满足 | 见本文 §3 |

**验证数量**：57 项断言 55 通过；client 自身测试 106 pass / 0 fail；契约副本字段与语义一致。

**结论**：接口主体一致，可以进入调度器侧实现；2 项 client 偏离（`VD-01` 错误码、`VD-02` 摘要不匹配未重试）与 1 项契约未定义的风险（`VR-01` 首次请求即 304）已记录，均不阻塞。

## 2. 结论落点

| 结论 | 落点 |
|---|---|
| 条款级验证矩阵与偏离清单 | [`verification.md`](verification.md) |
| 可复跑验证桩与输出 | [`harness/verify.ts`](harness/verify.ts)、[`harness/run-output.txt`](harness/run-output.txt) |
| 需契约侧决定的 3 项 | [`plan/open-questions.md`](../../plan/open-questions.md) `OQ-12`…`OQ-14` |
| 需 client 侧修复的 2 项 | 同表 `OQ-15`、`OQ-16` |
| 契约工序收口 | [`2026-11-10-executor-contract-v2/result.md`](../2026-11-10-executor-contract-v2/result.md) |

## 3. 针对本契约的 open 工序：关闭判定

| 工序 | 判定 | 依据 | 归档前置 |
|---|---|---|---|
| `2026-11-10-executor-contract-v2` | **可关闭** | 任务表 T1–T4 完成；client 已按契约实现并用本工序验证；delivery §8 两个待确认项已由 client 实现确认（`maxConcurrent` 默认 4、idle 默认关闭 0） | 契约正文是现行权威，归档前须从 `works/` 移到 `design/`；位置需拍板（见 §4） |
| `2026-11-10-execution-semantics-review` | **可关闭** | `SA-01`–`SA-06`、`SH-01`–`SH-04` 在 v2 契约里全部有处置：idle 码进 §4.2、idle 默认关进 `C-06`、并发放行改由 `free` 表达、claim/租约/实例不可用机制整体删除 | 无 |
| `2026-11-05-scheduler-contract-review` | **可关闭** | 评审对象是 v0.1–v0.4 提案（client 侧已归档为 `docs/history/works/2026-11-04-scheduler-contract-proposal/`）；其 `RB`/`RD`/`ND`/`N2` 在 v1 修订中关闭，v1 又被 v2 替换；`OB` 是 client 观测面独立对象（client 侧工序已收口） | 无；`OB-01` 未采纳的安全建议转 `OQ-19` |
| `2026-11-07-client-architecture-review` | **可关闭** | 评审对象是 v1 客户端架构与 9 份组件规格；v2 重写把 `heartbeat`/`assignments`/`cleanupPending`/租约端口整体删除，`AB`/`AD`/`NB-01` 全部失效；`AD-02`/`AD-03`/`AD-05` 的不变量在 v2 实现中仍成立（截断预留标记、`stateRoot` 分区、`DSH_HOME` 由 runtime 创建清理） | 无 |
| `2026-11-03-client-boundary` | **暂不关闭** | 交付物存在，但 §1.6/§9 的交互框架仍是 v1（`register`/`heartbeat`/`claim`/租约/`bindSession`），与 v2 冲突；且它是 client 仓库 README 与 `history/decisions/2026-11-03-client-workspace-process-model.md` 的引用目标，直接归档会让引用指向已移动路径 | 需先把交互章节改为引用契约 v2，再收口 |

## 4. 已拍板与执行（2026-11-10）

1. **契约正文落点**：移到 `docs/design/contracts/executor-http-v2.md`（`layer: design` / `status: current`），作为跨项目契约层；`docs/README.md` 已登记。
2. **归档方式**：先提交工序快照（使移动可回滚），再 `git mv` 到 `docs/history/works/`，frontmatter 改 `layer: history` / `status: frozen`。
3. **跨仓库待办**：client 仓库契约副本头部仍指向旧的 `works/` 路径，需由 client 侧同步。

## 5. 后续

- 调度器侧实现 executor 端点属 P1，需另立工序（不在本工序范围）。
- `verification.md` §6 的 4 条 client 修复项由 client 侧工序处理。
