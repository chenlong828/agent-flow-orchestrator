---
layer: works
module: global
status: active
updated: 2026-11-18
procedure: 2026-11-18-review-verdict-mcp
---

# UI 对接提案：执行中确认点（confirmation_request）

> 面向 `agent-flow-ui` 的对接开发。结论先说：**不需要新端点、不需要新状态**；UI 只需在现有 `waiting_confirm` 节点上按 `RunNodeView.verdict.kind` 分支，新增一种「执行中确认」卡片。`confirm` 节点的原有行为保持不变。
>
> 上游契约：[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md)；产品 API：[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) 的 `API-46`。本提案只定 UI 消费方式，不改后端接口。

## 1 背景

原来的 `waiting_confirm` 只对应 `confirm` 节点：人工 `pass` 继续、`reject` 回退。现在新增第二场景：

1. `agent`/design 节点执行中需要人拍板；
2. 模型调用 `mcp__agentflow__confirm` 提交 `confirmation_request`，然后停止本轮；
3. 任务以 `succeeded` 结算，run 进入 `waiting_confirm`；
4. 人在 UI 里回答；
5. 编排创建**续跑任务**，在同一 session 里继续当前节点；`visit` 不变、`task_id` 替换。

因此 UI 不能把这类等待简单当成 `confirm` 节点：`reject` 不是“回退”，而是“带拒绝意见继续”。

## 2 现有 API 已够用

| 用途 | 接口 | 变化 |
|---|---|---|
| 运行列表 | `GET /api/v1/runs?state=waiting_confirm` | 无需改 |
| 运行详情 | `GET /api/v1/runs/{id}` | `nodes[].verdict` 已返回，无需改 |
| 提交决策 | `POST /api/v1/runs/{id}/nodes/{nodeId}/decision` | 请求体不变：`{decision:"pass"|"reject", comment?}` |
| 刷新 | 决策响应直接返回更新后的 `RunDetail` | 无需二次请求 |

BFF/UI DTO **不需要新增字段**；确认所需的问题、上下文、选项都在 `RunNodeView.verdict` 里。不要把这些字段再拆成新的后端端点或新状态。

### 2.1 决策错误映射

| HTTP | `error.code` | UI 处理 |
|---|---|---|
| 400 | `validation_error` | 修正 `decision`/`comment` 后重试；不要循环自动提交 |
| 404 | `not_found` | 运行/节点已不存在；关闭弹层并刷新列表 |
| 409 | `invalid_state` | 已被其他端处理或状态已变化；刷新详情，不再提交 |
| 503 | `service_unavailable` | 显示可重试提示；保留用户输入，人工重试 |

`comment` 只接受字符串；不要传对象或 `answer` 字段。未知请求字段会被拒绝。

## 3 前端识别规则

`waiting_confirm` 有两种来源，按以下顺序判断：

```ts
type ConfirmationRequest = {
  kind: "confirmation_request";
  question: string;
  context?: string;
  options?: string[];
  allowFreeText?: boolean;
};

function confirmationOf(runNode) {
  if (runNode.state !== "waiting_confirm") return null;
  const verdict = runNode.verdict;
  if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) return null;
  if (verdict.kind !== "confirmation_request") return null;
  if (typeof verdict.question !== "string" || verdict.question.trim() === "") return null;
  return verdict as ConfirmationRequest;
}
```

判断结果：

| 条件 | 类型 | 卡片 |
|---|---|---|
| `node.nodeType === "confirm"` 且 `state=waiting_confirm` | 节点级确认 | 保持现有「批准 / 驳回」 |
| `confirmationOf(runNode) !== null` | 执行中确认点 | 新增「确认并继续 / 拒绝并反馈」 |
| `waiting_confirm` 但两个条件都不满足 | 异常/旧数据 | 只读提示，不提交；刷新后重试 |

注意：不要只按 `nodeType === "agent"` 判断；以 `verdict.kind` 为准，后续 design 等节点也可以复用。`confirm` 节点的 `taskId` 为 `null`；执行中确认点的 `taskId` 通常非空（首次任务已结算）。

## 4 `RunNodeView` 实际形状

等待中的执行中确认点示例：

```json
{
  "nodeId": "n2",
  "nodeType": "agent",
  "visit": 1,
  "state": "waiting_confirm",
  "taskId": "01a1ed84-8166-7299-86f7-614711e7c1e4",
  "verdict": {
    "kind": "confirmation_request",
    "question": "是否允许修改契约？",
    "context": "A 方案改动小，B 方案可扩展；需要人拍板。",
    "options": ["允许", "拒绝"],
    "allowFreeText": true
  },
  "enterReason": null,
  "message": "模型给出的补充说明",
  "error": null,
  "dispatchedAt": "2026-11-18T07:17:26.500Z",
  "finishedAt": null
}
```

