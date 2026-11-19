---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-19-confirm-channel-escalation
---

# client 侧实施提案：多契约 prepare / mount / collect（`T-CCE-04`）

> 状态：**待 client 实现**。orchestrator 侧契约与调度已按本提案落地；client 完成后由 orchestrator 做联调（`T-CCE-06`）。
> 结论：`TaskRequest` 增加可选的 `confirmation` 契约；client 一次 attempt 可同时挂 `mcp__agentflow__signal` 与 `mcp__agentflow__confirm` 两个工具，采集时按 `kind` 分别校验。没有 `confirmation` 的旧任务行为不变。

## 1 为什么 client 必须改

orchestrator 已经把 review 节点的任务改成「`resultSignal=review_verdict` + `confirmation=confirmation_request`」，但 client 现在只认一个契约：

- [`src/components/executor/types.ts`](../../../../agent-flow-client/src/components/executor/types.ts) 的 `TaskRequest` 只有 `resultSignal`；
- [`src/components/gateway/wire.ts`](../../../../agent-flow-client/src/components/gateway/wire.ts) 与 [`src/components/cli/request.ts`](../../../../agent-flow-client/src/components/cli/request.ts) 只解析 `resultSignal`；
- [`src/components/executor/signal-runner.ts`](../../../../agent-flow-client/src/components/executor/signal-runner.ts) 的 `prepare` / `openSession` / `collect` 都按单个 `SignalContext` 工作；
- [`src/components/signal/signal.ts`](../../../../agent-flow-client/src/components/signal/signal.ts) 的 `FileSignal.prepare` 把单一 `kind`/`schema` 写进一份 config；
- [`src/components/signal/plan.ts`](../../../../agent-flow-client/src/components/signal/plan.ts) 的 `SignalPlan` / `SignalServerConfig` 是单 `kind`；
- [`src/mcp/signal-server.ts`](../../../../agent-flow-client/src/mcp/signal-server.ts) 的 `tools/list` 按 config 只暴露一个工具，`tools/call` 只认这个工具名。

后果：review prompt 会告诉模型去调 `mcp__agentflow__confirm`，但工具不存在；评审只能直接给 verdict，无法按要求呼人。所以联调前必须把 client 扩成多契约。

## 2 下游契约（orchestrator 已实现，client 按此对接）

poll 响应里的任务新增可选字段：

```ts
type TaskRequest = {
  // ...现有字段
  resultSignal?: ResultSignalContract;   // review=review_verdict（required=true）；agent=confirmation_request（required=true）
  confirmation?: ResultSignalContract;   // 新增：review 额外挂 confirm；kind=confirmation_request，required=false
};

type ResultSignalContract = {
  version: 1;
  kind: "review_verdict" | "confirmation_request";
  required: boolean;
  schema: RestrictedSchema;              // 只描述 data 字段；kind 由工具固定
};
```

- review 任务会同时带 `resultSignal` 与 `confirmation`；agent 任务只带 `resultSignal`；start/end/confirm 不带。
- 两个契约都纳入 `S-05`：同一 `taskId` 重派时原样下发，client 不要按 attempt 重新推导/合并。
- 协议版本仍为 `3`；这是加法字段，client 不认识时按缺省忽略即可（但会失去 review 呼人能力）。

## 3 推荐实现

### 3.1 解析与类型

1. `TaskRequest` 增 `confirmation?: ResultSignalContract`。
2. `src/components/signal/contract.ts` 增 `parseConfirmation(value)`（或复用 `parseResultSignal` 后校验 `kind`）；`SIGNAL_TOOL_NAME_BY_KIND` 与 `SIGNAL_SUPPORTED_KINDS` 已有两个 kind，无需新增映射。
3. `parseTask`（[`wire.ts`](../../../../agent-flow-client/src/components/gateway/wire.ts)）与 CLI 请求解析（[`request.ts`](../../../../agent-flow-client/src/components/cli/request.ts)）各解析一次 `confirmation`；字段缺省/为空对象时视为不存在，不报协议错。

### 3.2 准备与挂载：一个 attempt、一个 server、两个工具

推荐把「一次 attempt 的契约集合」作为 `CMP-signal` 的输入，而不是挂两个 MCP server（同名 server 不能重复挂，工具也会分散到两个 config）：

1. `SignalRunner.prepare(task)`：
   - 收集 `[task.resultSignal, task.confirmation]` 中存在的契约；
   - 逐个用 `isSupportedContract` 判断：`resultSignal` 不支持时沿用现有降级（记 `signal.disabled`，任务按无信号执行）；`confirmation` 不支持时只跳过它并记 `signal.partial`（它是可选契约，不应把任务判失败）；
   - 交给 `FileSignal.prepare({ taskId, attempt, contracts })`，返回一个 `SignalPlan`。
2. `SignalPlan.kind` 改为 `contracts: Array<{ kind: string; schema: RestrictedSchema }>`；`mcpServers` 仍是一个 `agentflow` server。
3. `SignalServerConfig` 改为 `tools: Array<{ kind: string; schema: RestrictedSchema }>`（保留 `version`/`taskId`/`attempt`/`output`/`limits`）。config 是 client 内部文件，可直接换形状，不需兼容旧 config。
4. `signal-server.ts`：
   - `tools/list` 为每个 contract 生成一项，工具名用 `toolNameForKind(kind)`（`review_verdict → signal`，`confirmation_request → confirm`），`inputSchema` 用现有 `toMcpInputSchema`；
   - `tools/call` 按工具名找到对应 contract，校验 `record.kind === contract.kind`，其余写入逻辑不变（同一 `signals.jsonl`、同一 `nextSeq`）。
   - 两个契约的 `kind` 在本期固定不同；若将来出现重复 kind，按配置错误在 `--check` 阶段失败，不要静默覆盖。

