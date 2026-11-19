---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-run-timeout-resume
level: P1
---

# UI 对接提案：超时节点继续执行

> 面向 `agent-flow-ui` 的接口与交互对接说明。后端已实现并通过验证；本仓库不改 UI 代码。UI 只调用编排侧 HTTP API，不直连 client。

## 1 结论

超时节点现在不会直接把 run 判死。后端把 run 与节点置为 `waiting_resume`，UI 增加一个「继续执行」动作，调用：

```http
POST /api/v1/runs/{id}/nodes/{nodeId}/resume
```

后端会把**同一个 task** 从 `done(timeout)` 重开为下一 attempt，写入节点已有的 `session_id`；client 下一次 poll 拿到同一 `taskId` 的新 attempt，用 `session/resume` 继续原会话。UI 不需要改 client、不需要传 sessionId、不需要新建 run。

## 2 UI 需要感知的变化

### 2.1 新增状态值

| 枚举 | 新增值 | 含义 |
|---|---|---|
| `RunState` | `waiting_resume` | run 因当前节点超时而等待人工续跑；无在跑任务、无 `finished_at`、不归档 |
| `RunNodeState` | `waiting_resume` | 当前节点超时，等待续跑；`error` 保留超时码；`finishedAt=null` |

- `GET /api/v1/runs/{id}` 直接返回这两个状态；`GET /api/v1/runs?state=waiting_resume` 也可过滤。
- 不需要新增字段：节点仍返回 `taskId`、`visit`、`error`；**不返回 `sessionId`**。
- run 的 `outcome` 为 `null`、`finishedAt` 为 `null`、`archiveState` 通常为 `none`。

### 2.2 新增端点

| 项 | 值 |
|---|---|
| 方法/路径 | `POST /api/v1/runs/{id}/nodes/{nodeId}/resume` |
| 请求体 | 无 |
| 成功 | `200` + `RunDetail` |
| 鉴权 | 沿用现状（本机无鉴权） |
| OpenAPI | `API-54`，`operationId=resumeRunNode` |

## 3 页面与交互

### 3.1 run 详情页

- run 状态展示：`waiting_resume` 显示「执行超时，等待继续」或「等待继续执行」，不要显示成「失败」或「已完成」。
- 当前节点卡片：
  - 状态徽标：`waiting_resume` → 「超时，等待继续」。
  - 展示 `error.code` 与 `error.message`：`timeout` / `prompt_timeout` / `idle_timeout`。建议附一句「节点执行超过 30 分钟被客户端中断」。
  - 主按钮：「继续执行」；次按钮沿用现有「取消运行」。
  - 提示文案：**「使用原任务、原会话继续；不会新建运行。继续后仍可能再次超时。」**
  - 等待期提示：**「等待期间该工作区不能启动新的运行，直到继续或取消。」**
- 非当前节点的历史行不显示该按钮；只在 `state=waiting_resume` 的节点上显示。

### 3.2 点击「继续执行」

1. 立即禁用按钮，显示「正在继续…」，防止重复点击。
2. 调用 `POST /api/v1/runs/{id}/nodes/{nodeId}/resume`，不传 body。
3. `200`：用响应 `RunDetail` 更新页面（或重新 `GET`）；run 变 `running`、节点变 `dispatched`，按钮消失；提示「已提交，等待客户端执行」。
4. `409`：按 `error.details.reason` 提示，并刷新 run 详情；常见原因见 §5。
5. `404`：run/节点不存在，提示并返回列表。
6. `503`/网络错误：保留按钮，提示可重试；不要本地改成成功。

### 3.3 点击后客户端离线

- 后端把任务置为 `queued`/`dispatched`，run 变 `running`；UI 看到节点 `dispatched` 但没有新日志/消息是正常的。
- 不新增「等待客户端领取」状态；沿用现有「已派发」展示。若长时间无进展，用户可取消。
- 不要把「节点 dispatched 但无输出」误判为失败。

### 3.4 取消

- 等待期仍调用现有 `POST /api/v1/runs/{id}/cancel`；后端把节点置 `failed(cancelled)`、run `cancelled`，无在跑任务可取消。
- 取消后按钮消失，按现有终态展示。

### 3.5 轮询

