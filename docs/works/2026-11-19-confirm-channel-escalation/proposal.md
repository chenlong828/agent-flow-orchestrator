---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-19-confirm-channel-escalation
level: P2
---

# 提案：确认通道补强（prompt 收敛 + 评审应急呼人）

> 状态：**P2 提案，未冻结**。本提案只定义契约、prompt 文案、review confirm 语义与任务拆分；实现由后续任务承接。
> 结论：**review 节点在现有 `review_verdict` 之外，增加一个可选的 `confirmation` 契约；client 同时挂 `signal` + `confirm` 两个工具；prompt 分 agent/review 两套确认文案。** 复用现有 `waiting_confirm` + `resumeSessionId` 续跑，不新增 MCP 工具、不改 `decide` API/UI、不做通用聊天。

## 0 一句话

review 节点在「必须澄清已 accepted 的契约/口径，且该口径直接决定 verdict」时，可以像 agent 节点一样调 `mcp__agentflow__confirm` 暂停等人；人答复后同一 session 续跑，评审仍自行给出 `review_verdict`。同时把 agent 的 `[确认通道]` 从旧四类补全为 `auto-confirm` §3 的严重清单。

## 1 现状与缺口

现有实现（`2026-11-18-review-verdict-mcp`）：

- `confirmation_request` 信号、`waiting_confirm` 状态、`decide(pass|reject)`、`resumeSessionId` 续跑都已落地（[`human-interaction.md`](../2026-11-18-review-verdict-mcp/human-interaction.md)）。
- `applyResult` 先看 `confirmation_request`，再按 `review` 走 `applyReview`（[`results.ts`](../../../src/components/run/results.ts)）；`decide` 对任何 `waiting_confirm` 节点都走同一 session 续跑（[`commands.ts`](../../../src/components/run/commands.ts)）。**run 侧状态机基本已支持 review confirm。**
- 但 `signalForNode` 只给 `review` 返回 `review_verdict`（[`signals.ts`](../../../src/components/run/signals.ts)）；`dispatch-ops` 只下发一个 `resultSignal`（[`dispatch-ops.ts`](../../../src/components/run/dispatch-ops.ts)）。
- 执行面契约 `C-15` 按 `resultSignal.kind` 只挂一个工具（[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md)）；client 的 `SignalRunner.prepare` 只处理一个契约（[`signal-runner.ts`](../../../../agent-flow-client/src/components/executor/signal-runner.ts)）。
- prompt 的 `[确认通道]` 只对 `agent` 出现，且只列四类（[`prompt.ts`](../../../src/components/run/prompt.ts)）。

所以缺口是：**契约/工具暴露 + prompt 文案**；不是 run 状态机重做。

## 2 契约方案

### 2.1 推荐：`TaskRequest.confirmation` 可选契约

```ts
type TaskRequest = {
  // ...现有字段
  resultSignal?: ResultSignalContract;   // 现有：review=verdict，agent=confirmation
  confirmation?: ResultSignalContract;   // 新增：review 额外挂 confirm；kind=confirmation_request，required=false
};
```

- `review`：`resultSignal = REVIEW_VERDICT_SIGNAL`（required=true）+ `confirmation = CONFIRMATION_SIGNAL`（required=false）。
- `agent`：保持现状 `resultSignal = CONFIRMATION_SIGNAL`（required=true），本工序不统一改。
- `confirmation` 是加法字段；没有它的旧任务/旧 client 行为不变。
- `S-05` 稳定内容加入 `confirmation`；`validateDraft` 复用 `validateResultSignal` 的形状校验，但要求 `kind=confirmation_request`、`required=false`。
- client `SignalRunner.prepare` 从单契约扩展为「`resultSignal` + 可选 `confirmation`」；`CMP-signal` 在同一 MCP server 上暴露两个工具；`collect` 按 `kind` 分别校验（client 已支持两个 kind）。
- `C-13`/`C-15` 改为：按 `resultSignal`/`confirmation` 各挂一个工具；`confirm` 工具只在 `confirmation` 存在时挂载。

### 2.2 备选

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| `resultSignals: ResultSignalContract[]` | 通用，未来可挂多信号 | 改 `TaskRequest` 形状、S-05、调度/客户端多处；对本次只需两个契约偏重 | 不选 |
| `resultSignal.allowConfirm: true` | 改动最小，review 契约不变 | 语义隐式；confirm schema 写死；未来扩展差 | 备选 |
| review 固定挂两个工具（不改契约） | 零契约改动 | 客户端硬编码 review 语义；旧 client 无法感知 | 不选 |

## 3 prompt 文案

`composeNodePrompt` 现在只在 `agent` 节点加 `[确认通道]`；改为按节点类型输出：

