---
layer: works
module: global
status: active
updated: 2026-11-18
procedure: 2026-11-18-review-verdict-mcp
level: P1
---

# 提案：review 节点 verdict 改由 MCP 工具回传（client 实现）

> 状态：**P1 提案，未冻结**。目标读者是 `agent-flow-client` 的实现者；本仓库的 orchestrator 改动由另一组任务承接。
> 结论：**先只做 review 节点的 `review_verdict`，用 client 提供的 MCP 工具承载结构化判决；`TaskResult` 走现有 `P-02` 回传，不新增执行中端点；`CMP-run` 信号优先、消息解析回退；v1 保留双写，等 client 最低版本覆盖后再收紧。**
> 本文不改代码、不改组件规格、不建迁移；确认后按 §11 任务表拆分。

## 0.1 client 实测反馈吸收（2026-11-18）

> 反馈来源：[`agent-flow-client/docs/works/2026-11-18-mcp-signal-feedback/review.md`](../../../../agent-flow-client/docs/works/2026-11-18-mcp-signal-feedback/review.md)（DSH `0.2.2-alpha.2` 实测）。本提案已按反馈修订；下面只列会改变实现的项。

| 反馈 | 处置 |
|---|---|
| `S-01` 工具公开名是 `mcp__agentflow__signal`，不是 `agentflow_signal` | 全文的模型可见名统一改为 `mcp__agentflow__signal`；`agentflow_signal` 只作语义别名。skill/验收/日志按公开名写 |
| `S-02` MCP 工具调用不触发 `session/request_permission`；即使触发，payload 也不含工具名 | 删除「只放行 `agentflow_signal`」的权限设计；MCP 工具不受 client 现有权限裁决。若 DSH 未来改为逐次审批，需先让 payload 带工具名 |
| `S-04` 挂载失败的可见文本只有 `error.data.details="mcp-client(agentflow): initial connection or tool synchronization failed"` | 不用「无 MCP 重试/降级」；同一 attempt 用**相同 `mcpServers`** 重建 session 一次（`Q-07`），仍失败才报 `failed(protocol, signal_mount_failed)`，不回退消息。`details` 用于错误归因（`Q-09`） |
| `S-07` `server/discover` 静默忽略会让探针等 60s，`-32601` 约 8ms 回落 | server 必须立即回 `-32601`（或实现协议）；测试断言挂载 ≤2s（`A-11`） |
| `S-05` 一次 `session/new` 观察到两个 server 进程（第一个 initialize 后被 SIGTERM） | 这是 MCP SDK 的 `mode:'auto'` 协商：第一个进程收到 `server/discover` 探针后被 SDK 关闭，第二个走 legacy `initialize`；不是 client 要求启动两次，而是 server 必须**容忍被启动两次**：不清空文件、不持跨启动独占锁、`seq` 从文件最大行续号 |
| `S-06` 挂 MCP 的 `session/new` 仍是秒级 | 保留；`session/new` 超时从硬编码 10s 提为配置项，给慢机器留余量 |
| `A-01` `RestrictedSchema` 不能直接当 MCP `inputSchema` | 增加 `toMcpInputSchema` 投影：只传 `type/properties/required/additionalProperties/items/enum/const/description`；`maxLength`/`maxItems`/`minimum` 与 `string[]` 由 server 自己执行/展开 |
| `A-02` 新增 `CMP-signal` 是 L0 结构变更 | 先做 client P1 结构决策（新 L0 vs 扩展现有组件）；本提案给候选，不默认成立 |
| `A-03` `RuntimePort.newSession` 只做可选参对象加法 | 采用 `newSession(instance, cwd, opts?: { mcpServers?: ... })`，不加位置参数 |
| `A-04` 结果预算应整体计算 | `message + signals` 整体 ≤ `maxResultBytes`；signals 超 16 KiB 整段丢弃，不截断 reason；`truncated` 仍只描述 message |
| `A-05` `collect` 要在 `closeSession` 之前 | 顺序改为 prompt 结束 → collect → close；collect 异常吞掉并记 `signal.invalid` |
| `A-06` server 可能被启动两次 | 见 `S-05`：幂等启动 + 续号，不是设计上要求两次 |
| `A-07` `session/new` 超时可配置 | 新增 client 配置项；默认仍 10s，可调 |
| `A-08` 删除权限放行 | 见 `S-02`；风险表同步改 |
| `A-09` 客户端承诺编号顺延 | 提案改用 `C-13`/`C-14`，不跳号 |
| `A-10` 预检与挂载共用同一入口 | `--check` 与 `mcpServers` 配置由同一构造函数生成，避免两套校验；预检放在任务 `prepare`，不做 `serve` 启动门禁（`Q-08`） |
| `Q-07` fail-fast 是否同一 attempt 重试一次 | **采纳 (b)**：相同 `mcpServers` 重建 session 一次；仍失败才任务失败 |
| `Q-08` 删 `signal_unavailable` 与启动退出 | **采纳**：删掉客户端的 `signal_unavailable`/`serve` 退出分支；挂载失败只逐任务报错，`serve` 继续。启动预检简化为任务 `prepare` 的 `--check` |
| `Q-09` MCP 失败与 DSH/实例失败分开归因 | **采纳**：`error.data.details` 命中 `mcp-client(<serverName>)` 才报 `signal_mount_failed`；其他按 `spawn_failed`/`process_exited`/`protocol_error` 报，`serve` 继续 |
| `A-13` 新错误码进契约 | `signal_prepare_failed`/`signal_mount_failed`，`class=protocol`，写入 v3 §4.2 #4 |
| `A-15` `run` 与 `serve` 同语义 | 单次 `run` 也走同一 prepare/collect/失败逻辑，不单独分叉 |

待拍板项在 §12 给出本提案的默认处置。

## 0 一句话

review 节点的 verdict 从「skill 约定模型在最终消息末尾写 JSON，服务端事后解析」改为「client 给本次 session 挂一个 MCP 工具，模型调用工具提交结构化 verdict，client 采集后随 `P-02` 回传，`CMP-run` 校验并决定推进/回退/等待人工确认」。工具承载**事实**，编排规则仍由 `CMP-run` 决定。

