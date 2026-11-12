---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-11-12
flow: FLOW-RUN-001
scenario: SCN-0301
domain: 工作流编排
valueStream: 工作流运行
title: 运行启动与节点推进
entries:
  - component: CMP-run
    path: src/components/run/service.ts
    symbol: createRunService
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-workflow
    path: src/components/workflow/read.ts
    symbol: createWorkflowRead
  - component: CMP-instance
    path: src/components/instance/service.ts
    symbol: createInstanceService
  - component: CMP-scheduler
    path: src/components/scheduler/service.ts
    symbol: createScheduler
docs:
  - path: docs/design/components/run/spec.md
    heading: 3 公共契约
  - path: docs/design/components/run/spec.md
    heading: 4 状态机与不变量
  - path: docs/design/components/scheduler/spec.md
    heading: 3 公共契约
  - path: docs/design/components/instance/spec.md
    heading: 3 公共契约
  - path: docs/design/components/workflow/spec.md
    heading: 5.1 节点类型与执行语义
tests:
  - role: R1
    id: TC-RUN-001
  - role: R2
    id: TC-RUN-002
  - role: R3
    id: TC-RUN-003
  - role: N1
    id: TC-RUN-004
externalRefs: []
---

# 运行启动与节点推进

## 1 场景与价值

研发人员在工作流页发起一次运行：指定目标节点（harness）、客户端工作区路径和 markdown 启动诉求。服务端冻结当前图快照，登记实例，从 `start` 节点开始逐个节点推进；每个执行节点在 client 上拉起 session、读写本 run 的 task-space，结束后自动进入下一个 seq 节点，直到 `end` 产出最终结果。

结果：一次启动对应一个 `runId`；节点按图顺序执行，run 最终落 `succeeded` / `failed`；运行期修改工作流定义不影响在跑的 run。

前置：工作流已保存且图通过校验；目标 harness 已登记、启用并绑定 `clientId`；实例由本用例在启动时登记（`InstanceService.enroll`）。

## 2 入口

- HTTP：`CMP-http-gateway` 的 `createHttpApp` → `POST /api/v1/workflows/{id}/runs`。
- 领域：`CMP-run` 的 `createRunService`：`start` / `advance`。
- 读：`CMP-workflow` 的 `createWorkflowRead`：取当前定义与图；`CMP-harness` 的节点目录读：`harnessId` → `clientId`。
- 执行面：`CMP-instance.enroll` 登记实例；`CMP-scheduler.enqueue` 入队节点任务。

契约：执行面语义见 [`executor-http-v3`](../../../../contracts/executor-http-v3.md) 的 `S-01`–`S-08`；产品面端点见 [`CMP-http-gateway`](../../../../components/http-gateway/spec.md) §4.1.1。

## 3 运行序

流程定义：`FLOW-RUN-001`。

1. 调用方提交 `{harnessId, workspacePath, intent, autoConfirm?}`；网关校验字段形状与长度（`intent` 走 `maxPromptBytes` 口径）。
2. `CMP-run.start` 校验可运行性：工作流存在；图恰好一个 `start` 与一个 `end`；每个节点 ≤1 条 seq 入边/出边；`review`/`confirm` 的回退边目标为祖先；节点专家存在且启用；**不含 `split`/`fanout`**（第二期支持）。
3. 解析 `harnessId → clientId`；`instance.enroll({instanceId, clientId, workspacePath})`（重复登记同绑定幂等）；冻结 `revision`、`graphSnapshot`、启动诉求原文；创建 `run(created)` 与首节点 `run_node(pending)`。
4. `advance`：取 `start` 节点 → 按 §4.1 组装 prompt（含 `taskSpacePath`；首节点额外含启动诉求原文）→ 按专家解析 `skillIds` → `scheduler.enqueue({instanceId, nodeId, prompt, timeoutMs, skillIds})` → `run_node(dispatched)`、`run(running)`。
5. client 取任务后 `mkdir -p <workspace>/.agent-flow/task/<runId>`，写 `intent.md`，建 session 执行；结束后先上传 session-log，再上报结果（`SCN-0302`）。
6. `CMP-run.handleTaskResult`：用 `taskId` 找到 `run_node` → 校验日志存在 → `scheduler.acceptResult` → `run_node(succeeded)` → 取该节点唯一 seq 出边 → 入队下一节点；循环直到 `end`。
7. `end` 节点成功后：`run.done(succeeded)`，保存最终消息与产物清单；进入归档流程（`SCN-0304`）。
8. 服务重启：扫描 `running` 的 run，`dispatched` 的节点用 `scheduler.inspect(taskId)` 对账，已结算则补结算再推进；未结算保持等待（`S-02` 会重派）。

