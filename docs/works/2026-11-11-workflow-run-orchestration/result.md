---
layer: works
module: global
status: active
updated: 2026-11-12
procedure: 2026-11-11-workflow-run-orchestration
level: P1
---

# 结果：工作流运行编排（B4 第一期）

> 承接 [`REQ-0001`](../../requirements/REQ-0001-workflow-run-orchestration.md)。任务表与范围见 [`brief.md`](brief.md)，评审见 [`review.md`](review.md)。

## 1 结论

`T-RUN-04`–`T-RUN-10` 全部完成：`CMP-run` 落地并通过 13 个组件测试，`SCN-0301`–`SCN-0304` 各落 3 正 1 反 HTTP 场景测试并转 `verified`，产品面 6 个端点与执行面 `P-04`/`P-05` 接线完成，OpenAPI 补齐到 54 个业务端点。与 `agent-flow-client`（`95d759a`，契约 v3）完成四条真实链路联调：启动→end、review 失败回退到轮次上限、confirm 决策、运行中取消；会话日志可回读、归档落盘。

`bun run check` 369 pass / 0 fail，`bun run quality:gate` 0 违规，`docs:check` 通过；3100 已用本次代码重启并验证 `/healthz`、`/openapi.yaml`。

## 2 交付物

| 范围 | 落点 |
|---|---|
| `CMP-run` | `src/components/run/`：`service.ts` 门面 + `core`/`node-ops`/`dispatch-ops`/`advance`/`results`/`commands`/`queries`/`artifacts`，`store.ts` 组成 `store-*` 六个子模块 |
| 产品面端点 | `API-42`–`API-47`：启动、详情、列表、取消、confirm 决策、日志下载 |
| 执行面 v3 | `P-04` session-log、`P-05` archive、`poll` 的 `archiveRequests`/`archivedRuns`、协议 3 |
| 数据 | 迁移 `0005_workflow_run_width.sql`：`workflow_run` 由 23 列收敛到 20 列（`final_message`/`error` 合入 `result`，去掉冗余 `started_at`/`updated_by`） |
| 契约 | `openapi.yaml` 新增 6 个 path/operation，`x-api-count=54`；`RunSummary` 按 §4.1.1 只保留摘要字段 |
| 测试 | `tests/components/run/service.test.ts` 13 例；`tests/components/http-gateway/run-*.test.ts` 16 例；`tests/helpers/run.ts` |

## 3 T-RUN-09 联调记录（2026-11-12）

被测版本：本仓库 `bba7f9a`（含运行编排与迁移 0005）、`agent-flow-client` `95d759a`（契约 v3）；3100 + PostgreSQL `54329`；client 配置 `dsh_home=/tmp/jd/dsh-home`，token 只存在 `/tmp/trun09.token`。

| 链路 | runId | 结果 |
|---|---|---|
| 启动→end | `01a1ceee-a04f-7105-95f1-7dfae34d77fb` | `done/succeeded`；两个节点均 `succeeded`；client 先传日志再报结果；`archiveState=stored`（509 B） |
| review 失败回退 | `01a1cef0-2d7e-7535-a7fe-6cebb86b04d5` | n3 每轮 `rejected(verdict=fail)`，回退到 n2 且 `visit` 递增 1–5；第 5 轮后 `run.failed(visit_limit_exceeded)`，不再入队 |
| confirm 决策 | `01a1cef6-37ec-7277-899f-9442a9faa7fd` | 首节点成功后 `waiting_confirm` 无任务；`POST decision pass` 后 n3 派发并成功；`done/succeeded`、`archiveState=stored`（487 B） |
| 运行中取消 | `01a1cef7-9610-74a1-9e6b-f2970e63f8e6` | 任务执行中取消 → run `done/cancelled`；client 收到 `cancelInstances` 终止 DSH 并回报 `cancelled`；task `done/cancelled` |

补充证据：