这里的「调度层操作」指 **`CMP-run` 的节点编排操作**，不是让 `CMP-scheduler` 理解 `review_verdict`：
- `CMP-scheduler` 仍只做任务生命周期（`acceptResult` 标记 `done`），不解析 verdict、不做回退；
- `CMP-run` 的 signal router 把 `pass` 映射到推进、`fail` 映射到驳回+回退；
- 让 scheduler 理解 verdict 会形成第二套工作流引擎，违反现有依赖方向（`scheduler → run/workflow` 是禁止边）。

## 1 问题与目标

### 1.1 现状

- `CMP-run` 在 review 节点结算时调用 `parseVerdict(message)`，取消息末尾窗口内最后一个合法 JSON 对象（[`verdict.ts`](../../../src/components/run/verdict.ts)）；缺失/非法时节点 `failed(verdict_invalid)`，整个 run 失败（[`results.ts`](../../../src/components/run/results.ts)）。
- 执行面契约把 verdict 放在 `message` 末尾，client 不解析、不改写（[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md) §4.2 第 5 条）。
- 结果是**事后解析**：模型格式漂移只能在结算阶段发现，不能在同一次 session 内纠正；判定契约分散在 skill 文本与 parser 两处。
- client 目前 `session/new` 固定传 `mcpServers: []`（[`runtime.ts`](../../../../agent-flow-client/src/components/runtime/runtime.ts)），尚未使用 MCP 工具。

### 1.2 目标

1. review 节点的判决由模型调用 MCP 工具提交，工具在调用时按 schema 校验；错误可以回给模型修正。
2. client 把工具调用结果采集为结构化信号，随 `TaskResult` 回传；不新增执行中端点。
3. `CMP-run` 优先使用信号，消息末尾 JSON 作为过渡回退；信号与消息冲突时信号优先。
5. 兼容四种新旧组合，不要求 client/orchestrator 同时升级。
6. 为后续其他节点/其他信号留出契约位置，但**本轮不实现**通用多 kind 与实时交互。

### 1.3 非目标

- 不做执行中**阻断式**问答：模型调用工具后必须等人工回答、同一 session 继续执行。这需要新的交互端点/任务状态/超时语义，见 §5.5。
- 不做执行中进度、取消、跳转等控制信号。
- 不做跨节点消息总线；当前 run 串行，跨节点上下文仍用 task-space 文件。
- 不做其他节点类型的 result signal；不做多 kind 的通用 `mcp__agentflow__signal`。
- 不让 MCP 工具直接调用调度器/`CMP-run` 的 HTTP 接口。
- 不改 `CMP-scheduler` 的派发、重派、结果接受语义；不改 UI 代码。
- 不把 verdict 的判定标准从 skill 移到工具描述；skill 仍负责「审什么、怎么算过」。

## 2 方案总览

```
CMP-run (review)
  │ TaskRequest.resultSignal = { version, kind:"review_verdict", required, schema }
  ▼
client
  ├─ CMP-signal.prepare：生成信号目录、config.json，预检 signal server
  ├─ CMP-runtime.newSession(..., mcpServers:[agentflow])
  │     └─ DSH 在 Agent 发布前挂载 stdio MCP server
  ├─ 模型调用 mcp__agentflow__signal({kind, verdict, reason, evidence?})
  │     └─ signal server 校验 → 追加 signals.jsonl（fsync 后 ack）
  ├─ prompt 结束 → CMP-signal.collect：读文件、校验、按 seq 排序
  ├─ CMP-result：signals 加入 TaskResult，message 预算扣除 signals 字节
  └─ P-04 日志 → P-02 { message, signals[] }
  ▼
CMP-run.applyReview
  ├─ signals 中有合法 review_verdict：
  │    ├─ pass → succeeded → 推进
  │    └─ fail → rejected → 回退
  ├─ 否则 parseVerdict(message) → 回退
  └─ 都没有/都非法 → failed(verdict_invalid)
```

### 2.1 为什么用 MCP，而不是继续扩 parser

- 调用时校验：工具 schema 拒绝错误参数，模型可在同一 session 内修正；parser 只能事后判失败。
- 单一契约：工具 input schema 由 orchestration 侧按任务下发，client 不需要知道 `review` 的语义；字段变化只改契约与校验一处。
- 可审计：工具调用在 session 日志与信号文件中都有记录；消息正文只作叙述。
- ACP 已有标准入口：`session/new.mcpServers`；DSH 已实现 stdio/HTTP 挂载，且端到端用例覆盖工具调用（DSH 源码 `packages/acp/acp/src/mcp.ts`、`apps/cli/tests/profiles/acp/tests/control-surface.e2e.ts`）。

### 2.2 为什么仍然保留 skill

工具只回答「怎么把结论交出来」；「审什么、证据够不够、pass/fail 的标准」仍是 skill/专家知识。MCP 工具描述应短，不承载长流程；否则只是把提示词换了个位置。

## 3 契约设计

### 3.1 `TaskRequest.resultSignal`（新增，可选）

由 `CMP-run` 为 review 节点生成；其他节点不带。scheduler 将其视为 opaque JSON，持久化到 `task.result_signal`，随 `TaskEnvelope`/`ExecutorTask` 透传。

```ts
type ResultSignalContract = {
  version: 1;
  kind: "review_verdict";
  required: boolean;          // v1 为 true；client 不强制，run 用于审计/后续收紧
  schema: RestrictedSchema;   // 只描述 data 字段；kind 由工具固定
};

type RestrictedSchema = {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, RestrictedField>;
};

type RestrictedField =
  | { type: "string"; enum?: string[]; minLength?: number; maxLength?: number; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "number"; minimum?: number; maximum?: number; description?: string }
  | { type: "string[]"; maxItems?: number; maxLength?: number; description?: string };
```

review 节点的具体值：

