---
layer: design
module: workflow-orchestration
status: draft
updated: 2026-11-11
flow: FLOW-RUN-002
scenario: SCN-0302
domain: 工作流编排
valueStream: 工作流运行
title: 节点判定、回退与会话日志回传
entries:
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-scheduler
    path: src/components/scheduler/service.ts
    symbol: createScheduler
docs:
  - path: docs/design/components/run/spec.md
    heading: 4 状态机与不变量
  - path: docs/design/contracts/executor-http-v3.md
    heading: 4.4 `P-04` 上传会话日志
  - path: docs/design/components/run/spec.md
    heading: 4.5 判定与回退
  - path: docs/design/components/scheduler/spec.md
    heading: 4 状态机与不变量
tests: []
externalRefs: []
---

# 节点判定、回退与会话日志回传

## 1 场景与价值

每个执行节点结束后，client 先把本节点的 ACP 事件日志（JSONL + gzip）上传给调度器，再上报结果。`review` 节点的最终消息里必须带结构化 verdict：`pass` 继续走 seq 出边，`fail` 沿该节点预设的回退边退回指定祖先节点重新执行。调度器负责解析 verdict、执行回退与轮次控制，client 不参与判定。

结果：节点日志可按 run/节点回读；判定失败时执行回到设计期指定的节点而不是模型随机选择；反复失败有轮次上限，不会无限烧 token。

前置：run 已启动（`SCN-0301`）；节点任务已派发；client 已按 v3 契约获得 `taskSpacePath`。

## 2 入口

- HTTP（执行面）：`POST /api/v1/executor/tasks/{taskId}/session-log?attempt=n`（`P-04`）；`POST /api/v1/executor/tasks/{taskId}/result`（`P-02`，经 `CMP-run` 包装）。
- 领域：`CMP-run` 的 `attachSessionLog` / `handleTaskResult`（`planned`）；`CMP-scheduler.acceptResult`（不变）。
- 读：`GET /api/v1/runs/{id}/nodes/{nodeId}/session-log`（产品面）。

## 3 运行序

流程定义：`FLOW-RUN-002`。

1. client 节点执行结束 → 打包 ACP 事件为 `application/x-ndjson` + `Content-Encoding: gzip` → `P-04` 上传（带 `attempt`）。
2. 服务端校验：任务属于该 client、`attempt` 匹配、解压后 ≤ `maxSessionLogBytes`（64 MiB）、sha256 计算；同 `taskId+attempt` 重复上传且内容相同 → `200`（幂等）；内容不同 → `409`。
3. 日志落 `<archive.root>/runs/<runId>/nodes/<nodeId>-<visit>.jsonl.gz`，写 `run_artifact` 元数据。
4. client 上报结果 → `CMP-run.handleTaskResult`：找 `run_node` → **日志不存在 → `409 session_log_missing`，不调 `acceptResult`、不结算**；存在 → `scheduler.acceptResult`。
5. 结算 `succeeded`：
   - 普通节点：`run_node(succeeded)`，推进 seq 后继。
   - `review`：解析最终消息中最后一段 ```json 代码块为 `{verdict: "pass"|"fail", reason?}`；`pass` → `succeeded` + 推进；`fail` → `run_node(rejected)`，取该节点唯一 `rollback` 边的 `to` 作为回退目标。
6. 回退：目标节点起重新执行，`run_node` 写 `visit+1` 新行；目标到 review 之间的节点依次重跑；旧行保留为历史。
7. 轮次上限：任一节点 `visit+1 > run.max_node_visits`（默认 5）→ `run.failed(visit_limit_exceeded)`，不再入队。

失败路径：

- verdict 缺失、JSON 非法、`verdict` 非 `pass`/`fail` → `run_node(failed, verdict_invalid)`，`run.failed`，**不猜测、不默认 pass**。
- `review` 判定 fail 但没有 `rollback` 出边 → `run_node(failed, missing_rollback_edge)`，`run.failed`（保存校验应已拦截，运行期兜底）。
- 日志超限 → `413`，不落存储、不结算；client 需以明确错误上报。
- 结果先到、日志未到 → `409`；client 补传后重试结果成功，任务不重跑（同一 `taskId`）。
- 日志上传失败 → 节点保持 `dispatched`，调度器 `S-02` 到期重派；日志按 `attempt` 区分，不覆盖旧尝试。

## 4 不可变引用

- [`executor-http-v3`](../../../../contracts/executor-http-v3.md) §4.2 `P-02`、§4.4 `P-04`、§3.1 错误码与 §3 常量。
- [`CMP-run`](../../../../components/run/spec.md) §4.5 判定与回退、§2 不变量（结果前置日志）。
- [`CMP-scheduler`](../../../../components/scheduler/spec.md) §4 状态机与不变量：结果首份为准、失败不自动重派（`acceptResult` 语义不改）。
- [`executor-http-v3`](../../../../contracts/executor-http-v3.md) §4.2 `P-02`：结果字段、控制信息边界与「日志先于结果」的前置条件。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-RUN-005` | 上传日志 → `200` 且可按 `taskId+attempt` 回读；重复上传按后到覆盖返回 `200` 与 `stored` |
| R2 | `TC-RUN-006` | `review` 返回 `pass` → 节点 `succeeded`、继续 seq；返回 `fail` → 节点 `rejected`、回退边目标以 `visit+1` 重新执行 |
| R3 | `TC-RUN-007` | 回退轮次用尽（`visit > max_node_visits`）→ `run.failed(visit_limit_exceeded)`，不再入队 |
| N1 | `TC-RUN-008` | 未上传日志直接报结果 → `409 session_log_missing`，任务不结算；补传后重试成功；verdict 非法 → 节点 `failed(verdict_invalid)`，run 失败 |

测试落盘后补齐 frontmatter `tests` 并转 `designed`。

## 6 覆盖边界

- 不覆盖 confirm 的人工决策与取消（`SCN-0303`）、归档（`SCN-0304`）。
- 不覆盖 client 侧日志采集与压缩实现（属 client 仓库 v3 改造，另立工序）。
- 不覆盖日志保留期与容量淘汰（`OQ-27`）。
- 不覆盖 `split` 节点的 task.db 上传（第二期）。