字段约定：

| 字段 | 用途 | 注意 |
|---|---|---|
| `verdict.question` | 必填，卡片主问题 | 不要为空；异常时空态 |
| `verdict.context` | 可选，为什么需要人决定 | Markdown 文本，按现有 Markdown 渲染 |
| `verdict.options` | 可选，候选答案 | 最多 8 个字符串；用单选/选项按钮 |
| `verdict.allowFreeText` | 可选，是否允许自由文本补充 | 不强制 UI 行为；v1 建议始终保留“补充说明” |
| `message` | 模型本轮说明 | 可作为卡片副标题/折叠说明，不替代 `question` |
| `taskId` | 与本轮关联的任务 | 非空时“执行会话/会话日志”可正常使用；不要沿用 `confirm` 节点的“无会话”文案 |
| `visit` | 轮次 | 确认点续跑**不增加** visit；历史轮次不显示确认卡 |

## 5 卡片交互

### 5.1 执行中确认点

```text
执行中确认 · <节点名>
[?] 是否允许修改契约？
上下文：A 方案改动小，B 方案可扩展；需要人拍板。
( ) 允许   ( ) 拒绝
补充说明（可选）
[确认并继续]  [拒绝并反馈]
```

- 有 `options` 时显示单选；没有时直接显示补充输入框。
- 选择项 + 补充说明统一拼进 `comment`，**不要新增 `answer` 字段**：
  - 选“允许”，补充“按 B 做” → `comment = "允许\n按 B 做"`；
  - 选“拒绝”，补充“改为软删除” → `comment = "拒绝\n改为软删除"`。
- `pass` 时 `comment` 可为空；`reject` 时 `comment` 必填（至少选一个选项或填写原因）。
- 提交时按钮置灰，防止重复点击。
- 成功文案：
  - pass：`已确认，继续执行`
  - reject：`已拒绝，意见已反馈`
  - **不要**写 `已驳回，流程回退`；执行中确认的 reject 不触发回退。
- 成功响应直接是 `RunDetail`；立即重绘，保留弹层；之后 5s 轮询会看到节点 `dispatched` → `succeeded`。
- 响应是更新后的 `RunDetail`，关键变化示例：

```json
{
  "state": "running",
  "currentNodeId": "n2",
  "nodes": [
    {
      "nodeId": "n2",
      "visit": 1,
      "state": "dispatched",
      "taskId": "<新的续跑 taskId>",
      "verdict": { "kind": "confirmation_request", "question": "是否允许修改契约？" }
    }
  ]
}
```

不要依赖 `taskId` 不变；确认点续跑会替换 `taskId`，但 `visit` 保持为 1。

### 5.2 `confirm` 节点不回归

`confirm` 节点继续使用现有逻辑：

- 标题“待人工确认”；
- 显示 `message`；
- 按钮“批准，继续执行”/“驳回”；
- 驳回必填意见，toast 仍是“已驳回，流程回退”；
- 行为不变。

建议把卡片渲染函数参数化为 `mode: "confirm" | "confirmation"`，不要复制两套 DOM；确认点额外渲染 `question/context/options`，其余复用。

## 6 详情页其他位置

| 位置 | 处理 |
|---|---|
| 运行列表 `waiting_confirm` 行 | 仍显示“去确认”；不需要区分两种来源 |
| 弹层标题/轮次 | 维持“最新轮可确认、历史轮只读” |
| 概要 Tab | `confirm` 节点展示 `message`；确认点优先展示 `question/context/options`，`verdict` 原始 JSON 放折叠区 |
| 会话日志 Tab | 按 `taskId` 判断：有 `taskId` 的执行中确认点可下载；`confirm` 节点没有任务，保留“无执行会话”文案 |
| 执行会话 Tab | 同上；确认点首次任务有 session；续跑期间轮询到 `dispatched` 后正常显示 |
| 终态/取消 | 不新增按钮；取消逻辑不变 |

## 7 轮询与竞态

1. 提交前记录 `runId + nodeId + visit`；响应回来时如果弹层已切到别的节点/轮次，只刷新列表，不要用旧响应覆盖当前弹层。
2. 决策成功后，run 从 `waiting_confirm` 变成 `running`，当前节点从 `waiting_confirm` 变成 `dispatched`，`taskId` 变化；弹层保持打开并跟随最新轮。
3. 网络超时/409 等失败：恢复按钮，提示后重新 `GET /runs/{id}`；不要乐观地把节点标成成功。
4. 轮询覆盖确认卡时，用 `state + verdict.kind + question + options` 做 key；只在内容变化时重建输入框，避免用户输入被轮询清空。