```json
{
  "version": 1,
  "kind": "review_verdict",
  "required": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["verdict", "reason"],
    "properties": {
      "verdict": { "type": "string", "enum": ["pass", "fail"], "description": "审核结论" },
      "reason": { "type": "string", "minLength": 1, "maxLength": 8192, "description": "通过依据、可执行的回退理由，或需要人工确认的具体事项" },
      "evidence": { "type": "string[]", "maxItems": 16, "maxLength": 512, "description": "证据：文件路径/命令/测试结果" }
    }
  }
}
```

- v1 **单 kind**。多 kind 需要 `version: 2` 的契约与工具 schema 组合，本轮不做。
- 模型可见工具名是 **`mcp__agentflow__signal`**（`mcp__<serverName>__<rawName>`；实测 `S-01`）。`agentflow_signal` 只作为语义别名出现在描述/文档里，skill 与验收按公开名写。
- `RestrictedSchema` 是受限子集，不是完整 JSON Schema；client 不需要引入 JSON Schema 依赖。生成与校验两端共用同一组类型定义/测试向量。
- **不能把 `RestrictedSchema` 原样作为 MCP `inputSchema`**（`A-01`）：`string[]` 要展开成 `{type:"array",items:{type:"string"}}`；`maxLength`/`maxItems`/`minLength`/`minimum` 是执行约束，不进入 schema（DSH 不裁剪也不校验这些关键字）。server 负责字节/条数/枚举校验。
- `required: true` 时 client **不补提醒 prompt**：模型没调用就记 `signal_missing`、不上报 signals，run 走消息回退（`Q-02` 默认 a）。补一轮 prompt 会改变任务时长/usage 口径，收益不成比例。
- `maxLength`/`maxItems` 按 UTF-8 字节还是字符？v1 统一按 **UTF-8 字节** 计，避免中文理由被按字符放大；实现与测试写清楚。

### 3.2 `TaskResult.signals`（新增，可选）

```ts
type TaskSignal = {
  seq: number;          // 本次 attempt 内从 1 单调递增
  at: string;           // ISO-8601 UTC
  kind: "review_verdict";
  data: {
    verdict: "pass" | "fail";
    reason: string;
    evidence?: string[];
  };
};
```

- 只在 `status === "succeeded"` 时出现在结果里；失败/超时/取消不带信号（工具调用仍可在 session 日志中查到）。
- 只在本次任务收到 `resultSignal` 且 client 成功采集时出现；没有契约、模型未调用、采集失败时**省略该字段**，不传空数组；MCP 挂载失败是任务失败，不进入结果组装。
- 同一 kind 多次调用：client 按 `seq` 取**最后一个合法信号**；与当前「消息末尾最后一个 JSON」语义一致。信号文件保留全部行，便于排查。
- **attempt 归属写死**（`Q-06`）：信号只属于本次 `taskId+attempt`；重派 `attempt+1` 建新目录，旧 attempt 文件保留但永不被读取。
- 总预算：`signals` ≤ 16 KiB、≤ 8 条、单条 `reason` ≤ 8 KiB、`evidence` ≤ 16 项 × 512 B。`P-02` body（`message + signals + JSON 开销`）必须 ≤ `maxResultBytes`（256 KiB）；signals 自身超 16 KiB 时**整段丢弃**，不截断 reason；`truncated` 仍只描述 message（`A-04`）。
- `signals` 对老服务端不可见：新 client 只在收到 `resultSignal` 时才发送；老 orchestrator 不会发该字段，所以不会触发老网关的未知字段 400。

### 3.3 兼容与能力协商

**`TaskRequest.resultSignal` 的存在就是能力开关**，不新增协议版本或额外请求头：

| orchestrator | client | 行为 |
|---|---|---|
| 旧 | 旧 | 现状：skill 输出末尾 JSON，run 解析 |
| 新 | 旧 | 新 run 发 `resultSignal`；旧 client 忽略未知字段，不挂 MCP；skill 仍输出末尾 JSON；run 回退解析 |
| 旧 | 新 | 旧 run 不发 `resultSignal`；新 client 不挂 MCP、不发送 `signals`；skill 仍输出末尾 JSON |
| 新 | 新 | MCP 工具 + signals；run 信号优先，消息回退 |

前提：client 的 `parseTask` 对未知字段保持忽略（当前实现如此，见 [`wire.ts`](../../../../agent-flow-client/src/components/gateway/wire.ts)）；服务端 `P-02` 字段白名单只在新增后接受 `signals`，旧服务端不会收到该字段。**不要**改成「新 client 无条件发送 signals」，否则旧 orchestrator 会 400。

### 3.4 错误与回退语义

先分清两类失败：

- **基础设施失败**（signal server 缺失、`--check` 失败、`session/new` 挂载失败）：**不降级**；挂载失败先按相同 `mcpServers` 重建一次（`Q-07`），仍失败则任务 `failed(protocol, signal_*_failed)`，run 失败；不重试无 MCP、不解析消息。MCP 是 review 任务的必需能力，静默降级会让链路不闭环。
- **模型行为失败**（模型没调用、调用参数非法后未修正、信号 data 非法）：client 记为 `signal_missing` / `signal_invalid`，不上报 signals；run 回退消息解析。

具体：

- 工具参数非法：signal server 返回 `isError: true`，错误文本指明字段与期望；模型可重试。client 不因单次工具错误把任务判失败。
- 模型始终没调用工具：client 记 `signal_missing`，不上报 signals；run 回退消息解析。`required: true` 不在 client 侧升级为失败或补一轮 prompt（`Q-02` 默认 a）。
- 没有合法信号：client 不上报 `signals`；run 回退消息解析。
- 信号存在但 `data` 非法：run 记 `signal_invalid` 日志，回退消息解析；消息也非法才 `failed(verdict_invalid)`。
- 信号与消息冲突：信号优先，run 记 `verdict_conflict` 日志（不改变 `run_node.verdict` 形状，不新增列）。
- `evidence` 是信号的一部分，会进 `TaskResult.signals`、client journal 的 `TaskRecord.result`、观测面 settle 事件与 `run_node.verdict`；内容按现有观测脱敏规则处理，不新增“隐藏 evidence”策略（`Q-04` 默认）。因此 skill 要求 evidence 只写路径/命令/测试结果，不写凭据。
- 信号 `pass`/`fail` 仍只决定 `succeeded`/`rejected`；回退目标、visit 上限、缺失回退边仍由 `CMP-run` 按图规则处理（[`run/spec.md`](../../design/components/run/spec.md) §4.5）。
- 信号只在 `status=succeeded` 时应用；失败/超时/取消不应用。
- **`CMP-scheduler` 没有 `review_verdict` 对应的操作**：它只把任务标记 `done`。verdict → 推进/回退/等待的映射在 `CMP-run`；跨组件加这个操作会把工作流语义塞进 scheduler。

