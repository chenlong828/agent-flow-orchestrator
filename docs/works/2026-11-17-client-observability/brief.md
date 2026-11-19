---
layer: works
module: global
status: active
updated: 2026-11-17
procedure: 2026-11-17-client-observability
level: P1
---

# 工序：client 只读观测面修正（session 为主 + 少量 attempt + 运行文件）

> 用户方向（2026-11-17）：调度面已有更丰富的 attempt/task 信息，client 观测面**以 session（执行节点）为主**，只保留少量薄 attempt；session 代理与文件都做。orchestrator 不再走 poll 反向请求，改为直连 client 观测面。默认不走 token、本地透传、监听 `127.0.0.1`；`serve` 观测面失败降级；v1 先不设业务上限。
> 本工序是跨项目设计/交接；client 与 orchestrator 的实现分别另起任务。

## 1 背景

client 仓库已有一份「只读观测 HTTP」P1 稿（`agent-flow-client/docs/works/2026-11-06-observability-http/proposal.md`），但它是 **attempt 为主**：health、attempts、attempt 日志、attempt SSE、session、events、raw。调度面已有 `task`/`task_attempt`/`run_node` 的更完整 attempt 信息，client 再提供 attempt 会重复。P1 尚未实现，且有几个与本需求冲突的约束：

- **发现**：v1 选择「调度器侧配置 base URL」，不自动注册；多 client 时配置成本高。
- **鉴权**：token 可空，默认 `0.0.0.0`；文件浏览会把工作区文件放到入站面，风险不可接受。
- **层级**：P1 以 attempt 为键；本次应改为 session 为键，attempt 只保留薄视图/关联。
- **文件**：只提供 session/attempt 视角，没有运行文件列表/读取；P1 还明确「不提供文件系统路径参数」。
- **运行身份**：`TaskRequest` 没有 `runId`，client journal 也不存 workspace/task-space 路径；client 无法把 `runId` 映射到文件根。

同时，orchestrator 的 poll 反向请求方案虽然 NAT 友好，但需要新增执行面字段、回传端点、请求代理与唤醒。用户决定把复杂度移到 client 观测面，让 client 成为 **session 级**观测提供方。

## 2 范围

| 做 | 不做 |
|---|---|
| 修正 client 观测面 P1：session 端点、薄 attempt、鉴权、发现、run 映射、文件端点、错误/限制占位 | 在本仓库实现 client 代码（client 仓库另起工序） |
| `O-09` 运行文件列表、`O-10` 运行文件内容（run-scoped） | 写/编辑/上传/删除、终端、控制面端点 |
| `O-01`–`O-08`：health、薄 attempt 列表/详情、session 列表/详情/事件/SSE/raw | attempt 日志/SSE（由调度面拥有）；attempt 状态机 |
| `TaskRequest.runId` 与 client 运行注册表（runId → workspace/task-space） | 任意绝对路径读取、跨 run 读取、文件系统浏览 |
| orchestrator 侧 `CMP-observability-client` 适配器与产品 API 映射 | 改 `CMP-scheduler` 的派发/任务表；改 `run` 的编排状态机 |
| 发现（`X-Observability-Url` + 静态配置）、鉴权（复用 executor token）、默认 loopback、失败降级 | TLS/mTLS、token 轮换、跨公网部署（v1 依赖同机/同网段或隧道） |
| 运行文件浏览的 UI/DTO 口径（沿用 `REQ-0002` 产品 API） | UI 代码改动（独立项目） |
| 契约 diff、测试计划、client 实施清单、发布/回滚 | 运行结束后从归档浏览、confirm 自动快照、文件下载（另行评估） |

## 3 验收标准

设计阶段（本工序当前阶段）：

1. 修正提案写清：P1 差异、session + 薄 attempt 端点、run 注册表、文件端点、session 代理、发现/鉴权/网络、client/orchestrator 组件落点、契约 diff、测试、发布顺序、回滚、风险。
2. 明确 **client 实现 session 级观测面** 的边界：只读、session/run-scoped、无任意路径、无控制、attempt 仅薄视图。
3. 明确 orchestrator 不再需要 poll 文件字段/回传端点；产品 API 与 UI 不变。
4. 与用户完成 P1 确认；确认前不改组件规格、不写实现代码。

实现阶段（确认后）：