- `GET /api/v1/runs/{id}/nodes/n1/session-log` 返回 `200`、`Content-Encoding: gzip`、`Content-Length: 1791`、`X-Checksum-Sha256: 8758…0f85`，解压为首个 `session/update` JSONL 事件。
- 归档目录：`.local/archive/history/<instanceId>/<runId>/task-space.tar.gz` 与 `logs/<nodeId>-<visit>-a1.jsonl.gz`（review run 含 n2 五轮、n3 五轮日志）。
- client 侧日志：`task.received` → `task.reported` 顺序、`archive.uploaded`；client 测试 118/119 通过、`typecheck` 通过。

## 4 实现期发现并修复

| 问题 | 修复 |
|---|---|
| 决策/日志端点把图内 `nodeId` 当 UUID 校验，`n2` 这类 ID 无法调用 | 新增 `assertNodeId`，按图节点规则校验 |
| 图引用专家不存在时抛 `404 not_found`，与场景验收的 `400` 不一致 | 启动时转 `ValidationError`（`graph.nodes.<id>.expertId`） |
| 访问轮次用尽在结果已接受后抛 `409 invalid_state`，client 会重试同一结果 | 改为置 `run.failed(visit_limit_exceeded)` 后正常返回 `accepted=true` |
| 日志下载缺 spec 要求的 `X-Checksum-Sha256` | 响应头补校验和 |
| 列表 `RunSummary` 泄漏 `workspacePath`/`taskSpacePath`/`autoConfirm`/`error` | 按 §4.1.1 收敛，详情仍返回 |
| `workflow_run` 23 列触发门禁 | 迁移 `0005` 合并结果列、去掉冗余列 |
| `quality-report` 只读建表语句，不应用 `alter table add/drop column` | 按迁移顺序跟踪列集合，`0005` 后表宽为 20 |
| 启动运行缺字段、intent 空或超 256 KiB、`autoConfirm` 非布尔时返回 500/404 | 路由补字段类型校验，领域补 intent 非空与 262144 字节上限，统一 `400 validation_error` |
| `run` 模块 755 行、圈复杂度 28、8 处非空断言 | 拆分模块、去掉断言、复杂度归零 |

## 5 未完成与遗留

| 项 | 说明 | 去向 |
|---|---|---|
| 取消后未认领任务占容量 | client 重启丢掉 in-flight 时，`cancelInstances` 电平会让 client 丢弃重发任务却不结算，同实例新任务被容量挡住（实测约 30 分钟才被 `S-02` 回收） | [`OQ-29`](../../plan/open-questions.md) |
| client 信号测试 | `tests/components/cli/signals.test.ts` 的 SIGINT 用例本机 10s 超时（118/119），与本次契约无关 | client 仓库处理 |
| `split`/`fanout` 执行 | 本期只定义不执行，启动时 `unsupported_node_type` | 第二期 |
| 归档读取端点 | 本期无下载 API，运维按 `archive.root` 访问 | 超出本期范围 |
| 管理面鉴权 | 产品端点仍无鉴权；执行面凭据明文可读回 | 沿用既有风险与 `OQ-23` 结论 |

## 6 任务对照

| 任务 | 状态 | 落点 |
|---|---|---|
| `T-RUN-04` 迁移与配置 | 完成 | `0002`/`0003`/`0005`、`config/[run]`/`[archive]` |
| `T-RUN-05` `CMP-run` 服务 | 完成 | `src/components/run/`、13 例测试 |
| `T-RUN-06` 产品端点与执行面接线 | 完成 | `routes/run.ts`、`routes/executor.ts`、`executor-backend.ts`、openapi |
| `T-RUN-07` DSL 7 类节点 | 完成 | `workflow/graph*.ts`、`dsl.schema.json` |
| `T-RUN-08` 场景测试与 verified | 完成 | 4 张场景卡、`run-*.test.ts` |
| `T-RUN-09` 与 client 联调 | 完成 | 本文件 §3 |
| `T-RUN-10` 契约修订 | 完成 | `executor-http-v3` §11.4、交接件 |

## 7 数据清理

- 联调产生的 run / task / harness 绑定保留在演示库作证据；token 只在 `/tmp/trun09.token`（权限 600），未写入仓库或文档。
- 联调 workspace 在 `/tmp/trun09/`，归档在本仓库 `.local/archive/`（已 ignore）。
- `git status` 干净，提交按「配置/质量工具」「运行编排实现」「文档」拆分。
