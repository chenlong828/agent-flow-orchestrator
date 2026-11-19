---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-18-review-verdict-mcp
level: P1
---

# 工序：review 节点 verdict 改由 MCP 工具回传

> 用户方向（2026-11-18）：client 在执行模型时提供 MCP 工具，review 节点的判决不再只靠最终消息里的 JSON 约定；模型调用 MCP 工具提交结构化 verdict，client 采集后随结果回传，orchestrator 优先使用工具结果、消息解析作为过渡回退。先只做 review 节点，不做通用控制通道与跨节点消息。
> 本工序是跨项目设计/交接：client 与 orchestrator 的实现分别另起任务；设计未确认前不改代码、不改组件规格。
> 2026-11-18 client 实测反馈：[`review.md`](../../../../agent-flow-client/docs/works/2026-11-18-mcp-signal-feedback/review.md)。关键修正已吸收进 `proposal.md`：公开工具名 `mcp__agentflow__signal`、MCP 不触发权限、MCP 挂载失败 fail-fast（不降级）、server 可能被启动两次需幂等、schema 不能原样用、`CMP-signal` 是 P1 结构候选。
> 2026-11-19 用户决定：没有旧 client，直接移除消息末尾 JSON 回退；`review` verdict 只认 `review_verdict` 信号，skill/专家不再写回退 JSON。下文「过渡期双写」与「兼容矩阵」相关条目按此视为已完成或取消。

## 1 背景

当前 `review` 节点的判定链路是「skill 教模型在最终消息末尾输出裸 JSON → `CMP-run` 用 `parseVerdict` 解析」。解析规则已经兼容裸 JSON、代码围栏与「取最后一个对象」（见 [`verdict.ts`](../../../src/components/run/verdict.ts)），但仍是**事后解析**：

- 模型输出格式漂移时只能在结算阶段发现，非法即以 `verdict_invalid` 判整个 run 失败（见 [`results.ts`](../../../src/components/run/results.ts)）。
- 判定契约分散在 skill 文本与 parser 两处，字段变化没有机器可校验的单一来源。
- `TaskResult` 只有 `message` 字符串，没有结构化的节点结果通道；后续要给其他节点加结果类型时只能继续加文本约定。

client 侧已经具备挂载 MCP 的条件：ACP `session/new` 接受 `mcpServers`，DSH 支持 stdio / streamable HTTP，并在 Agent 发布前挂载（DSH 源码 `packages/acp/acp/src/mcp.ts`；端到端用例 `apps/cli/tests/profiles/acp/tests/control-surface.e2e.ts` 已覆盖挂载、工具调用、resume、cancel）。client 目前只是把 `mcpServers` 写死为空数组（见 [`runtime.ts`](../../../../agent-flow-client/src/components/runtime/runtime.ts)）。

## 2 范围

| 做 | 不做 |
|---|---|
| review 节点：按任务下发 `resultSignal` 契约，client 挂载 MCP server，模型调用 `mcp__agentflow__signal` 提交 `review_verdict` | 其他节点类型的结果信号；通用 `mcp__agentflow__signal` 多 kind 的完整落地 |
| client 采集信号并随 `P-02` 回传；review 信号优先、消息解析回退 | 执行中即时生效的信号端点；进度、取消等控制指令 |
| `task.result_signal` 持久化、`TaskRequest`/`TaskResult` 加法字段、client `CMP-signal` 组件 | 跨节点消息总线、fan-out 并发节点通信 |
| skill 过渡期双写（有工具走工具，无工具仍输出末尾 JSON） | 直接切换为「只认工具、不再解析消息」 |
| 契约、兼容矩阵、测试计划、client 实施清单 | 改 `CMP-scheduler` 的派发/重派/结果接受语义；改 UI |
| `agent` 节点的 `confirmation_request` 确认点：暂停 `waiting_confirm`，`resumeSessionId` 续跑 | 阻塞式 MCP 问答；跨节点消息总线 |

## 3 验收标准

设计阶段（本工序当前阶段）：

1. `proposal.md` 写清：问题、范围、MCP 方案、契约 diff、client/orchestrator 落点、兼容与发布、安全与风险、测试与任务表。
2. 明确「工具结果是事实、编排规则仍由 `CMP-run` 决定」；MCP 工具不得直接调用调度器接口。
3. 明确 verdict 唯一通道：MCP `review_verdict` 信号；旧 client 兼容矩阵按 2026-11-19 决定取消。
4. 与用户完成 P1 确认；确认前不改组件规格、不写实现代码。

实现阶段（确认后）：

5. client：`session/new` 按任务挂载 MCP server；信号文件按 attempt 隔离；采集、校验、随结果上报；MCP 准备/挂载失败即任务失败，不降级。
6. orchestrator：`task.result_signal` 迁移与下发；`P-02` 接受 `signals`；`CMP-run` 信号优先、消息回退。
7. skill：`review-verdict` 过渡期双写；种子测试同步。
8. `SCN-0302` 增加信号路径断言；真实 client + DSH 的 review pass/fail/invalid 端到端验证通过。

实现阶段（2026-11-18，orchestrator 侧）：

