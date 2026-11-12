---
layer: works
module: global
status: active
updated: 2026-11-11
procedure: 2026-11-11-scheduler-layer-implementation
---

# 评审：执行面调度层实现（P1，四档裁决）

> 对象：本工序的 `src/`、`db/migrations/0001_baseline.sql`、`tests/` 与组件规格增补。
> 基线：已冻结的 [`executor-http-v2`](../../history/works/2026-11-10-executor-contract-v2/executor-http-v2.md) 与调度层设计规格。
> 裁决口径见 `arch-design-spec` 第 8 步。

## 1 结论

**通过（自动测试与质量门禁均绿）。** 无 blocker；4 项实现取舍需在文档中定性（已落），3 项 hold 转出。P1 的最终验收由用户在 `result.md` 上确认。

## 2 Blocker

无。依据：`bun run check` 334 pass / 0 fail；`bun run quality:gate` 违规 0；执行面 6 张场景的 3 正 1 反可执行且通过；契约 `S-01`–`S-08` 均有测试（`tests/components/scheduler`、`tests/components/http-gateway/executor.test.ts`）。

## 3 Decision now

| ID | 决策 | 选择与理由 | 落点 |
|---|---|---|---|
| `D-I01` | 长轮询挂起周期的测试接缝 | 网关接受可选 `pollHoldMs`（生产默认契约常量 30000，测试注入 20ms）；不进入对外契约。 | `http-gateway/app.ts`、`routes/executor.ts` |
| `D-I02` | 网关与调度器的依赖形态 | 网关只依赖一个 `ExecutorBackend` 读面，由组合根（`src/executor-backend.ts`）用 scheduler/制品端口/鉴权装配；组件扇出保持 8。 | `src/executor-backend.ts`、`http-gateway/app.ts` |
| `D-I03` | 包摘要读侧的兜底 | 保存与种子写入 `package_digest`/`package_size`；读侧遇到空摘要时按字节即时计算（演示数据/历史行容错），不生成第二真相。 | `skill/package-source.ts`、`skill/draft-save.ts`、`scripts/seed.ts` |
| `D-I04` | 观测降级不写日志 | `catalog` 捕获 presence 异常后降级 `unknown`；当前无结构化日志设施，不额外 `console`（避免非入口 console 违规），可观测性记 `OQ-10` 范围。 | `catalog/harness.ts`、`harness` §3.3 |

## 4 Verified sound

| 区域 | 查了什么 / 怎么查 | 结果 |
|---|---|---|
| 状态机 | `tests/components/scheduler` 覆盖入队、派发、重派、结算、取消、停止、`inspect` | 与 `scheduler` §4 一致；失败结果不自动重派 |
| 未回报重派 | 静默、`timeoutMs + resultGraceMs`、`taskMaxAttempts` 用尽 | 通过；旧副本先到结果被接受 |
| 容量与技能集 | `free` 截断、`maxTasksPerPoll`、同实例 digest 冲突 | 通过；入队拒绝冲突批次 |
| 契约端点 | `executor.test.ts` 覆盖 `P-01`–`P-03`、版本闸门、Bearer、未知字段、413、304/404/ETag/摘要 | 通过；响应含 `X-Request-Id` |
| 节点目录 | 绑定冲突、停用不下发、启用恢复、派生四态、观测降级 | 通过（`node-registry.test.ts`、`node-status.test.ts`） |
| 数据与迁移 | 基线新增 `instance`/`task`/`task_attempt` 与 `skill` 摘要列；测试库重置表清单同步 | 19 张表；schema 测试通过 |
| 质量 | `bun run quality:report` / `quality:gate` | 违规 0；函数行数/复杂度/扇出/深导入/非空断言均回到阈值内 |
| 安全 | 检查响应、日志、文档中是否出现真实凭据 | 错误信封不含 token；测试用假 token |

## 5 Hold

| ID | 事项 | 去向 |
|---|---|---|
| `H-I01` | 任务来源与 prompt 组成（上游编排） | `OQ-22`，B4 运行/任务启动工序 |
| `H-I02` | presence 是进程内观测，调度器重启后到首次 poll 前为 `unknown` | 设计既定取舍；多实例调度不在范围 |
| `H-I03` | 只读状态端点（`executor-http-v2` §12.4） | `scheduler` §8 待定 |
| `H-I04` | 历史技能包保留 | 设计已定不保留，旧 `packageId` 404 |
