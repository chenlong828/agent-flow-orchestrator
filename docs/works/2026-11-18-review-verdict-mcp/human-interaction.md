---
layer: works
module: global
status: active
updated: 2026-11-18
procedure: 2026-11-18-review-verdict-mcp
level: P1
---

# 方案：执行中临时确认点（MCP confirm signal + session continuation）

> 状态：**P1 提案，未冻结**。这是 [`proposal.md`](proposal.md) 的第二个场景：开发、设计等节点执行到一半，遇到必须由人明确的环节，临时停到一个确认点，人补充确认后**继续同一个 session**，不重跑当前节点。
> 结论：**用 session continuation，不重跑。** 模型调用 `mcp__agentflow__confirm` 发出确认请求并结束本轮；client 保存 `sessionId`；run 进入 `waiting_confirm`；人回答后，run 创建**续跑任务**，把 `resumeSessionId` 与人工回答交回 client；client `session/resume` 同一 session 继续执行。任务已经结算，`CMP-scheduler` 不需要改。

## 1 场景

开发/设计节点（`agent`、`review` 等）执行中，模型遇到以下情况，不能自行拍板：

- 契约变更：公共 API/schema/数据所有权要改；
- 范围扩展：新增组件、依赖、迁移、跨项目改动；
- 关键信息缺失：需求/场景/验收标准无法从现有材料推断；
- 约束冲突：两处要求互斥，需要人取舍；
- 其他不可逆/高风险操作。

模型需要把问题、上下文、可选项送到 UI；人回答后，**在同一个 session 里继续把活干完**，不从头重跑。

## 2 为什么用 session continuation，而不是重跑

重跑当前节点会把已经做过的工作再做一遍，浪费 token，也丢失模型已经建立的上下文。客户端的 `sessionId` 已经在 `P-02` 结果里回传，`CMP-run` 也已经把它落在 `run_node.session_id`；只要把 session 保存下来，确认后用同一个 session 继续即可。

约束：当前 client 在任务结束时 `closeSession`，且 `RuntimePort` 只有 `newSession`，没有 resume；DSH ACP 本身支持 `session/resume`（需同 `cwd` + 同 `mcpServers`）。所以这是一个**客户端能力加法**，不是重新设计执行面。

## 3 运行序

```
模型调用 mcp__agentflow__confirm(question, context, options?)
  → MCP server 校验并立即返回 {status:"pending"}
  → 模型按工具说明停止本轮
  → client 采集 confirmation_request，随 P-02 回传（status=succeeded，sessionId=X）
  → client 关闭 session X（session 持久化留给 resume）
  → CMP-run：
       run_node.state = waiting_confirm（确认点挂当前节点，visit 不变）
       workflow_run.state = waiting_confirm
       保存 question/context/options
  → 人工用现有 decide(pass|reject, comment) 回答
       pass：
         保存人工回答；
         run_node.state = dispatched；task_id = 新续跑任务；
         workflow_run.state = running；
         创建 TaskRequest { resumeSessionId: X, prompt: 原任务 + [人工确认] 回答 }
       reject：
         同样不失败、不回退；保存 decision=reject 与 comment；
         当前 row 改 dispatched，创建续跑任务；
         prompt 注入「人工拒绝 + 意见」，模型调整后继续
  → client 收到续跑任务：
       session/resume(X, cwd, mcpServers) → session/prompt(回答 + 继续指令)
  → 模型在同一 session 继续 → 最终 P-02（sessionId=X）
  → CMP-run 结算同一 run_node；后续照常 P-04/P-02
```

要点：

- **不重跑、不新增 visit**：确认前后是同一个 `run_node`、同一个 `sessionId`；`run_node.task_id` 从首任务换成续跑任务，`visit` 不变。
- **任务已结算**：首任务 `P-02` 是 `succeeded`，调度器侧 `done`；等待人工期间没有在跑任务，`S-02` 不会重派，不需要 `waiting_input`。
- **续跑是普通任务**：`CMP-scheduler` 只看到一条新的 `queued` 任务，照常派发；不需要新状态。
- **session 生命周期**：首任务结束后 client 关闭 session；续跑任务用 `session/resume` 恢复。resume 是否可靠由 client 先实测（见 §8），在结果出来前不把失败/重跑策略写死；`session_resume_failed` 只是候选错误码。
- **visit 上限**：确认点不增加 visit；续跑不是重访，`max_node_visits` 不因此消耗。

## 4 MCP 工具与信号

### 4.1 工具

同一 MCP server 增加第二个工具：