## 8 验收清单（UI）

| ID | 场景 | 断言 |
|---|---|---|
| `UI-CONF-01` | 执行中确认点等待 | 卡片标题为“执行中确认”；显示 `question/context/options`；不显示 `confirm` 节点的“批准/驳回”文案 |
| `UI-CONF-02` | pass | 请求体 `{decision:"pass", comment: selected + 补充}`；成功后 toast“已确认，继续执行”；节点变 `dispatched`，visit 不变 |
| `UI-CONF-03` | reject | 请求体带必填 `comment`；toast“已拒绝，意见已反馈”；不出现“流程回退”；后续轮询节点最终成功 |
| `UI-CONF-04` | 选项 + 自由文本 | `comment` 按“选项 + 换行 + 补充”序列化；无 `answer` 字段 |
| `UI-CONF-05` | `confirm` 节点回归 | 批准/驳回、驳回回退、toast 与现状完全一致 |
| `UI-CONF-06` | 旧数据/异常 verdict | 只读提示，不提交；刷新后恢复 |
| `UI-CONF-07` | 重复提交 | 提交中按钮禁用；409 后刷新，不重复弹 toast |
| `UI-CONF-08` | 历史轮 | 只有最新轮出现确认卡；历史轮只读 |

## 8.1 review verdict 的 UI 影响

review 的结果同样通过 MCP 信号回传，但对 UI **没有新的接字段**：

- `review` 节点结算后的 `RunNodeView.verdict` 仍是 `{verdict:"pass"|"fail", reason, evidence?}`；UI 现有概要 Tab 的 `verdict` 展示继续可用。
- review 不再产生 `waiting_confirm` 的 `needs_human` 分支；因此 UI 的确认卡只应来自 `confirm` 节点或 `confirmation_request` 确认点。
- 建议但不必需：概要 Tab 对 review 的 `evidence` 数组做列表展示，避免整段 JSON 难读。
- review `fail` 导致节点 `rejected` 并沿回退边重跑，沿用现有历史轮/回退展示，不需要新交互。

## 9 明确不做

- 不新增后端端点、run 状态、节点状态或数据库字段。
- 不让 UI 生成或修改 `resultSignal`；它只消费 `RunNodeView.verdict`。
- 不把 `comment` 拆成结构化 `answer`；编排侧已经约定统一用 `comment` 注入续跑 prompt。
- 不在 UI 里判断 review 的 `verdict` 业务正确性；review 的 `pass/fail` 仍由编排/评审节点决定。
- 不在本轮做多确认点并行、跨节点消息总线或确认超时策略。

## 10 UI 最小实施清单

1. 在 `assets/js/run/node-view.js` 增加 `confirmationOf(runNode)`，按 §3 判断，不要只判断 `nodeType`。
2. 把 `confirmCard(node, runNode)` 参数化为 `confirmCard(node, runNode, mode)`：
   - `mode="confirm"` 保持现 DOM 与文案；
   - `mode="confirmation"` 渲染 `question`、`context`、`options`、补充输入框。
3. 调整 `confirmKey`（`instance-detail.js`）：确认点 key 至少包含 `state|verdict.kind|question|options`，避免 5s 轮询把用户正在输入的内容清空。
4. 调整 `bindConfirm`：
   - `mode="confirmation"` 时按 §5.1 拼 `comment`；
   - 成功 toast 用“已确认/已拒绝，意见已反馈”，不要“流程回退”；
   - 失败按 §2.1 映射，409 刷新，不重复提交。
5. 概要 Tab：确认点优先渲染结构化 `question/context/options`；`verdict` 原文放折叠区。
6. 回归 `confirm` 节点：按钮、驳回必填、回退 toast、历史轮只读都不能变。
7. 新增 `UI-CONF-01`–`08` 测试；至少覆盖 pass/reject、选项+文本、`confirm` 回归、409、历史轮。

## 11 参考

- 后端实现与真实联调证据：[`result.md`](result.md)
- 执行中确认点设计：[`human-interaction.md`](human-interaction.md)
- 运行编排状态机：[`run/spec.md`](../../design/components/run/spec.md)
- UI 现状：`agent-flow-ui/assets/js/run/node-view.js` 的 `confirmCard`、`agent-flow-ui/assets/js/pages/instance-detail.js` 的 `resolveModal`/`bindConfirm`