9. 契约、迁移、scheduler/网关/run 信号与确认点完成；`bun run check` 422 pass / 0 fail。
10. review 信号优先/消息回退、agent 确认点 `waiting_confirm`、`resumeSessionId` 续跑均有集成测试。
11. `review-verdict` 技能 v1.8 改为优先 MCP 工具、无工具回退消息 JSON。
12. 真实 client + DSH 四条主路径（review pass/fail、confirmation pass/reject）已通过；兼容/失败矩阵与 `session/resume` 失败策略仍待补。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-RVM-01` | design | global | 本提案与问题/契约/兼容盘点 | 完成 |
| `T-RVM-02` | verify | client（跨项目） | MCP spike：挂载、工具名、权限、启动失败、进程回收 | 完成 |
| `T-RVM-10` | design | client（跨项目） | P1 结构决策：`CMP-signal` 新 L0 vs 扩展；定 `SignalPort`/数据所有权/清理 | client 已实现，待回填结构决策记录 |
| `T-RVM-03` | change | client（跨项目） | signal server（幂等/续号/schema 投影）+ 选定落点 + 测试 | client 完成 |
| `T-RVM-04` | change | client（跨项目） | runtime 可选 `mcpServers`、`AcpProtocol` 透出 details、executor 采集/同参重建一次、错误归因、result 预算、超时配置 | client 完成 |
| `T-RVM-05` | change | scheduler/http-gateway | `task.result_signal`/`resume_session_id` 迁移、`TaskDraft`/`TaskEnvelope`/`ExecutorTask` 透传、`P-02` signals | 完成 |
| `T-RVM-06` | change | run | review 信号优先/回退、agent 确认点 `waiting_confirm`、`resumeSessionId` 续跑、测试 | 完成 |
| `T-RVM-07` | change | scripts/seed | `review-verdict` 技能 v1.9 只走 MCP 信号；`implementation-accept` v1.8 与种子专家定义同步；种子测试 | 完成 |
| `T-RVM-08` | verify | global | 真实 client 联调、`SCN-0302` 更新、失败路径验证 | 四条主路径真实联调通过，测试资产与 run 已清理；失败路径待补；旧 client 兼容矩阵已取消 |
| `T-RVM-09` | change | run | 执行中临时确认点（MCP confirm signal + `waiting_confirm` + `resumeSessionId` 续跑），见 [`human-interaction.md`](human-interaction.md) | 完成；真实 client pass/reject 续跑通过 |
| `T-RVM-11` | change | scripts/seed | 临时新增 `mcp-review`/`mcp-confirm` 技能、MCP 专家、三条联调流程与 `e2e:mcp` 驱动；验证后已清理 | 完成并清理 |

## 5 装载清单

- 本工序提案：[`proposal.md`](proposal.md)
- 实现结果：[`result.md`](result.md)
- UI 对接提案：[`ui-integration-proposal.md`](ui-integration-proposal.md)
- 自审：[`review.md`](review.md)
- 执行中人工问答（另立 P1）：[`human-interaction.md`](human-interaction.md)
- 现状契约：[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md)、[`run/spec.md`](../../design/components/run/spec.md)、[`scheduler/spec.md`](../../design/components/scheduler/spec.md)
- 现状场景：[`SCN-0302`](../../design/scenarios/workflow-orchestration/workflow-execution/review-verdict-and-rollback/scenario.md)
- orchestrator 代码：[`verdict.ts`](../../../src/components/run/verdict.ts)、[`results.ts`](../../../src/components/run/results.ts)、[`advance.ts`](../../../src/components/run/advance.ts)、[`executor-request.ts`](../../../src/components/http-gateway/routes/executor-request.ts)、[`executor-backend.ts`](../../../src/executor-backend.ts)
- client 代码：[`runtime.ts`](../../../../agent-flow-client/src/components/runtime/runtime.ts)、[`executor.ts`](../../../../agent-flow-client/src/components/executor/executor.ts)、[`result`](../../../../agent-flow-client/src/components/result)、[`gateway/wire.ts`](../../../../agent-flow-client/src/components/gateway/wire.ts)
- client 架构：[`architecture.md`](../../../../agent-flow-client/docs/design/architecture.md)、[`CMP-runtime/spec.md`](../../../../agent-flow-client/docs/design/components/CMP-runtime/spec.md)
- DSH 证据（源码，不随仓库分发）：`packages/acp/acp/src/mcp.ts`、`apps/cli/tests/profiles/acp/tests/control-surface.e2e.ts`

## 6 待定

| 项 | 为什么不阻塞设计 | 去向 |
|---|---|---|
| 工具公开名 | **已定**：`mcp__agentflow__signal`；`agentflow_signal` 只作语义别名 | `T-RVM-02` |
| client `CMP-signal` 是否新增 L0 | 是 P1 结构决策，不能默认；先定 `SignalPort`/数据所有权 | `T-RVM-10` |
| 信号文件与信号的最终大小上限 | 先给 16 KiB 总量预算，按实测调整 | `T-RVM-03` / 提案 §3.2 |
| 是否把 verdict 来源（signal/message）落库 | v1 只记结构化日志，不改 `run_node` 列 | 提案 §12 |
| 是否/何时移除消息末尾 JSON 回退 | 需要等 client 最低版本覆盖后另立工序 | 提案 §8 |
| 执行中临时确认点 | 用 MCP confirm signal + 现有 `waiting_confirm`/`decide`；不阻塞、不新增端点、不改 scheduler | [`human-interaction.md`](human-interaction.md) / `T-RVM-09` |
| 跨节点传递 | 当前 run 串行，task-space 文件已够用 | `plan/open-questions.md` 后续 |