| 项 | 值 |
|---|---|
| 公开名 | `mcp__agentflow__confirm`（server `agentflow` + raw `confirm`） |
| 语义别名 | `agentflow_confirm`（只用于文档/描述） |
| 输入 | `question`、`context`、`options?`、`allowFreeText?` |
| 返回 | `{status:"pending"}`；明确提示模型停止本轮 |
| 校验 | question 非空、长度上限；options ≤ N 项；失败返回 MCP tool error，模型可修正 |

输入示意：

```json
{
  "question": "是否允许修改 executor-http-v3 的 TaskResult 字段？",
  "context": "新增 signals 会改变 P-02 请求体；影响 client 与调度面。",
  "options": [
    { "id": "allow", "label": "允许，按加法字段发布" },
    { "id": "reject", "label": "不允许，改用独立端点" }
  ],
  "allowFreeText": true
}
```

### 4.2 信号

`TaskResult.signals` 增加：

```ts
type ConfirmationSignal = {
  seq: number;
  at: string;
  kind: "confirmation_request";
  data: {
    question: string;
    context?: string;
    options?: { id: string; label: string; description?: string }[];
    allowFreeText?: boolean;
  };
};
```

- 与 `review_verdict` 共用 `signals` 数组、采集与预算。
- 同一结果只应用一个控制信号；如果既有 `confirmation_request` 又有 `review_verdict`，确认优先，首轮 verdict 不应用，续跑后的结果再按 verdict 处理。
- 只在 `status=succeeded` 时应用。

### 4.3 契约

`TaskRequest` 增加可选 `resumeSessionId`：

```ts
type TaskRequest = {
  // ...现有字段
  resumeSessionId?: string;   // 续跑同一 session；缺省 = 新建 session
};
```

`TaskRequest` 增加可选 `confirmation` 契约（或与 `resultSignal` 合并为 `kinds`，实现时统一）：

```ts
type ConfirmationContract = {
  version: 1;
  kind: "confirmation_request";
  schema: RestrictedSchema;
};
```

client 只在收到 `confirmation` 时挂 `mcp__agentflow__confirm`；`resumeSessionId` 存在时走 resume，不新建 session。

### 4.4 回答字段：已定复用 `comment`（不新增 `answer`）

| 维度 | 复用 `comment` | 新增 `answer` |
|---|---|---|
| API/DTO/OpenAPI/UI | 零改动；`decide` 现有字段直接承载 | 需改 `DecideInput`、产品 DTO/OpenAPI、UI 表单与测试；可做成可选，旧 UI 回退 `comment` |
| 语义 | 一个字符串；靠 `decision=pass/reject` 区分通过/拒绝；无法区分“选项 id”与“补充说明” | `answer` 专门承载回答，`comment` 保留决策备注；可扩展为 `{text, selected[]}` |
| 模型 prompt | 直接拼 `comment`；需在 prompt 里写清“这是通过/拒绝意见” | 可分别拼“选择/自由文本/备注”，模型更不容易误解 |
| 多问题/选项 | 只能把选项塞进文本或 JSON 字符串，解析弱 | 天然支持多问题、多选、结构化答案 |
| 审计/统计 | 字符串，统计与回放弱 | 结构化，便于审计和后续分析 |
| 兼容/迁移 | 旧 UI、旧调用方不受影响 | 新字段可选；旧 UI 不传时双读 `comment`，但两套字段并存会增加歧义 |
| 实现成本 | 低 | 中（跨 HTTP 契约、UI、测试） |

**已定：v1 复用 `comment`，不新增 `answer`**。确认点的回答本质上就是“通过/拒绝 + 人的说明”，`decision` 表达方向，`comment` 表达内容；模型 prompt 写成：

```
[人工确认]
问题：<question>
人工决定：通过 / 拒绝
人的回答/意见：<comment>
继续完成本节点；若拒绝，按意见调整，不要重复被拒绝的方案。
```

代价是 `comment` 同时被 confirm 节点、review 决策和确认点复用，语义要靠上下文区分；如果后续要支持多问题/结构化选项，再新增 `answer`，并让 `answer` 优先、`comment` 回退。当前不加只有 `string` 的 `answer`。

## 5 Client 实现

| 单元 | 改动 |
|---|---|
| `CMP-runtime` | 新增 `resumeSession(instance, sessionId, cwd, opts?)` → ACP `session/resume`；`newSession` 仍用于无 resume 的任务 |
| `CMP-executor` | `TaskRequest.resumeSessionId` 存在时先 resume；resume 失败行为由 client 实测后定，不猜测 |
| `CMP-signal` | confirm 工具配置、`confirmation_request` 采集；与 review signal 共用目录/预算 |
| `CMP-result` | signals 支持 `confirmation_request`；整体预算不变 |
| `CMP-gateway` | `parseTask` 读 `resumeSessionId` 与 `confirmation`；`TaskResult` 透传 sessionId/signals |