- run 详情没有推送；沿用 UI 现有轮询节奏。点击成功后至少再拉一次详情，避免停留在旧状态。
- 续跑后 client 的结果仍按原流程更新；UI 不需要新增事件通道。

## 4 DTO 与示例

### 4.1 等待中的 run 详情（节选）

```json
{
  "runId": "01a1ee50-cd00-7745-be97-333f7c25c03f",
  "state": "waiting_resume",
  "outcome": null,
  "currentNodeId": "n3",
  "archiveState": "none",
  "finishedAt": null,
  "error": null,
  "nodes": [
    {
      "nodeId": "n1",
      "nodeType": "start",
      "visit": 1,
      "state": "succeeded",
      "taskId": "01a1ee50-cd08-74bf-81f6-9f7dbe574bec",
      "verdict": null,
      "message": "启动节点已完成",
      "error": null,
      "dispatchedAt": "2026-11-18T11:00:35.209Z",
      "finishedAt": "2026-11-18T11:00:43.383Z"
    },
    {
      "nodeId": "n3",
      "nodeType": "agent",
      "visit": 1,
      "state": "waiting_resume",
      "taskId": "01a1ee50-ecfa-7286-8bbe-f436b860829d",
      "verdict": null,
      "message": "I'll start by reading the task-space intent...",
      "error": {
        "code": "timeout",
        "message": "prompt 超时（1800000ms）"
      },
      "dispatchedAt": "2026-11-18T11:00:43.389Z",
      "finishedAt": null
    }
  ]
}
```

- `state`/`error` 是 UI 判断是否显示按钮的唯一依据；不要依赖 `finishedAt` 是否为空。
- `taskId` 可能被 UI 用来做日志/session 查询，但**不要展示 sessionId**（响应里也没有）。

### 4.2 续跑成功响应

`200` 返回完整 `RunDetail`；关键变化：

```json
{
  "state": "running",
  "outcome": null,
  "nodes": [
    {
      "nodeId": "n3",
      "state": "dispatched",
      "taskId": "01a1ee50-ecfa-7286-8bbe-f436b860829d",
      "error": null,
      "finishedAt": null
    }
  ]
}
```

同一 `taskId`、同一 `visit`；`attempt` 不在 `RunNodeView` 中暴露，UI 不需要感知。

### 4.3 错误响应

```json
{
  "error": {
    "code": "invalid_state",
    "message": "当前状态不允许该操作：node_not_waiting_resume",
    "details": { "reason": "node_not_waiting_resume" }
  }
}
```

## 5 错误与处理

| HTTP | `error.code` / `details.reason` | UI 处理 |
|---|---|---|
| 409 | `invalid_state` / `node_not_waiting_resume` | 状态已变化（可能已被别人点过/已取消）；刷新详情，不弹成功 |
| 409 | `invalid_state` / `task_missing` | 节点没有 taskId；提示无法续跑，刷新 |
| 409 | `invalid_state` / `session_missing` | 超时结果没有 sessionId，后端本不会进入等待；刷新 |
| 409 | `invalid_state` / `instance_not_dispatchable` | 节点已停用/实例不可用；提示联系管理员，刷新 |
| 409 | `invalid_state` / `task_not_resumable` | 任务不是可重开的 timeout 状态；刷新，必要时取消 |
| 404 | `not_found` | run/节点不存在；返回列表 |
| 503 | `service_unavailable` | 数据库/调度器暂不可用；保留按钮，提示重试 |

- 重复点击：第一次成功后节点变 `dispatched`；后端幂等返回 `200`。UI 仍应在请求期间禁用按钮。
- 不要在前端伪造成功；以响应或重新拉取为准。

## 6 文案建议

| 位置 | 文案 |
|---|---|
| run 状态 | 执行超时，等待继续 |
| 节点状态 | 超时，等待继续 |
| 主按钮 | 继续执行 |
| 按钮 loading | 正在继续… |
| 成功提示 | 已提交，等待客户端执行 |
| 提示 | 使用原任务、原会话继续；不会新建运行。继续后仍可能再次超时。 |
| 等待期提示 | 等待期间该工作区不能启动新的运行。 |
| 错误（通用） | 继续失败：状态已变化，请刷新后重试。 |

## 7 现有页面的兼容