5. client 实现 `O-01`–`O-10`（session 为主 + 薄 attempt + 文件），默认 loopback、`auth=off` 本地透传；运行注册表与文件端点通过测试。
6. orchestrator 实现适配器、`runId` 富化、URL 注册、文件 + session 代理；无数据库迁移。
7. `SCN-0305` 3+1 与 `SCN-0303` 新增断言通过；client 测试通过。
8. UI 节点弹层「文件」Tab 可列 task-space/workspace、预览 Markdown/代码。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-COBS-01` | design | global | P1 差异盘点、session 端点、运行注册表与文件端点方案 | 完成 |
| `T-COBS-02` | design | global | 修正提案：端点、契约、安全、组件、测试、发布 | 完成 |
| `T-COBS-03` | design | global | 与用户确认发现/鉴权/默认绑定/组件拆分 | 待确认 |
| `T-COBS-04` | design | client（跨项目） | client 观测面实施清单与测试计划 | 待确认 |
| `T-COBS-05` | design | run | orchestrator 适配器与产品 API 映射方案 | 待确认 |
| `T-COBS-06` | change | client（跨项目） | 实现 `O-01`–`O-10`（session 为主 + 薄 attempt + 文件）、运行注册表、鉴权/发现/降级 | 待确认 |
| `T-COBS-07` | change | run/http-gateway | `CMP-observability-client` 适配器、`runId` 富化、URL 注册；文件 + session 代理 | 待确认 |
| `T-COBS-08` | verify | global | 契约测试、真实 client 联调、文件 + session 代理、`SCN-0305`/`SCN-0303` | 待确认 |

## 5 装载清单

- client P1：[`agent-flow-client/docs/works/2026-11-06-observability-http/proposal.md`](../../../../agent-flow-client/docs/works/2026-11-06-observability-http/proposal.md)
- client 架构：[`agent-flow-client/docs/design/architecture.md`](../../../../agent-flow-client/docs/design/architecture.md)、[`components/CMP-observability/spec.md`](../../../../agent-flow-client/docs/design/components/CMP-observability/spec.md)、[`components/CMP-workspace/spec.md`](../../../../agent-flow-client/docs/design/components/CMP-workspace/spec.md)
- 执行面契约：[`docs/design/contracts/executor-http-v3.md`](../../design/contracts/executor-http-v3.md)
- orchestrator 侧：[`src/components/run/service.ts`](../../../src/components/run/service.ts)、[`src/components/http-gateway/routes/run.ts`](../../../src/components/http-gateway/routes/run.ts)、[`src/executor-backend.ts`](../../../src/executor-backend.ts)、[`src/main.ts`](../../../src/main.ts)
- 本工序提案：[`proposal.md`](proposal.md)
- 文件浏览产品面：[`2026-11-17-run-file-browser/design-proposal.md`](../2026-11-17-run-file-browser/design-proposal.md)

## 6 待定

| 项 | 为什么不阻塞 v1 | 去向 |
|---|---|---|
| 跨公网/NAT 访问 | v1 依赖同机/同网段或隧道；client 仍可出站执行 | 本提案 §7；部署要求 |
| TLS/mTLS、token 轮换 | v1 默认 loopback；跨机走隧道/反代 | 后续安全工序 |
| 单独观测 token | v1 复用 executor token；少一个秘密 | 后续按最小权限再拆 |
| 文件下载/二进制预览 | v1 只列目录/读文本 | 后续评估 |
| 运行结束后归档浏览 | 观测面只覆盖 client 本地 task-space | `OQ-34` |
| confirm 自动快照 | 审核期 client 通常在线 | `OQ-35` |
| 敏感文件策略 | v1 run-scoped、只读、token；不隐藏 | `OQ-36` |

## 7 影响

- 取代 [`2026-11-17-run-file-browser`](../2026-11-17-run-file-browser/brief.md) 中的 **poll 反向请求传输**；产品 API、DTO、UI 与错误口径仍沿用；业务限制 v1 关闭。
- 执行面契约新增 `TaskRequest.runId` 与 `X-Observability-Url` 请求头；**不新增执行面端点**、不升协议版本。
- client 观测面从 attempt 为主改为 **session 为主 + 薄 attempt**；attempt 日志/SSE 归调度面；文件端点 `O-09`/`O-10`；orchestrator 产品面 6 个（文件 2 + session 代理 4）。
- orchestrator 新增 `CMP-observability-client` 适配器；`CMP-scheduler` 不变；无数据库迁移。