## 4 Client 实现

### 4.1 组件与端口

新增 client L0 组件 `CMP-signal`（planned）**是候选，不是既定结论**（`A-02`）：client `architecture.md` 当前记录 9 个组件，新增第 10 个 L0 属于 P1 结构变更。开工前先在 client 侧做一次结构决策，候选：

1. **新增 `CMP-signal`（L0）**：独占 `<stateRoot>/signals/`，负责目录/config、预检、采集、清理；`CMP-executor` 通过 `SignalPort` 调用。职责最干净，但增加组件与装配。
2. **扩展 `CMP-result` / `CMP-runtime`**：不新增组件，但 `CMP-result` 是纯策略、无 I/O；`CMP-runtime` 管 DSH 进程/session，不应承担结果语义。容易把文件 I/O、schema 校验塞进错误的层。
3. **折中：`CMP-executor` 内置一个内部模块**：不新增组件，但会把文件/schema 细节塞进 L1b，违反「纯策略 vs I/O」分界。

推荐 1，并按 P1 走 client 结构确认；本提案其余部分按「`SignalPort` + L0 实现」写，若结构决策选 2/3，只改落点，不改契约。

```ts
// CMP-executor 定义端口；组合根注入 L0 实现
type SignalPort = {
  prepare(input: { taskId: string; attempt: number; contract: ResultSignalContract }): Promise<SignalPlan>;
  collect(input: { taskId: string; attempt: number; plan: SignalPlan }): Promise<TaskSignal[] | undefined>;
  disable(plan: SignalPlan, reason: string): void;
};
```

`CMP-runtime` 的端口只做可选参对象加法（`A-03`）：

```ts
newSession(instance: InstanceHandle, cwd: string, opts?: { mcpServers?: McpServerSpec[] }): Promise<SessionRef>;
```

| 单元 | 职责 | 不负责 |
|---|---|---|
| `CMP-signal`（L0，候选） | 生成 per-attempt 信号目录/config；构造 `mcpServers`；预检 server；读取/校验 `signals.jsonl`；清理 | MCP 工具语义、run 判定、DSH 进程 |
| `CMP-runtime`（L0） | `newSession(instance, cwd, opts?)`；把 `mcpServers` 原样传给 ACP | 信号 schema、结果组装 |
| `CMP-executor`（L1b） | 决定是否启用信号；调用 prepare/collect；MCP 准备/挂载失败同参重建一次、仍失败则任务失败；把 signals 交给 result | 工具 schema 校验细节 |
| `CMP-result`（L1a） | `TaskResult.signals` 组装；`message + signals` 整体字节预算 | 文件/进程 |
| `CMP-gateway`（L0） | `parseTask` 读入 `resultSignal`；`reportResult` 对象透传（`V-03`：现有实现已直接把 `TaskResult` 当 body，无需为 signals 改序列化） | 语义校验 |

### 4.2 stdio signal server

- 位置：client 仓库 `src/mcp/signal-server.ts`（或等价构建产物）；由 client 以**绝对路径**启动，参数为绝对脚本路径。
- DSH 的 stdio 配置要求 `command` 绝对路径（`packages/acp/acp/src/mcp.ts` 校验）；client 用 `process.execPath`（Bun）或随包分发的 `agentflow-signal` 可执行文件。
- server 名固定 `agentflow`，raw tool 名 `signal`；DSH 注册后的模型可见名是 **`mcp__agentflow__signal`**（`S-01`）。不要按 `agentflow_signal` 写 skill/验收。
- 实测一次 `session/new` 会看到**两个** server 进程：第一个收到 `server/discover` 探针后被 SDK SIGTERM，第二个走 legacy `initialize` 并承载 `tools/list` 与调用；两个 session 并发时互不干扰（`S-05`）。**这不是 client 要求启动两次**，而是 MCP SDK `mode:'auto'` 的协议协商；因此：
  - server 必须**容忍被启动两次**：不在启动时清空 `signals.jsonl`、不持跨启动独占锁；
  - `seq` 从文件现有最大有效行续号，不能用内存计数；
  - `--check` 与正式启动共用同一入口/配置，避免两套校验（`A-10`）。
- 工具：
  - 公开名 `mcp__agentflow__signal`；描述里可写语义别名 `agentflow_signal`。
  - 描述：提交本节点的结构化结果；review 节点必须调用一次；参数错误时按错误提示修正后重试。
  - input schema：`kind` 为 const `"review_verdict"`，其余字段来自 `resultSignal.schema`；`additionalProperties: false`。
  - **schema 投影**（`A-01`）：`RestrictedSchema` 不能原样交给 provider。只映射 `type/properties/required/additionalProperties/items/enum/const/description`；`string[]` 展开为 `{type:"array",items:{type:"string"}}`；`maxLength`/`maxItems`/`minLength`/`minimum` 只在 server 校验，不进 schema。DSH 不裁剪关键字，写错会让 provider 收到非法 schema。
- 环境（`env` 是 `{name,value}` 数组，DSH 会校验）：
  - `AF_SIGNAL_CONFIG`：绝对路径，指向本次 attempt 的 `config.json`（含契约、taskId/attempt、输出文件路径）。
  - 不把 task-space 路径、token、模型凭据传给 server；server 不需要这些。
- 行为：
  1. 启动时读取 config；缺失/非法退出非 0；`--check` 只校验并退出 0，client 用它预检。
  2. 调用时校验 `kind`、字段、类型、enum、字节/条数上限；非法返回 MCP tool error，不写文件。
  3. 合法则追加一行 `{seq, at, kind, data}` 到 `signals.jsonl`，`fsync` 后返回 `{ok:true, seq}`；写失败返回 error。
  4. 重复调用允许；`seq` 续号；超过条数/字节上限返回 error。
  5. 不读 task-space、不访问网络、不执行 shell；只写 `AF_SIGNAL_CONFIG` 指定的文件。

