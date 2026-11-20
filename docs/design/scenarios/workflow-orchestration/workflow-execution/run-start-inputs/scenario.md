---
layer: design
module: workflow-orchestration
status: verified
updated: 2026-11-20
flow: FLOW-RUN-001
scenario: SCN-0307
domain: 工作流编排
valueStream: 工作流运行
title: 运行初始资料（图片）
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
    heading: 3 公共契约
  - path: docs/design/components/run/spec.md
    heading: 4.4 prompt 组成
  - path: docs/design/components/http-gateway/spec.md
    heading: 4.1 业务端点
  - path: docs/design/components/scheduler/spec.md
    heading: 3 公共契约
  - path: docs/design/contracts/executor-http-v3.md
    heading: 4.6 `EXE-06` 列出初始资料
tests:
  - role: R1
    id: TC-RUN-021
  - role: R2
    id: TC-RUN-022
  - role: R3
    id: TC-RUN-023
  - role: N1
    id: TC-RUN-024
externalRefs: []
---

# 运行初始资料（图片）

## 1 场景与价值

研发人员在发起运行时，除了输入文字诉求，还可以粘贴/拖放一张或多张图片。图片先在产品面逐张暂存，启动时绑定到本次 run；client 取到任务后把图片写入 `<task-space>/inputs/`，各节点模型按需用 `read_image` 查看，运行详情也能看到缩略图。

结果：图片与文字诉求一起进入同一个 run，不因 prompt 大小限制或服务端无法访问工作区而丢失；旧 client 不会静默丢图。

## 2 入口

- HTTP：`POST /api/v1/run-inputs`（`API-57`）、`DELETE /api/v1/run-inputs/{inputId}`（`API-58`）、`POST /api/v1/workflows/{id}/runs`（`API-42`，带 `inputs`）。
- 读：`GET /api/v1/runs/{id}/inputs`（`API-55`）、`/content`（`API-56`）。
- 执行面：`GET /api/v1/executor/runs/{runId}/inputs`（`EXE-06`）、`/inputs/{inputId}`（`EXE-07`）；client poll 带 `X-Executor-Capabilities: run-inputs`。

## 3 运行序

流程定义：`FLOW-RUN-001`。

1. UI 粘贴/拖放图片，逐张调 `API-57`；服务端按魔数校验 PNG/JPEG/WebP/GIF、单张 ≤8 MiB、清洗文件名，写 `FileStore` 与 `run_input(state=staged)`。
2. 用户删除某张时调 `API-58`；只允许 `staged`，已绑定 409。
3. 启动调 `API-42`，`inputs` 按顺序引用 `inputId`；服务端校验数量 ≤8、ID 不重复、全部 `staged`、合计 ≤20 MiB，再检查 client 是否声明 `run-inputs`。
4. 通过后在同一事务建 run、首节点并绑定 `run_input(state=bound, position=1..N, name 去重)`；绑定失败整体回滚，暂存行保持 `staged`。
5. `CMP-run` 组装 prompt：在 `[输出要求]` 后插入 `[初始资料]` 清单；首节点追加「写入 intent.md」指令。
6. client 收到带 `runId` 的任务，在 `ensureTaskSpace` 后、建 session 前调 `EXE-06/07`；逐张校验 `sizeBytes`+`sha256`，原子写入 `<task-space>/inputs/<name>`（只读），已存在且大小相同则跳过。
7. 后续节点复用同一 task-space；运行详情/确认页通过 `API-55/56` 展示与服务端副本。

失败路径：

- 上传类型/体积/文件名非法 → 400/413，不建行、不留对象。
- 启动引用未知/重复/已绑定/超过上限 → 400/413，事务回滚，暂存行保持 `staged`，不建 run。
- client 未声明 `run-inputs` → 409 `client_unsupported`，不建 run，暂存行保留。
- 同工作区已有活跃 run → 409 `run_conflict`，暂存行保留。
- client 拉取/校验/落盘失败 → 任务 `failed(asset)`，不建 session。

## 4 不可变引用

- [`CMP-run`](../../../../components/run/spec.md) §3 公共契约、§4.4 prompt 组成、§2 数据所有权。
- [`CMP-http-gateway`](../../../../components/http-gateway/spec.md) §4.1/§4.3 与错误映射。
- [`CMP-scheduler`](../../../../components/scheduler/spec.md) §3 公共契约（`capabilities`）。
- [`executor-http-v3`](../../../../contracts/executor-http-v3.md) §3 能力头、§4.6/§4.7。

## 5 测试方案

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-RUN-021` | 上传两张 PNG → 启动引用 → `run_input` 2 行 `bound`、prompt 含清单、产品/执行面可读、client 落盘 |
| R2 | `TC-RUN-022` | 不带图片启动：prompt 无 `[初始资料]`，行为与现状一致 |
| R3 | `TC-RUN-023` | 删除暂存项成功；删除已绑定项 409；重名绑定去重为 `-2` |
| N1 | `TC-RUN-024` | client 未声明 `run-inputs` → 409，不建 run、暂存行保留；未知/重复 inputId 同样被拒 |

实现测试：`tests/components/run/service.test.ts`（CMP-run 初始资料）、`tests/components/http-gateway/run-inputs.test.ts`（API/EXE）。

## 6 覆盖边界

- 不覆盖 UI 粘贴/上传交互（`agent-flow-ui` 独立项目，按 `ui-proposal.md` 实现）。
- 不覆盖 client 的下载/落盘实现细节（client 仓库已实现，执行面契约由 `EXE-06/07` 约束）。
- 不覆盖 run 归档后的图片浏览（`OQ-34`）。
- 不覆盖暂存孤儿清理策略（当前无 TTL，由 UI DELETE 或运维清理）。