- **agent**：

  ```text
  [确认通道] 仅严重场景调用 mcp__agentflow__confirm：契约变更、规则突破、不可逆/外部副作用、P0/P1、用户意图冲突、关键信息缺失；普通决策按 auto-confirm §2 默认确认，不打断人。
  ```

- **review**：

  ```text
  [确认通道] 评审节点仅在「必须澄清已 accepted 需求/契约口径，且该口径直接决定 verdict」时调用 mcp__agentflow__confirm；不得把评审判断本身交给人，不得用 confirm 代替 review_verdict；一次一个问题；回答后仍须自行提交 verdict。
  ```

两段都指向 `auto-confirm` §3/§5，prompt 只做入口，不复制 skill 全文。

## 4 review confirm 的运行序与边界

### 4.1 运行序

```text
review 调 mcp__agentflow__confirm(question, context, options?)
  → client 采集 confirmation_request，随 P-02 回传（succeeded + sessionId）
  → run: run_node/run 进入 waiting_confirm
  → 人 decide(pass|reject, comment)
  → 同一 session resume，prompt 注入 [人工确认]
  → review 继续 → 提交 review_verdict
  → applyReview 正常结算/回退
```

- 确认前不结算 review、不产生 verdict；确认后仍由评审自己判定。
- `pass`/`reject` 都只影响评审的输入，不直接决定 verdict；人答复不是 verdict。
- 人拒绝后评审可调整判断、继续问一个更窄的问题，或直接给出 fail；不重复被拒方案。

### 4.2 允许与禁止

**允许**（非常必要）：

- 已 accepted 需求/契约的口径在文档里有两种合理解读，且选择直接改变 verdict；
- 评审发现设计与上游 accepted 卡冲突，需要人确认哪边是权威；
- 证据只能由人提供（例如“这个改动是否已获业务方同意”），且没有它无法判定。

**禁止**：

- 问“这个方案好不好”“该 pass 还是 fail”——评审判断不外包；
- 用 confirm 代替 verdict、代替证据、代替回退；
- 同一问题重复问；一次访问最多 1 个问题（v1 prompt 约束；观察到滥用再加服务端计数）；
- 在 review 节点调用其他节点的确认通道。

### 4.3 无答复/取消

- 无答复：run 保持 `waiting_confirm`，不产生 verdict，不自动 pass；由人决定或取消。
- 取消：run 按现有 `cancelled` 处理；评审不写“已通过”。
- 记录：Q/A 写进 `review.md`；verdict 的 reason 如引用人答复，标明“人工确认”。

## 5 兼容与发布

- 加法字段，旧任务/旧 client 不受影响；没有 `confirmation` 时 review 行为与现在一致。
- **v1 以 client/orchestrator 同版本发布为前提**（单机常态版本，0.6.2 一起发）；混跑旧 client 时，review prompt 会提到 confirm 但工具未挂，需能力协商，另立任务。
- 发布顺序：契约/调度/orchestrator → client → 技能 seed → 真实 client 联调 → 发版。
- UI 复用现有 `waiting_confirm` 待确认视图；不改 UI 代码，只验证 review 节点的确认能正常显示/答复。

## 6 测试计划

- orchestrator prompt 单测：agent/review 两段文案；review 节点 prompt 含严格通道。
- 调度：`TaskDraft.confirmation` 合法/非法；`S-05` 稳定内容；`C-13`/`C-15` 契约。
- run：review confirm → `waiting_confirm`；`decide pass` → 续跑 → verdict；`decide reject` → 续跑 → verdict；确认前不结算；agent confirm 回归。
- client：两契约 prepare/mount/collect；两个工具；缺 `confirmation` 的旧任务；不支持的 kind；schema 投影。
- E2E：真实 client + DSH 的 review pass/reject/无答复/取消；Q/A 落 `review.md`。
- 技能：seed 测试；`auto-confirm`/`review-verdict`/`arch-reviewer` 文本断言（如有）。

## 7 风险

| 风险 | 应对 |
|---|---|
| 评审把判断外包给人 | prompt/skill 明确“只问事实/口径，不问该不该通过”；评审仍须给 verdict |
| confirm 被滥用，run 频繁暂停 | v1 每个 review 访问最多 1 问；观察后再加服务端计数 |
| 旧 client 没挂 confirm | 同版本发布；混跑另立能力协商 |
| 人答复与证据冲突 | 评审自行判断；人答复只作输入，不作 verdict |
| 无答复长期挂起 | 现有 `waiting_confirm` 语义；UI 可见；不自动通过 |

## 8 待确认

1. 级别 P2 / P1。
2. 契约形状：可选 `confirmation`（推荐）/ `resultSignals[]` / `allowConfirm`。
3. 评审范围：全部 review 节点 / 仅架构评审。
4. 次数上限：v1 prompt 约束 / 服务端计数。
5. 无答复：一直等待（推荐）/ 超时失败。
6. 旧 client：同版本发布（推荐）/ 能力协商。