### 4.3 目录与 attempt 隔离

- 路径：`<state.root>/signals/<taskId>/<attempt>/`，`config.json` + `signals.jsonl`；目录 `0700`，文件 `0600`。
- 放在 client 状态根，**不放 task-space**：避免模型通过工作区文件直接改写；也不进入归档包。
- 新 attempt 新目录；旧 attempt 的文件保留但**永不被读取**（`Q-06` 写进契约）。采集时只读当前 `taskId+attempt`。
- 采集时忽略最后一行不完整 JSON（server 崩溃/被杀）；按 `seq` 排序；只接受与 `resultSignal.kind` 匹配的 kind。
- 保留期（`Q-05` 默认）：信号目录默认保留 7 天；client 启动与 `doctor` 清理超过窗口的目录；它不是工作区归档的一部分，不参与 `P-05`。具体窗口与清理入口在 `T-RVM-03` 定，需与 client 现有 `OQ-005`/`OQ-021` 的保留策略对齐。

### 4.4 客户端主流程

1. 收到任务；若 `task.resultSignal` 存在且 client 支持该 `version`/`kind`：
   - `CMP-signal.prepare(task)`：建目录、写 config、跑 `signal-server --check`；失败 → **任务失败**（`failed(protocol, signal_prepare_failed)`），`serve` 继续处理其他任务。
   - 生成 `mcpServers` 列表（`command` 绝对路径，`args` 绝对脚本，`env` 只带 `AF_SIGNAL_CONFIG`）。
2. `newSession(instance, cwd, { mcpServers })`：
   - 成功 → 正常 prompt。
   - 若失败且 `error.data.details` 匹配 `mcp-client(agentflow)`（`Q-09`）→ 关闭失败 session（若已创建），**用相同 `mcpServers` 重建一次**（`Q-07`，同一 attempt，不换无 MCP、不回退消息）；第二次仍失败才报 `failed(protocol, signal_mount_failed)`，先传 0 行日志，`serve` 继续。
   - 若 details 不匹配，按真实原因报 `spawn_failed`/`process_exited`/`protocol_error`，不要都算 `signal_mount_failed`。
3. prompt 结束（无论成功/失败/超时/取消）→ **先 collect、后 closeSession**（`A-05`）：
   - 未启用/挂载失败 → 返回 `undefined`。
   - 读文件、校验、取最后一个合法信号；任何异常记 `signal.invalid` 并返回 `undefined`（不抛到结果组装）。
4. `CMP-result`：仅 `status=succeeded` 且有合法信号时写 `signals`；`message + signals` 整体 ≤ `maxResultBytes`；signals 超 16 KiB 整段丢弃（`A-04`）。
5. 先 `P-04` 日志、再 `P-02` 结果，顺序不变（契约不变式 5）。
6. `session/new` 超时（当前硬编码 10s）提为配置项（`A-07`）；默认仍 10s，慢机器可调。

### 4.5 权限与生命周期

- 实测 MCP 工具调用**不触发** `session/request_permission`（`S-02`），client 现有 `[acp].permission` 不会作用到 MCP 工具；不要写「只放行 `agentflow_signal`」——没有判别依据。如果 DSH 后续改成逐次审批，payload 需先带工具名，client 才能按名裁决。
- server 是 DSH 子进程；session close / 进程组回收时随之退出。client 的 `C-09` 残留清理覆盖它；`doctor` 增加信号目录/残留检查（可选）。
- 启动/退出可能发生两次（`S-05`）；server 必须幂等，不能把「第二次启动」当成错误或清空已有信号。
- 超时/取消：先按现有 `C-05`/`C-07` 终止；server 随进程组退出；collect 仍可读已落盘信号，但失败/取消结果不带 signals。
- 信号文件不阻塞 poll/结果上传；collect 有大小上限，避免大文件拖慢结算。

### 4.6 观测

client 记录结构化事件（不新增对外 API）：

- `signal.prepared`（taskId/attempt/kind）
- `signal.disabled`（原因：unsupported_version / check_failed / mount_failed）
- `signal.missing`（required 但模型没有调用；只记录，不改任务状态）
- `signal.tool_call`（seq、ok/error code；不记完整 reason）
- `signal.collected`（count、kind、bytes）
- `signal.invalid`（字段错误类别）

`CMP-observability` 现有日志通道即可；若需要 session 事件，`tool_call` 已经在 ACP 事件流里，不需要重复造。

## 5 Orchestrator 实现

### 5.1 数据与透传

- 迁移 `0011_task_result_signal.sql`：`alter table task add column result_signal jsonb;`（nullable，无默认）。
- `TaskDraft` / `NewTaskRow` / `TaskEnvelope` / `ExecutorTask` 增加可选 `resultSignal`；`task` 表读写带上。
- `validateDraft` 接受可选 `resultSignal`；只做 JSON 可序列化与大小上限（建议 ≤ 8 KiB），语义由 `run` 负责。
- `CMP-scheduler` 不解释 `resultSignal`；`S-05`「任务内容稳定」把它纳入稳定内容（重派时不变）。
- `CMP-http-gateway` 的 `ExecutorTask` DTO 透传；`P-01` 响应新增字段，旧 client 忽略。

### 5.2 `CMP-run`

- 新增 `review-signal.ts` 常量 `REVIEW_VERDICT_SIGNAL`（§3.1 的 JSON）。
- `dispatch-ops.ts`：`node.type === "review"` 时把 `resultSignal: REVIEW_VERDICT_SIGNAL` 放进 `TaskDraft`；其他节点不带。
- `applyReview` 改为：
  1. 取 `result.signals` 中最后一个 `kind=review_verdict` 且 `data` 符合 §3.1 schema 的信号。
  2. 合法 → 用它的 `verdict`/`reason`/`evidence`；不合法 → 记 `signal_invalid`，回退消息。
  3. 无信号 → `parseVerdict(message)`。
  4. 两者都无/非法 → 现有 `failed(verdict_invalid)`。
  5. 两者都有且 verdict 不同 → 信号优先，记 `verdict_conflict`（含 nodeId/visit/taskId；不记完整 reason）。
