---
layer: works
module: global
status: active
updated: 2026-11-19
procedure: 2026-11-19-confirm-channel-escalation
---

# 联调记录：review 应急确认（真实 client + DSH）

## 1 结论

真实 client（含本次多契约改动）+ 真实 DSH + 本机 orchestrator 跑通四条路径：**pass、reject、无答复、取消**。

- review 任务实际挂上 `mcp__agentflow__signal` 与 `mcp__agentflow__confirm` 两个工具；模型调 `confirm` 后结果带 `confirmation_request` 与 `sessionId`。
- run 进入 `waiting_confirm`；人工 `decide pass/reject` 后续跑同一 session，prompt 注入 `[人工确认]`；评审仍自行提交 `review_verdict`。
- 无答复保持等待、不自动 pass；取消后 run `cancelled`、节点 `failed(cancelled)`、不产生 verdict。
- Q/A 实际写入 task-space 的 `review.md`，并标明「人答复不是 verdict」。

## 2 环境

| 项 | 值 |
|---|---|
| orchestrator | 本机 `http://127.0.0.1:3100`，本工序实现（commit `aa7033d` 之后） |
| client | `agent-flow-client` 工作区改动（未提交；包含本工序 `T-CCE-04` 的多契约实现） |
| client 进程 | `serve`，独立 `client_id=e2e-review-confirm`，config 与 state 在 `.local/e2e/2026-11-19-confirm/` |
| DSH | client `.env` 指向的本机 DSH 与模型（`hs-deepseek-flash-latest`） |
| harness | `e2e-review-confirm`（本机 dev DB，联调夹具） |
| workflow | `E2E-REVIEW-CONFIRM`：`start → review → end`，review 回退边指向 start |
| workspace | `.local/e2e/2026-11-19-confirm/workspace`（独立 git 根，避免污染项目仓库） |
| 隔离 | 未使用正在运行的旧 client（`chenlong-mac-01`），避免旧代码抢先执行 |

## 3 四条路径

| 路径 | run | 观察 |
|---|---|---|
| pass | `01a1f398-e363-73bb-a486-024d37ef8b74` | review 提问「按 A 还是 B 判定」→ run `waiting_confirm`；`decide pass`（按 A）→ 续跑任务 `resumeSessionId=0b21d93a…`；评审提交 `verdict=fail`（联调无产物）→ 节点 `rejected`，回退 start `visit=2`；随后人工取消 |
| reject | `01a1f39c-11b7-72ec-93ec-96bb599e533e` | review 提问 → `decide reject`（按 B、记录证据缺失）→ 续跑同一 session `54574ff8…`，prompt 含「人工决定：拒绝」与拒绝意见；评审提交 `verdict=fail` → 节点 `rejected`；随后取消 |
| 无答复 | `01a1f39e-b5fe-727d-9950-cfb35ed3ba3a` | report 后 run 保持 `waiting_confirm` 至少 15s，无新任务、无自动 pass；节点无 verdict |
| 取消 | 同上 | `POST /cancel` → run `done/cancelled`，review 节点 `failed(cancelled)`、`verdict=null`，未写「已通过」 |

## 4 证据

### 4.1 client 侧双工具与信号

[`evidence/client-serve.out`](evidence/client-serve.out)（已脱敏，仅任务 ID 与状态）：

```text
signal.prepared {"taskId":"01a1f399-…","attempt":1,"kinds":["review_verdict","confirmation_request"]}
signal.collected {"taskId":"01a1f399-…","count":1,"kinds":["confirmation_request"]}
task.reported  {"status":"succeeded","sessionId":"0b21d93a-…","signals":{"count":1,"kinds":["confirmation_request"]}}
```

续跑任务：

```text
signal.prepared {"taskId":"01a1f39a-…","attempt":1,"kinds":["review_verdict","confirmation_request"]}
signal.collected {"taskId":"01a1f39a-…","count":1,"kinds":["review_verdict"]}
task.reported  {"status":"succeeded","sessionId":"0b21d93a-…","signals":{"count":1,"kinds":["review_verdict"]},
                "resumeSessionId":"0b21d93a-…","continuation":true}
```

### 4.2 任务表冻结的两个契约

直接查 dev DB（`task.result_signal`）：

```json
{"resultSignal":{"kind":"review_verdict","required":true,...},
 "confirmation":{"kind":"confirmation_request","required":false,...}}
```

续跑任务的 `resume_session_id` 等于原确认任务的 `sessionId`；`[人工确认]` 块在 prompt 中，pass/reject 两种文案均出现。

### 4.3 Q/A 落 review.md

- pass 路径：[`evidence/review-pass.md`](evidence/review-pass.md) §3「人工确认记录」：问题、决定 `pass`、回答「按 A 判定，以 intent.md 口径为准」，并写明「确认通道的通过仅表示确认请求被接受并给出答复，不等于实现准出通过；verdict 由评审独立提交」。
- reject 路径：[`evidence/review-reject.md`](evidence/review-reject.md) §3「确认记录（reject 路径）」：决定「拒绝（不按 A）」、回答「按 B…按 B 记录缺失后给 fail」，并写明「不再重复被拒的 A 方案，也不重复提问」。

### 4.4 run 快照

三条 run 的最终节点状态见 [`evidence/runs.json`](evidence/runs.json)。pass/reject 两条在取消前都已观察到 review `rejected` 与 start `visit=2` 派发；取消只用于收尾，不影响确认路径的结论。

## 5 发现与边界

1. **非阻塞**：e2e client 启动时观测面端口 `17890` 被正在运行的旧 client 占用，日志出现 `observability_disabled` 警告；不影响任务执行与信号。联调使用独立 state root，未抢占旧 client。
2. **未验证**：client 侧完整测试套件由 client 自己声明 255 pass；本工序未在 client 仓库重跑 `bun run check`（跨仓库执行与写入边界不在本工序范围）。本次用真实执行路径验证了双工具、采集与续跑。
3. **未提交**：client 改动仍在工作区；联调通过的是该工作区版本。client 提交/发布另行处理。
4. **夹具残留**：`e2e-review-confirm` harness、`E2E-REVIEW-CONFIRM` workflow 与三次 run 留在本机 dev DB；`.local/e2e/2026-11-19-confirm/` 为本地证据目录（已 ignore）。
5. **次数上限**：模型每次访问只问了一个问题，未观察到重复问；服务端计数仍未实现（proposal 的 v1 约束）。

## 6 复跑方式

```bash
# 1. client（系统终端；需 unset DSH_HOME，避免被本机 DSH 的 home 覆盖）
cd /Users/chenlong/harness/agent-flow-client
env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID \
  -u DSH_WEB_URL -u DSH_INSTALL_DIR -u DSH_NODE_EXECUTABLE \
  bun run src/cli.ts serve --config \
  /Users/chenlong/harness/agent-flow-orchaster/.local/e2e/2026-11-19-confirm/client.toml

# 2. 起 run（harness/workflow ID 从 .local/e2e/2026-11-19-confirm/ids.json 取）
# 3. 轮询 GET /api/v1/runs/{id} 直到 waiting_confirm
# 4. POST /api/v1/runs/{id}/nodes/n2/decision {decision, comment}
# 5. 观察续跑任务、review_verdict 与 review.md
```
