---
layer: works
module: run
status: closed
updated: 2026-11-17
procedure: 2026-11-17-run-node-session-id
level: P2
---

# 工序：run_node 记录 client 回传的 sessionId

> 用户确认（2026-11-17）：字段挂在 `run_node`（每个节点每轮一个）；只落库，不改运行详情 API。历史没有返回的 run 不补写。

## 1 背景

client 执行节点任务时会在 `P-02` 结果里回传 `sessionId`（`executor-http-v3` §4.2，可选字段）。当前 `CMP-run` 只接受结果并结算节点，`sessionId` 在网关解析后被丢弃，数据库没有对应字段。需要把这个反馈落到该任务对应的 `run_node` 行，供工作流执行过程中排查/对接使用；工作流结束后它只是历史信息，不做展示、不做补写。

## 2 范围

| 做 | 不做 |
|---|---|
| `run_node` 增加可空 `session_id`；结果被接受并结算时写入 `TaskResult.sessionId` | 不改 `workflow_run` 表；不改 `task`/`task_attempt` |
| 结果未带 `sessionId` 时保持 `null`；重启补结算、历史行不回填、不推导 | 不暴露到 `RunNodeView`、`GET /runs/{id}`、`openapi.yaml` |
| 覆盖成功、失败/取消/超时与 review 结算路径 | 不新增按 sessionId 的查询/索引/端点 |
| 组件测试与 SCN-0302 断言、run 规格数据所有权更新 | 不改执行面契约字段与协议版本 |

## 3 定级

**P2**：`run_node` 是非核心持久化 schema 的加列（可空、向后兼容、无数据迁移），跨 `CMP-run` 与测试/文档改动，不改公共契约。按 P2 出影响规格与测试计划，合并前由用户最终确认。

## 4 验收标准

1. `P-02` 结果带 `sessionId` 时，对应 `run_node.session_id` 等于该值；不带时为 `null`。
2. 同一 `taskId` 的重复结果、`resumePending` 补结算、历史行（迁移前已存在）均不写、不补。
3. `GET /api/v1/runs/{id}` 的节点视图不出现 `sessionId`，`openapi.yaml` 不变。
4. `run_node` 结算仍只发生一次，状态、verdict、message、error、report 结果不受影响。
5. `bun test tests/components/run tests/components/http-gateway/run-*.test.ts` 通过；`bun run typecheck` 通过；`bun run quality:report` 无新增违规。

## 5 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-RUN-SESSION-01` | change | run | 迁移 `0010`、`RunNodeRow`/列、结算 SQL、结果处理透传 | 完成 |
| `T-RUN-SESSION-02` | change | tests | 网关结果带/不带 sessionId 的落库断言与不补写断言 | 完成 |
| `T-DOC-01` | docs | global | run 规格、SCN-0302、本工序 brief/result/review | 完成 |

装载清单：`db/migrations/`、`src/components/run/{types,store-types,store-node-write,node-ops,results}.ts`、`src/components/http-gateway/routes/executor-request.ts`、`tests/helpers/run.ts`、`tests/components/http-gateway/run-review.test.ts`、`docs/design/components/run/spec.md`、`docs/design/scenarios/workflow-orchestration/workflow-execution/review-verdict-and-rollback/scenario.md`。

## 6 迁移与回滚

- 迁移：`alter table run_node add column session_id text`；已有行为 `null`，无需 backfill。
- 回滚：`alter table run_node drop column session_id`。当前没有读方依赖该列，回滚不改变 run/任务状态。