实现要点：

- MCP server 对 `server/discover` 立即回 `-32601`（`A-11`），避免挂载等待 60s。
- confirm 工具**立即返回** `pending`，不等待人工回答。
- 首任务结束 `closeSession`，但保留 DSH session 持久化；续跑任务 `session/resume` 传同 `cwd` + 同 `mcpServers`。
- 如果 resume 失败：先保留 `session_resume_failed` 错误码；是否重跑/保持 session 由 client 实测结果决定（见 §8）。
- `run` 单次模式与 `serve` 同语义（`A-15`）。
- 错误码沿用 `signal_prepare_failed`/`signal_mount_failed`；resume 失败预留 `session_resume_failed`，策略待实测。

## 6 Orchestrator

- `CMP-run`：
  - `applyResult` 对 `agent`/`review` 节点检查 `confirmation_request`；命中则当前 row `waiting_confirm`、run `waiting_confirm`，保存 question/context/options 与 sessionId。
  - `decide` 增加确认点分支：`pass`/`reject` 都保存回答、当前 row 改 `dispatched`、`task_id` 换续跑任务、run 改 `running`，入队带 `resumeSessionId` 的续跑任务；差异只体现在 prompt 的「通过/拒绝 + 意见」，不改变流程走向。
  - 续跑任务 prompt 加 `[人工确认]` 块（问题、回答、选项）；`visit` 不变。
  - 最终 P-02 结算当前 row；session 日志、归档、回退规则不变。
- `CMP-scheduler`：**不需要改**。首任务已 `done`；续跑任务是普通 `queued` 任务；等待人工期间无在跑任务。

## 7 与 review 结论的区别

- `review_verdict` 是 review 节点的结论：`pass` 推进、`fail` 回退；没有人工确认步骤。
- `confirmation_request` 是执行中的确认：人回答问题，**续跑同一个 session**继续干活；`pass`/`reject` 都不结算、不推进。
- 两者都用 `waiting_confirm` 和 `decide`，但 `decide` 的后果不同：review 的 `needs_human` 不再存在；确认点按 `verdict.kind=confirmation_request` 走续跑分支。

## 8 测试与验收

### 8.1 session resume 实测（client 先回答，不猜测）

在把「resume 失败怎么办」写死之前，client 至少跑完这组：

| 场景 | 观察 |
|---|---|
| 首任务 close 后、同一 DSH 进程内 `session/resume` | 能否恢复；历史消息/工具结果是否还在 |
| close 后 DSH 进程退出，新进程同 `DSH_HOME` 启动再 resume | 是否依赖进程存活；session 持久化是否生效 |
| 人工等待超过 session TTL/保留窗口 | resume 是否失败、错误码/可判别性 |
| 同实例并发其他任务时 resume | 是否冲突、是否影响其他 session |
| `cwd`/`mcpServers` 与首任务不一致 | 是否拒绝；错误是否明确 |
| resume 后 `session/prompt` | 模型是否看到之前上下文；能否继续而不用重读全部产物 |
| resume 失败 | 失败耗时、错误码、是否可安全重试 |

结论出来后再定：resume 失败是任务失败、保持 session 不关、还是允许新建 session 重跑。本文只要求 `resumeSessionId` 的行为可观测、错误可归因，不预设策略。

### 8.2 功能验收

- MCP：confirm 工具可见、可调用、立即返回 pending；参数错误可修正；`server/discover` 快速回落。
- client：`resumeSessionId` 触发 `session/resume`；同 cwd/mcpServers；首任务 close 后能 resume；resume 失败按 8.1 结果处理。
- run：确认点 `waiting_confirm`；`decide pass/reject` 都创建续跑任务、`task_id` 替换、`visit` 不变、prompt 含决定与意见；sessionId 在首尾结果一致。
- 端到端：设计节点执行中问「是否允许改契约」，人工通过/拒绝，同一 session 继续完成；review verdict 场景不回归。

## 9 待定

| 项 | 当前建议 |
|---|---|
| 回答字段 | **已定**：复用 `comment`，不新增 `answer`；需要结构化选项时另行评估 |
| `reject` 对确认点的含义 | 作为拒绝意见带回同一 session 继续；review 的 fail 才按回退边处理 |
| resume 失败怎么处理 | 由 client 先实测 close→resume、进程重启、TTL、并发等场景后再定；不猜测 |
| 确认点是否出现在 run 节点列表 | 挂在当前节点，不新增合成节点；需要独立节点时再做 |
| 多次确认的 visit 计数 | 确认不增加 visit；续跑沿用当前 visit |
| 是否允许 confirm 与 review_verdict 同结果 | 允许但确认优先；首轮 verdict 不应用 |