- 只在 `result.status === "succeeded"` 走上述逻辑；失败/超时/取消仍按现有路径。
- `run_node.verdict` 存信号 `data` 的稳定子集：`{verdict, reason, evidence?, decidedBy?}`；不新增列、不改 `RunNodeView`。`evidence` 是新增回传信息；`decidedBy` 只在人工确认后出现。
- `pass` → `succeeded` + 推进；`fail` → `rejected` + 回退边。图规则完全不变。

### 5.3 契约文档

- `executor-http-v3.md`：`TaskRequest.resultSignal?`、`TaskResult.signals?`、常量、`C-13`/`C-14` 客户端承诺（顺延现有 `C-01`–`C-12`，`A-09`）、`S-05` 稳定内容。
- `run/spec.md` §4.5：信号优先/消息回退/冲突规则；§2 不变量补「signals 只在 succeeded 应用」。
- `scheduler/spec.md`：`task.result_signal` 列与「不解释、稳定内容」；`task` 写入/读取。
- `SCN-0302`：运行序增加信号路径与回退断言；测试 ID 补齐。
- 不新增产品 API、不改 OpenAPI（执行面不在 OpenAPI）；`RunNodeView` 不变（`verdict` 继续是 opaque JSON，新增字段不破坏）。
- client `CMP-gateway` 的 `reportResult` 不需要改：它已把 `TaskResult` 对象直接 POST（`V-03`）；只需在 `executor/types.ts` 加 `signals?` 字段并让 `parseTask` 读 `resultSignal`。

### 5.4 不做节点级 `needs_human`

review 只产出 `pass`/`fail`；执行中需要人拍板的情况走第二个场景的 `confirmation_request`（§5.5），不把 `needs_human` 混进 review verdict。这样 review 的推进/回退规则保持简单，确认点只有一条实现路径。

### 5.5 执行中临时确认点（第二场景，设计见伴生文档）

第二个要跑通的场景：开发/设计节点执行到一半，模型遇到必须由人确认的环节，临时停到一个确认点，人补充确认后继续执行。

做法不是阻塞式 MCP 工具，也不是重跑当前节点，而是**用保存的 sessionId 续跑同一个 session**：

```
模型调用 mcp__agentflow__confirm(question, context, options?)
  → MCP 工具立即返回 {status:"pending"}，要求模型停止本轮
  → client 采集 confirmation_request，随 P-02 回传（status=succeeded，sessionId=X）
  → CMP-run 把当前 run_node 置 waiting_confirm（确认点挂当前节点），run 置 waiting_confirm
  → 人工用现有 decide(pass|reject, comment) 回答
  → pass/reject：run 都创建续跑任务（resumeSessionId=X + 人工决定/意见 prompt），task_id 替换、visit 不变
  → client session/resume(X) 后 prompt 继续；模型在同一 session 完成节点
  → 后续照常 P-04/P-02
```

关键点：

- **不重跑、不新增 visit**：同一 `run_node`、同一 `sessionId`，避免重复工作并保留上下文；
- **reject 不是失败**：拒绝意见同样通过续跑任务带回同一 session，模型按意见调整后继续；确认点的 reject 不走回退；review 的 fail 才按回退边处理；
- **回答字段已定**：统一用 `decide.comment`，不新增 `answer`；`decision` 表达通过/拒绝，`comment` 表达内容。
- 首任务已经结算，等待期间没有在跑任务，`CMP-scheduler` 不需要改，`S-02` 不会重派；
- 续跑任务是普通任务，带 `resumeSessionId`；不新增端点/任务状态/阻塞语义；
- client 需新增 `session/resume`（DSH ACP 支持），首任务结束后保留持久化 session；resume 失败怎么处理由 client 先实测（close→resume、进程重启、TTL、并发），不预设；
- 确认点仍挂在当前 `run_node` 上，不动态改图、不插入合成 `confirm` 节点。

完整设计（工具、信号、契约、client/run、测试）见 [`human-interaction.md`](human-interaction.md)。它排在 review verdict v1 之后，作为第二个场景实现。

## 6 Skill 与种子

`scripts/seed-skills/review-verdict/SKILL.md` 过渡期改为双写（v1.8）：

1. 完整报告仍写 `<task-space>/review.md`。
2. 若工具列表中存在 **`mcp__agentflow__signal`**（语义别名 `agentflow_signal`）：
   - 调用它，`kind=review_verdict`，`verdict=pass|fail`，`reason`，`evidence`；
   - 工具返回错误时按提示修正并重试；
   - 不要再把 verdict JSON 当作唯一出口。
   工具名以工具列表实际显示为准；如果显示为 `mcp__agentflow__signal`，不要写成裸 `agentflow_signal` 去调用。
3. 若工具不存在（旧 client）：
   - 仍在最终消息末尾输出裸 JSON `{"verdict":"pass"|"fail","reason":"…"}`，作为回退。
4. 常见踩坑新增：工具可用却只在正文写结论；工具参数用错值后不按错误重试；把公开名写成 `agentflow_signal`。

种子重跑会更新技能内容（技能/专家按种子值覆盖，流程不覆盖），现有演示库不需要迁移流程图。

## 7 测试与验收

### 7.1 Client

