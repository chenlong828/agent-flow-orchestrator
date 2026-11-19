---
layer: works
module: run
status: active
updated: 2026-11-19
procedure: 2026-11-19-run-start-images
---

# 结果：编排侧 run 初始资料（图片）实现

## 1 结论

编排侧 `T-IMG-08` 落地：暂存上传/删除、启动绑定、`run_input` 持久化、prompt `[初始资料]` 清单、产品 `API-55/56`、执行面 `EXE-06/07` 与 client 能力闸门全部实现。`bun run check` 等价项通过：typecheck 0、451 测试通过、场景索引 18 个最新、质量报告 0 违规（`quality:gate` 仍有 7 项 WARN，见 §4）。

client 侧已实现（[result.md](../../../../agent-flow-client/docs/works/2026-11-19-run-start-inputs/result.md)）：`promptCapabilities.image=true`、`read_image` 实测通过。UI 侧也已实现（[UI result](../../../../agent-flow-ui/docs/history/works/2026-11-19-run-start-images/result.md)），并按 UI 实施裁决把上传时机改为**提交时上传**；后端契约不变。真实 client + UI 的端到端联调仍待执行。

## 2 验收对照

| 验收项 | 结果 | 证据 |
|---|---|---|
| 暂存上传/删除、魔数/体积/文件名校验 | 通过 | `tests/components/http-gateway/run-inputs.test.ts` |
| 启动引用 `inputId` 绑定、重名去重、失败保持 staged | 通过 | `tests/components/run/service.test.ts` TC-RUN-021/023/025 |
| client 未声明 `run-inputs` → 409，不建 run | 通过 | 同文件 TC-RUN-024；`tests/components/http-gateway/run-inputs.test.ts` |
| prompt 清单仅在有图时出现，首节点写 intent 指令 | 通过 | 同文件 TC-RUN-021/022 |
| 产品/执行面读取与 `downloadPath` | 通过 | `run-inputs.test.ts`、TC-RUN-021 |
| 执行面 `EXE-06/07` 路径与能力头 | 通过 | `executor.ts` 路由、`run-inputs.test.ts` |
| 迁移 0014、23 张表、14 个迁移 | 通过 | `tests/db/schema.test.ts`、`tests/components/platform/db.test.ts` |
| 本机 3100 重启后新端点可用 | 通过 | `/openapi.yaml` 49 path/66 operation、`x-api-count=65`；上传/删除 smoke 204 |
| 真实 client + UI 端到端 | 待验证 | 见 §5 |
| UI 提交时上传/回滚与详情缩略图 | 通过（UI 仓库） | [UI result](../../../../agent-flow-ui/docs/history/works/2026-11-19-run-start-images/result.md) |

## 3 结论落点

| 内容 | 落点 |
|---|---|
| `run_input` 表与部分唯一索引 | [`0014_run_input.sql`](../../../db/migrations/0014_run_input.sql) |
| 暂存/绑定/读取/删除 | [`input-ops.ts`](../../../src/components/run/input-ops.ts)、[`inputs.ts`](../../../src/components/run/inputs.ts)、[`store-input.ts`](../../../src/components/run/store-input.ts) |
| 启动绑定与能力闸门 | [`commands.ts`](../../../src/components/run/commands.ts)、[`runtime.ts`](../../../src/components/run/runtime.ts) |
| prompt `[初始资料]` | [`prompt.ts`](../../../src/components/run/prompt.ts)、[`dispatch-ops.ts`](../../../src/components/run/dispatch-ops.ts) |
| 产品 `API-55/56/57/58` | [`routes/run.ts`](../../../src/components/http-gateway/routes/run.ts)、[`routes/run-inputs.ts`](../../../src/components/http-gateway/routes/run-inputs.ts) |
| 执行面 `EXE-06/07` | [`routes/executor.ts`](../../../src/components/http-gateway/routes/executor.ts)、[`executor-backend.ts`](../../../src/executor-backend.ts) |
| 能力头与 presence | [`scheduler/presence.ts`](../../../src/components/scheduler/presence.ts)、[`scheduler/poll.ts`](../../../src/components/scheduler/poll.ts)、[`routes/executor.ts`](../../../src/components/http-gateway/routes/executor.ts) |
| 限额配置 | [`run-config.ts`](../../../src/core/config/run-config.ts)、[`default.toml`](../../../config/default.toml) |
| 契约/规格/场景 | [`executor-http-v3`](../../design/contracts/executor-http-v3.md)、[`run/spec.md`](../../design/components/run/spec.md)、[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)、[`SCN-0307`](../../design/scenarios/workflow-orchestration/workflow-execution/run-start-inputs/scenario.md) |

## 4 测试与门禁

- `bun test`：451 pass / 1 skip / 0 fail。
- `bun run typecheck`：0。
- `bun run docs:check`：18 个场景索引最新。
- `bun run quality:report`：违规 0、工具健康 8/8。
- `bun run quality:gate`：7 项 WARN（`run/types.ts` 导出数、`run.ts` 函数数/路由分支、`RunFileConfig` 可选字段比例、`workflow_run` 列数、`run_node` 可空列比例等），非本次新增的既有基线居多；未阻塞交付，登记为后续质量项。

## 5 未决与后续

1. **真实联调**：起 orchestrator + client + UI，跑「粘贴/上传 2 张 PNG → 启动 → client 落盘 → 首节点 `read_image` → 归档含 `inputs/`」。
2. **UI**：已按「提交时上传」实现（[UI result](../../../../agent-flow-ui/docs/history/works/2026-11-19-run-start-images/result.md)）；本仓库 [`ui-proposal.md`](ui-proposal.md) 已标注旧提案与实施修订。
3. **场景收口**：`SCN-0307` 当前 `designed`；真实联调后按 3+1 结果转 `verified`，并更新 `REQ-0003`。
4. **暂存孤儿**：暂存项不设 TTL，UI 关闭时 DELETE；未 DELETE 的孤儿需运维清理（无自动清扫）。
5. **质量 WARN**：`run/types.ts` 导出数、`run.ts` 函数/分支数等可在后续小改中收敛，不影响本次功能。