失败路径：

- 校验失败（图非法、专家缺失/停用、含 `split`/`fanout`）→ `400`，**不建 run、不登记 instance**。
- `harnessId` 不存在 → `404`；存在但未绑定 `clientId` 或已停用 → `400 validation_error`。
- 实例登记冲突（同 `instanceId` 不同绑定）→ `409`，不建 run。
- 同一工作区已有 `running`/`waiting_confirm` 的 run → `409 run_conflict`，不建 run；等前一个 run 结束后再启动。
- 入队后实例 `blocked` / 节点停用 → 任务留在 `queued`，run 保持 `running`，不报错（派发门禁在调度器，`S-04`/`§4.8`）。
- 节点失败/超时 → `run.failed`，停在当前节点，不再推进（默认语义，见 `OQ-28`）。

## 4 不可变引用

- [`executor-http-v3`](../../../../contracts/executor-http-v3.md) §1 模型与不变式：结果首份为准、失败不自动重派、一任务一 session（v3 沿用）。
- [`executor-http-v3`](../../../../contracts/executor-http-v3.md) §5 类型：`TaskRequest` 的 `taskSpacePath` 必填；启动诉求并入首节点 `prompt`，不单独下发。
- [`CMP-instance`](../../../../components/instance/spec.md) §3 公共契约：`enroll` 幂等、`workspacePath` 绝对路径、只登记不创建目录。
- [`CMP-scheduler`](../../../../components/scheduler/spec.md) §3 公共契约：`enqueue` 冻结快照、同实例技能集一致（`S-06`）。
- [`CMP-run`](../../../../components/run/spec.md) §3 公共契约、§4.3 推进规则、§4.4 prompt 组成。
- [`CMP-workflow`](../../../../components/workflow/spec.md) §5.1 节点类型与执行语义（7 类节点与本期可运行范围）。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-RUN-001` | 合法图启动：返回 `runId`；`run=created→running`；首节点任务派发，`TaskRequest` 含 `taskSpacePath`，首节点 `prompt` 含启动诉求；`run_node(start)=dispatched` |
| R2 | `TC-RUN-002` | 首节点成功结算后自动入队 seq 后继；`run_node(start)=succeeded`、后继 `dispatched`；`run` 保持 `running` |
| R3 | `TC-RUN-003` | `end` 成功：`run=done(succeeded)`，最终消息落库；不再产生新任务 |
| N1 | `TC-RUN-004` | 图非法（无 `start`/多 `start`/专家缺失/含 `split`）→ `400`，不建 run、不登记 instance |

测试落盘后补齐 frontmatter `tests` 并转 `designed`；`entries` 在 `CMP-run` 实现后补 `createRunService`。

## 6 覆盖边界

- 不覆盖审核判定与回退（`SCN-0302`）、确认与取消（`SCN-0303`）、归档（`SCN-0304`）。
- 不覆盖 `split`/`fanout` 的展开（第二期）。
- 不覆盖多 client 选择与队列排序：本期一个 run 只绑一个实例，节点任务顺序由调度器 FIFO 决定。
- 不覆盖管理面鉴权：产品端点当前无鉴权，沿用现状。
