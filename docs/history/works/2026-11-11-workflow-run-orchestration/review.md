---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-11-workflow-run-orchestration
---

# 评审：工作流运行编排（B4 第一期）

> 按 `arch-design-spec` 第 8 步走查。定级 P1（新增 `CMP-run`、run 三张表、执行面 v3、6 个产品端点、`workflow_run` schema 收敛）；四档齐全。

## 1 Blocker

无。数据不丢失、取消与归档语义可恢复；schema 收敛迁移在演示库与测试库均已执行，回滚路径为重新加回三列并回填（`result` 已保留原值，可逆）。

## 2 Decision now

| ID | 决策 | 证据/权衡 | 落点 |
|---|---|---|---|
| `D-01` | `workflow_run` 由 23 列收敛到 20 列：`final_message`/`error` 合入 `result`，去掉冗余 `started_at`（创建即开始）与 `updated_by`（运行无人工编辑） | 用户 2026-11-12 确认；`startedAt` 对外取 `created_at`；`0005` 先回填再删列，可逆 | 迁移 `0005`、`run/spec` §2、`store-*` |
| `D-02` | `RunSummary` 列表按 §4.1.1 移除 `workspacePath`/`taskSpacePath`/`autoConfirm`/`error`，详情保留 | 用户 2026-11-12 确认；实现原先多返回字段，属契约偏离 | `types.ts`、`store-view.ts`、openapi `RunSummary` |
| `D-03` | `API-46`/`API-47` 的 `nodeId` 按图内稳定 ID 校验，不再要求 UUID | 图节点 ID 是 `n1` 这类字符串；原实现导致决策与日志下载对真实节点返回 400 | `validation.ts#assertNodeId`、场景测试 `TC-RUN-005`/`009` |
| `D-04` | 访问轮次用尽不再抛 `409`：结果已接受，服务端置 `run.failed(visit_limit_exceeded)` 并正常返回 | 原实现先 `acceptResult` 再抛错，client 会重试同一结果；`TC-RUN-007` 证明返回 200 且 run failed | `node-ops.ts#createNode`、`advance.ts` |
| `D-05` | 图引用专家不存在 → `400 validation_error`；`harness` 未绑定/停用保持 `400`；场景卡把「不存在」与「未绑定」拆开 | 场景 `SCN-0301` 原先把两者合并为 404，与实现和 gateway 错误表不符 | `commands.ts`、`SCN-0301` §3 |
| `D-06` | `quality-report` 表宽按迁移顺序应用 `add/drop column` | 原工具只读 `create table`，`0005` 后仍报 23 列；修正后为 20 列，非阈值调整 | `scripts/quality-report.ts` |

## 3 Verified sound

| 检查项 | 方式 | 结论 |
|---|---|---|
| 场景验收 | `tests/components/http-gateway/run-*.test.ts` 16 例，每场景 3 正 1 反 | 通过（369 pass / 0 fail） |
| 服务契约 | `tests/components/run/service.test.ts` 13 例 | 通过 |
| 质量门禁 | `bun run quality:gate` | 0 违规；表宽 20、复杂度/行数/非空断言/深导入/克隆块全部归零 |
| 契约计数 | `openapi.test.ts` | 54 个业务端点、55 operation、38 path、`x-api-count=54` |
| 真实链路 | T-RUN-09 四条链路（§3 result） | 通过；日志先于结果、归档 `stored`、cancel 结算 |
| 日志/归档落盘 | 下载头与目录检查 | 通过 |
| 依赖边界 | `quality:gate` 深导入 0、架构测试 | 通过；`CMP-run` 只依赖允许的读契约与 `FileStore` 端口 |
| 安全 | `git diff --cached`、token 只落 `/tmp` | 通过；无密钥进入仓库 |

## 4 Hold

| ID | 事项 | 不阻塞理由 | 去向 |
|---|---|---|---|
| `H-01` | 取消后未被 client 认领的 dispatched 任务占住实例容量 | 需 client 重启丢任务才会触发；live client 联调中 cancel 正常结算；最坏由 `S-02` 超时回收 | `OQ-29` |
| `H-02` | client `signals.test.ts` SIGINT 用例本机超时 | client 仓库测试环境问题，不影响契约与联调链路 | client 仓库 |
| `H-03` | `split`/`fanout` 执行 | 第二期范围，启动时明确拒绝 | 第二期 |
| `H-04` | 归档读取端点与保留期/配额 | 本期无读取 API；容量策略见 `OQ-27` | `OQ-27` / 后续 |

## 5 结论

**通过**（blocker 0；decision 6 项均已落文档与 pinning test；hold 4 项已转出且不阻塞）。待用户验收后归档。