### 3.3 采集

1. `FileSignal.collect` 接收 `contracts`，把 `collectSignals(contract, filePath)` 改成按 `kind` 查契约：
   - `kind` 不在已挂契约内 → 该行记为 invalid（不把别人的信号当成自己的）；
   - 其余窗口、去重、16 KiB / 8 条预算逻辑不变。
2. `SignalRunner.collect` 的续跑特判保留：`resumeSessionId` 存在且没有采到信号时，只有「期望的 `resultSignal.kind === confirmation_request`」才记 `signal.not_expected`；review 续跑缺 verdict 仍记 `signal.missing`，让 orchestrator 按 `verdict_invalid` 暴露出来。
3. `TaskResult.signals` 的形状不变，两种 kind 都随 `succeeded` 回传；orchestrator 先看 `confirmation_request`，再看 `review_verdict`。

## 4 兼容与失败语义

| 情形 | 行为 |
|---|---|
| 任务没有 `confirmation` | 与现在完全一致：只 prepare `resultSignal`，只挂一个工具 |
| 任务有 `confirmation`，client 已实现 | 同一 server 暴露两个工具；`tools/list` 两个都在 |
| `confirmation` 不合法/版本不支持 | 跳过该契约并记 `signal.partial`；`resultSignal` 仍按现有逻辑挂载，任务不失败 |
| `resultSignal` 不支持 | 沿用现状：`signal.disabled`，任务按无信号执行 |
| 两个契约都缺省 | 不建信号目录、不挂 server，按旧行为执行 |
| `confirmation` 的 kind 不是 `confirmation_request` | `--check` 失败（`signal_prepare_failed`），不静默改 kind |
| 续跑（`resumeSessionId`） | 仍用 `session/resume`，`mcpServers` 重新传两个工具；不新建 session、失败不退化 |

`required` 字段不参与判定：client 不因为 `required=true` 就伪造信号，也不因为 `required=false` 就跳过采集；是否必须有 verdict 由 orchestrator 结算。

## 5 测试

建议落点（沿用 client 现有组织）：

| 文件 | 断言 |
|---|---|
| `tests/components/signal/contract.test.ts` | `parseConfirmation` 合法/缺省/kind 非法；两个 kind 的工具名与公开名 |
| `tests/components/signal/signal.test.ts` | 两个契约 prepare 生成一份 config，`tools` 两项；只带 `resultSignal` 时仍只有一项 |
| `tests/components/signal/server.test.ts` | `tools/list` 返回 `signal` + `confirm`；`tools/call` 按工具名分派并写同一 `signals.jsonl`；未知工具仍 `-32602` |
| `tests/components/executor/signal-flow.test.ts` | review 任务同时 prepare/mount 两工具；采集混合 kind 结果；旧任务无 `confirmation` 不回归 |
| `tests/components/gateway/wire.test.ts` | poll 响应带 `confirmation` 时解析进 `TaskRequest`；没有时字段缺省 |
| `tests/scenarios/confirm-flow.test.ts` | review confirm → 结果带 `confirmation_request` + `sessionId`；续跑任务仍挂两工具 |

测试要断言具体字段（工具数量、工具名、`signals.jsonl` 的 `kind`、续跑 `sessionId`），不要只断言 `toBeDefined()`。

## 6 验收与联调

client 侧完成标准：

1. review 任务拿到 `resultSignal` + `confirmation` 后，模型可见工具列表同时有 `mcp__agentflow__signal` 与 `mcp__agentflow__confirm`。
2. 调 `confirm` 后 `TaskResult.signals` 含 `confirmation_request`，`status=succeeded` 且带 `sessionId`。
3. 人工 `decide` 后收到的续跑任务 `resumeSessionId` 正确，仍挂两个工具；提交 `review_verdict` 后 orchestrator 正常结算/回退。
4. 没有 `confirmation` 的旧任务（agent/start/end/confirm）行为不变。
5. `bun run check`（typecheck + test + docs:check + quality:gate）通过。
6. 同步 client 仓库的 `docs/design/contracts/executor-http-v3.md` 副本（`TaskRequest.confirmation`、`C-13`/`C-15`/`S-05`/§11.7）。

联调（`T-CCE-06`，client 完成后由 orchestrator 执行）：

- 真实 client + orchestrator：review pass / reject / 无答复 / 取消四条路径；
- Q/A 落 `review.md`，verdict 的 `reason` 引用人答复时标「人工确认」；
- 不通过时先查 client 是否真的挂上两个工具（`signal.prepared` 日志的 kind、`tools/list`），再查 orchestrator 是否把 `confirmation` 冻结进任务。

## 7 不在本次 client 改动内

- 不改 `decide` API/UI；UI 复用现有 `waiting_confirm` 待确认视图。
- 不做通用聊天、不做任意节点呼人；只有 review 额外挂 confirm。
- 不加服务端确认次数计数（v1 由 prompt 约束「每个 review 访问最多 1 问」）。
- 不做旧 client 能力协商：v1 以 client/orchestrator 同版本发布为前提。