| 层 | 用例 |
|---|---|
| signal server | 合法 pass/fail 写入并 ack；非法 enum/缺字段/超长/多余字段返回 error 且不写；重复调用 seq 递增；超过条数/字节上限报错；崩溃留下半行被 collect 忽略；**被启动两次不丢已有信号、seq 续号**（`S-05`/`A-06`）；**`server/discover` 立即回 `-32601`，挂载 ≤2s**（`S-07`/`A-11`） |
| schema 投影 | `string[]` → `array`；`maxLength`/`maxItems`/`minimum` 不进 MCP schema；server 仍执行字节/条数上限（`A-01`） |
| prepare | 目录/文件权限；config 内容；`--check` 成功/失败；不支持 version/kind 时任务失败；预检与挂载共用入口（`A-10`）；预检失败逐任务报错、`serve` 继续（`Q-08`） |
| runtime | `newSession` 带可选 `mcpServers`；MCP 挂载失败 → 相同 `mcpServers` 重建一次（`Q-07`），仍失败才 `failed(signal_mount_failed)`；不换无 MCP、不回退消息；`details` 用于归因（`S-04`/`Q-09`）；session 关闭后 server 退出 |
| collect | 无信号、单信号、多信号取最后、未知 kind 忽略、损坏文件、attempt 隔离、大小上限；collect 在 close 之前（`A-05`） |
| result/gateway | `signals` 只在 succeeded 出现；`message + signals` 整体 ≤ 256 KiB；signals 超 16 KiB 整段丢弃；旧服务端场景不发 signals |
| 权限 | MCP 工具调用不触发 `session/request_permission`（`S-02`）；不要假设 client 能按工具名放行 |

### 7.2 Orchestrator

| 层 | 用例 |
|---|---|
| 迁移/透传 | `task.result_signal` 写入/读取；重派 `attempt+1` 内容不变；旧 client 忽略字段 |
| run 判定 | 信号 pass → 推进；信号 fail → rejected/回退；信号缺失 → 消息回退；信号非法 → 消息回退；两者非法 → `verdict_invalid`；冲突信号优先；失败状态忽略 signals |
| 网关 | `P-02` 接受 `signals`；非法形状/超限 400/413；旧 body 无 signals 正常 |
| 兼容 | 四种新旧组合的契约测试；新 client + 旧 server 不发送 signals；旧 client + 新 server 回退 |
| 回归 | 现有 `TC-RUN-005`–`TC-RUN-008` 全绿 |

### 7.3 端到端

- 真实 client + DSH + orchestrator：review 节点模型调用 `mcp__agentflow__signal`，`P-02.signals` 到达，run 按 pass/fail 推进/回退。
- 工具名核对：session 日志/ACP `tool_call.title` 中出现 `mcp__agentflow__signal`；skill 未把公开名写错。
- 工具不可用：client 不挂 MCP，模型按 skill 输出末尾 JSON，run 回退成功。
- 工具参数非法后模型修正：同一 session 内重试成功。
- MCP server 启动/挂载失败：相同 `mcpServers` 重建一次；第二次仍失败才先传 0 行日志、报 `failed(signal_mount_failed)`；不换无 MCP、不回退消息；run 失败。
- `SCN-0302` 新增断言通过；`bun run check`、`bun run quality:report` 全绿。

## 8 发布、回滚与收紧

1. **Spike**（client）：验证 DSH 挂载、工具公开名、权限、启动失败、进程回收；输出一份短记录。
2. **orchestrator 加法**：迁移 + 透传 + `run` 信号优先/回退；旧 client 行为不变，可先上线。
3. **client 实现**：`CMP-signal` + runtime + result/gateway；只在收到 `resultSignal` 时启用；挂载失败同参重建一次，仍失败即任务失败，不降级。
4. **skill 双写**：`review-verdict` v1.8；种子重跑。
5. **观察**：统计 `signal.collected` / `signal.missing` / `signal_mount_failed` / `verdict_source=message`；确认 MCP 挂载稳定与工具调用率。
6. **收紧**（另立工序）：当 client 最低版本覆盖后，把 `resultSignal.required` 变为强制、移除 skill 的 JSON 回退；这是下一轮决策，不在本提案内。

回滚：

- 回滚到不发 `resultSignal` 的 orchestrator 版本，或回退 client 到不支持 signals 的版本；不要在收到 `resultSignal` 时配置关闭 MCP 继续跑。
- orchestrator 回退 `applyReview` 到纯消息解析；`task.result_signal` 列可保留（nullable，不影响旧逻辑）。
- 不需要数据迁移回滚；不删除已采集信号文件（排障用，按状态清理）。

## 9 安全与风险

| 风险 | 影响 | 处理 |
|---|---|---|
| MCP server 启动/挂载失败 | review 链路断裂 | 同一 attempt 用相同 `mcpServers` 重建一次；仍失败才 `failed(signal_mount_failed)`；`serve` 继续；不降级、不回退消息 |
| 模型不调用工具 | 无信号 | skill 双写 + message 回退；观察调用率，不静默失败 |
| 多调用/乱序 | 判定不确定 | server seq；client 取最后一个合法信号；文档写死 |
| 工具参数注入/超长 | 日志/结果膨胀 | 受限 schema、字节/条数上限、`additionalProperties:false`；不记完整 reason |
| 模型伪造 pass | 审核失真 | 与当前文本 verdict 同信任级；skill 证据要求；高风险流程用 confirm 节点；工具调用可审计 |
| 信号文件被改写 | 伪造结果 | 放 client 状态根、不在 task-space、路径不进 prompt；不作为安全边界，只作结构化通道 |
| 权限过宽 | 新 server 工具全放行 | 实测 MCP 工具不触发 client 权限请求（`S-02`）；不要伪造「按名放行」。若 DSH 改为逐次审批，先让 payload 带工具名 |
| 结果体超限 | `P-02` 413 | `message + signals` 整体预算；signals 超 16 KiB 整段丢弃；契约测试 |
| evidence 含主机路径/敏感信息 | 观测面/journal 泄露 | 按现有脱敏规则；skill 要求只写路径/命令/测试结果，不写凭据（`Q-04`） |
| 信号目录无限增长 | 磁盘占用 | 默认 7 天清理 + `doctor` 检查（`Q-05`）；不进入归档 |
| 客户端绑定 DSH 版本 | MCP 行为漂移 | client 固定 DSH 版本；spike 覆盖；MCP 是 ACP 标准面，降低私有 API 依赖 |
| 跨节点需求被塞进工具 | 范围膨胀 | 本轮明确非目标；跨节点用 task-space，等 fan-out 再设计 |

## 10 与现有文档的关系

