---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-11-12
flow: FLOW-RUN-004
scenario: SCN-0304
domain: 工作流编排
valueStream: 工作流运行
title: 运行归档
entries:
  - component: CMP-run
    path: src/components/run/service.ts
    symbol: createRunService
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
    heading: 4.5 `P-05` 上传运行归档
  - path: docs/design/components/run/spec.md
    heading: 4.7 归档
tests:
  - role: R1
    id: TC-RUN-013
  - role: R2
    id: TC-RUN-014
  - role: R3
    id: TC-RUN-015
  - role: N1
    id: TC-RUN-016
externalRefs: []
---

# 运行归档

## 1 场景与价值

run 进入终态（`succeeded` / `failed` / `cancelled`）后，调度器通过 poll 电平指令让 client 把整个 task-space 打包上传；服务端把归档包与各节点 session-log 副本存到 `<archive.root>/history/<instanceId>/<runId>/`。client 在下一跳 poll 回报已归档的 runId，服务端停止下发指令；本地 task 目录保留，由运维按实例回收。

结果：每次运行都有可追溯的完整产物与日志留档，且归档失败不改变 run 的终态。

前置：run 已进入终态；各节点 session-log 已按 `SCN-0302` 上传；client 仍在轮询（离线时归档保持待办）。

## 2 入口

- HTTP（执行面）：`P-01` `POST /api/v1/executor/poll` 的 `archiveRequests` / `archivedRuns` 字段；`P-05` `POST /api/v1/executor/runs/{runId}/archive`。
- 领域：`CMP-run` 的 `archiveRequestsFor` / `storeArchive`。
- 存储：`FileStore`（`CMP-platform` 实现）写 `<archive.root>/history/...`。

## 3 运行序

流程定义：`FLOW-RUN-004`。

1. run 进入终态时置 `archive_state = pending`；该 run 的节点日志副本（`runs/<runId>/nodes/*.jsonl.gz`）已在存储中。
2. 该 client 下一次 `P-01`：响应增 `archiveRequests: [{runId, instanceId, taskSpacePath}]`；电平语义，直到 client 在 `archivedRuns` 中确认。
3. client 打包 `<workspace>/.agent-flow/task/<runId>/` 为 tar.gz → `POST /runs/{runId}/archive`（`application/gzip`）。
4. 服务端校验：run 存在且属于该 token 的 `clientId`；大小 ≤ `maxArchiveBytes`（512 MiB）；gzip/tar 可解且不含路径穿越；计算 sha256。
5. 落盘：`<archive.root>/history/<instanceId>/<runId>/task-space.tar.gz`，并把该 run 各节点日志副本复制到同目录 `logs/<nodeId>-<visit>-a<attempt>.jsonl.gz`；写 `run_artifact` 与 `archive_state = stored`。
6. client 下一跳 poll 带 `archivedRuns: [runId]`：服务端停止为该 run 下发归档指令；重复上报幂等。
7. 本地 `<workspace>/.agent-flow/task/<runId>/` 保留不删除；回收由运维按 `instanceId` 处理（与「工作区默认保留」一致）。

失败路径：

- run 不存在或不属于该 client → `404 run_not_found`，不落盘。
- 超过 `maxArchiveBytes` → `413`，不落盘；client 需报明确错误（本期不做分包）。
- gzip 损坏、tar 含绝对路径/`..`/越界符号链接 → `400 invalid_archive`，不落盘。
- client 离线或未上传 → `archive_state` 保持 `pending`，**不阻塞 run 终态**，也不重试到无限；下次 poll 继续电平下发。
- 重复上传按后到覆盖返回 `200`；响应 `stored` 说明是新建、替换还是未变。

## 4 不可变引用

- [`CMP-run`](../../../../components/run/spec.md) §4.7 归档：`archive.root` 目录约定与电平下发。
- [`executor-http-v3`](../../../../contracts/executor-http-v3.md) §4.1 `P-01`、§4.5 `P-05`、§3 常量。
- [`CMP-run`](../../../../components/run/spec.md) §2 不变量：`archive_state` 不参与 run 状态判定。
- [`executor-http-v3`](../../../../contracts/executor-http-v3.md) §4.1 `P-01`：长轮询与电平信号的基本语义（v3 在其上加字段）。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-RUN-013` | run 终态后 poll 返回该 run 的 `archiveRequests`；上传 `P-05` 后下一跳 `archivedRuns` 确认，服务端停止下发且 `archive_state=stored` |
| R2 | `TC-RUN-014` | 归档目录为 `history/<instanceId>/<runId>/`，含 `task-space.tar.gz` 与该 run 各节点日志副本；目录名分别使用 `instanceId` 与 `runId` |
| R3 | `TC-RUN-015` | 重复上传返回 `200`，按后到覆盖只保留一份归档；`stored` 为 `created`/`replaced`/`unchanged` |
| N1 | `TC-RUN-016` | 未知 run 或非本 client 上传 → `404`；损坏 tar.gz → `400 invalid_archive`；超限 → `413`；均不落盘、不改变 `archive_state` |

测试已落盘（`tests/components/http-gateway/`），frontmatter `tests` 已补齐并转 `verified`。

## 6 覆盖边界

- 不覆盖日志上传与节点判定（`SCN-0302`）。
- 不覆盖归档读取端点：本期无下载 API，归档产物由运维按 `archive.root` 访问。
- 不覆盖归档保留期、配额与清理（`OQ-27`）。
- 不覆盖 client 离线后的补传策略：靠 poll 电平持续下发，不做独立重试队列。