- run 列表/详情如果已有状态映射，需要新增 `waiting_resume`；未知状态不要落到「失败」。
- 状态筛选项若有 `state` 下拉，加「等待继续」。
- 归档状态通常为 `none`；不要因为 `archiveState=none` 隐藏整个运行。
- 节点「会话日志」仍按 `visit`/`attempt` 读取；续跑后同一 visit 的 attempt 递增，旧 attempt 日志保留，UI 不必特殊处理。
- **已知 client 侧问题（需要 client 改）**：续跑后同一 `sessionId` 下会有多个 attempt，client 的 `/sessions/{sessionId}` 当前按目录顺序返回第一条 attempt（旧超时），实时 session 视图可能显示旧状态；run 状态、任务执行与 session-log 不受影响。修复点在 client `FileAttemptStore.findBySession`：按 `startedAt` 倒序（同刻用 `attemptNo`）取最新 attempt，而不是 `all.find` 取第一条。UI 与 orchestrator 不需要改代码；UI 在 client 修复前可用 `session-log` 的 attempt 作为兜底。

## 8 验收清单

1. 打开 `waiting_resume` 的 run：run 与节点显示等待态；超时码可见；按钮只在等待节点上出现。
2. 点击继续：按钮进入 loading；`200` 后 run `running`、节点 `dispatched`、按钮消失；提示已提交。
3. 重复点击/并发点击：不产生重复任务；第二次请求不报未处理异常。
4. 409：按 reason 提示，刷新后状态一致。
5. 取消：等待期取消后 run `cancelled`、节点 `failed`，按钮消失。
6. 客户端离线：点击后节点 `dispatched` 且无输出，UI 不误判失败；客户端恢复后继续。
7. 列表/筛选：`state=waiting_resume` 可查到；列表状态文案正确。
8. 移动端/桌面端关键视口：按钮、超时码、提示不溢出；loading/禁用/错误态可见。

## 9 联调与发布

- 后端代码已就绪；启动 `bun run dev` 后 `127.0.0.1:3100` 提供该端点，UI 可直接对接。当前本地 dev 进程已被手动停止，联调前先启动。
- client 无需改动；client 已在 confirm 链路验证 `session/resume`。联调时 client 必须运行并在 poll。
- 发布顺序：后端已就绪 → UI 适配 `waiting_resume` 与按钮 → 联调。UI 未适配前不要把等待态暴露给用户，否则会显示未知状态。
- 回滚：UI 隐藏按钮即可；后端无配置开关；已处于等待态的 run 需续跑或取消。

## 10 可直接用于联调的样例

当前有一条已修到等待态的真实 run（**点击会真的开始续跑并消耗 token**，只在确认 client 在线时使用）：

- run：`01a1ee50-cd00-7745-be97-333f7c25c03f`
- 节点：`n3`
- task：`01a1ee50-ecfa-7286-8bbe-f436b860829d`
- 当前：run `waiting_resume`、`archiveState=none`、`outcome=null`；n3 `waiting_resume`、`error.code=timeout`、`taskId` 保留（session 在后端，UI 不展示）
- 调用：`POST /api/v1/runs/01a1ee50-cd00-7745-be97-333f7c25c03f/nodes/n3/resume`

自动化测试请使用测试库/测试 run，不要用这条真实记录反复点击。

## 11 边界

- 不新增 TTL/次数上限：等待 run 会占住工作区，直到继续或取消。
- 没有「给模型留言」的输入框：端点无请求体；人工备注不在本期。
- 不新增推送/SSE；沿用现有轮询。
- 不暴露 `sessionId`/`attempt`；UI 只用 `state`、`taskId`、`error`、`visit`。
- 不覆盖 `S-02` 未回报超时（没有 sessionId，不会进入 `waiting_resume`）。

## 12 参考

- OpenAPI：`src/components/http-gateway/openapi.yaml` 的 `API-54` / `resumeRunNode`
- 现行契约：[`CMP-run`](../../design/components/run/spec.md)、[`CMP-scheduler`](../../design/components/scheduler/spec.md)、[`CMP-http-gateway`](../../design/components/http-gateway/spec.md) §4.1.1
- 场景：[`SCN-0306`](../../design/scenarios/workflow-orchestration/workflow-execution/timeout-resume/scenario.md)
- 交付结果：[`result.md`](result.md)