| 文档 | 关系 |
|---|---|
| [`executor-http-v3.md`](../../design/contracts/executor-http-v3.md) | 加法字段 `resultSignal`/`signals`；不新增端点、不升协议 |
| [`run/spec.md`](../../design/components/run/spec.md) | §4.5 判定改为信号优先/消息回退；§2 不变量补信号应用条件 |
| [`scheduler/spec.md`](../../design/components/scheduler/spec.md) | `task.result_signal` 列；不解释、稳定内容 |
| [`SCN-0302`](../../design/scenarios/workflow-orchestration/workflow-execution/review-verdict-and-rollback/scenario.md) | 运行序与测试补信号路径；状态从 verified 更新需按流程 |
| client `CMP-runtime`/`CMP-executor`/`CMP-result`/`CMP-gateway` 规格 | `mcpServers` 可选参、`SignalPort`、signals 字段；`CMP-signal` 是候选，先做 client P1 结构决策 |
| client `review-verdict` 技能 | 过渡期双写；种子同步 |
| `REQ-0001` / `SCN-0302` | 仍满足「模型只输出 pass/fail，回退目标由编排决定」；不改变图规则 |

## 11 任务表

| ID | 仓库 | 类型 | 内容 | 依赖 |
|---|---|---|---|---|
| `T-RVM-01` | orchestrator | design | 本提案与契约/兼容盘点；吸收 client 2026-11-18 实测反馈 | — |
| `T-RVM-02` | client | verify | MCP spike：工具名/权限/启动失败/回收/并发/时延 | 完成 |
| `T-RVM-10` | client | design | P1 结构决策：`CMP-signal` 新 L0 vs 扩展现有组件；定 `SignalPort`/数据所有权/清理 | `T-RVM-02` |
| `T-RVM-03` | client | change | signal server（幂等启动/续号/受限 schema 投影）+ `CMP-signal` 或选定落点 + 单测 | `T-RVM-10` |
| `T-RVM-04` | client | change | runtime 可选 `mcpServers`、`AcpProtocol` 透出 `error.data.details`、executor prepare/collect、挂载失败同参重建一次、错误归因、result 预算、`session/new` 超时配置 | `T-RVM-03` |
| `T-RVM-05` | orchestrator | change | `0011` 迁移、`task.result_signal`、`TaskDraft`/`TaskEnvelope`/`ExecutorTask` 透传、`P-02` `signals` 白名单 | 提案确认 |
| `T-RVM-06` | orchestrator | change | `review-signal` 常量、dispatch 注入、`applyReview` 信号优先/回退、冲突/非法/`signal_missing` 日志、测试 | `T-RVM-05` |
| `T-RVM-07` | orchestrator | change | `review-verdict` 技能 v1.8 双写（公开名 `mcp__agentflow__signal`）、种子测试 | 提案确认 |
| `T-RVM-08` | both | verify | 兼容矩阵、真实 client 端到端、`SCN-0302` 更新、`bun run check`/`quality:report` | `T-RVM-04`/`T-RVM-06`/`T-RVM-07` |
| `T-RVM-09` | orchestrator | design | 第二场景：执行中临时确认点（MCP confirm signal + `waiting_confirm` + 同节点重跑，见 [`human-interaction.md`](human-interaction.md)） | 本提案确认后另立 P1 |

## 12 待定

| 项 | 当前建议 | 何时定 |
|---|---|---|
| 工具公开名 | **已定**：`mcp__agentflow__signal`（server `agentflow` + raw `signal`）；`agentflow_signal` 只作语义别名 | `S-01` |
| 信号大小上限 | 总 16 KiB / 8 条 / reason 8 KiB / evidence 16×512 B；`message + signals` 整体 ≤ 256 KiB | `T-RVM-03` 实现时按测试调整 |
| `reason` 是否必填 | 是；空理由按非法信号处理，回退消息 | 提案默认 |
| 模型始终不调用工具 | client 记 `signal_missing`，不上报 signals，run 回退消息；不补 prompt、不判失败 | `Q-02` 默认 a |
| MCP 挂载失败判别 | `details` 命中 `mcp-client(agentflow)` 才归因 signal；同参重建一次，仍失败才报 `signal_mount_failed`；其他失败按真实原因报 | `Q-07`/`Q-09` |
| evidence 可见范围 | 进 `TaskResult.signals` / journal / 观测面 / `run_node.verdict`；按现有脱敏规则，不新增隐藏策略 | `Q-04` 默认 |
| 信号目录保留 | 默认 7 天；启动与 `doctor` 清理；不进归档；与 client 保留策略对齐 | `Q-05` 默认 |
| attempt 归属 | 写进契约：只读当前 `taskId+attempt`，旧 attempt 保留但不读 | `Q-06` 默认 |
| 是否落库 verdict 来源 | v1 只记结构化日志，不改 `run_node` | 观察后再定 |
| 移除 JSON 回退 | 等 client 最低版本覆盖 + 工具调用率达标，另立工序 | 后续 |
| 执行中临时确认点 | 第二个场景：MCP `confirm` signal + 现有 `waiting_confirm`/`decide` + `resumeSessionId` 续跑同一 session；不重跑、不阻塞、不新增端点、不改 scheduler。见 [`human-interaction.md`](human-interaction.md) | `T-RVM-09` |
| 跨节点信号 | 不在本轮；task-space 文件优先 | 后续 |

## 13 验收清单（设计阶段）

- [ ] 用户确认本提案的 v1 边界：只做 review、只做单 kind、只走 `P-02`、不改 scheduler 语义。
- [x] client 完成 spike：工具名 `mcp__agentflow__signal`、权限不触发、启动失败 details、进程回收。
- [ ] client 完成 P1 结构决策（`CMP-signal` 新 L0 vs 扩展）；确认后再写 `CMP-signal` 代码。
- [ ] orchestrator 与 client 对 §3 契约字段、大小上限、回退语义无异议。
- [ ] 确认 §3.3 兼容矩阵；确认 skill 双写是过渡态而不是最终态。
- [ ] 确认 review 只产出 pass/fail；执行中确认走 [`human-interaction.md`](human-interaction.md) 的 confirmation_request，不混用。
- [ ] 确认后再改 `executor-http-v3.md`、组件规格、迁移与代码。
