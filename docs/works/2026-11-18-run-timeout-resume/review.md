---
layer: works
module: run
status: closed
updated: 2026-11-18
procedure: 2026-11-18-run-timeout-resume
level: P1
---

# 评审：超时节点继续跑

## 1 范围

本轮 diff 覆盖 `CMP-run`、`CMP-scheduler`、`CMP-http-gateway`、迁移 `0012`、测试与规格/场景。评审对象是「同一 task 重开 attempt」方案，不包含 UI 与 client 改动。

## 2 四档裁决

### Blocker

无。`bun run check` 通过（428 pass / 1 skip），`bun run quality:report` 违规 0 条；真实服务 `/openapi.yaml` 已含续跑端点。

### Decision now

| ID | 决策 | 落点 |
|---|---|---|
| D-01 | 续跑不新开 task/visit，改为 scheduler `resumeTask` 把 `done(timeout)` 重开为下一 attempt | `scheduler/store.ts#reopen`、`scheduler/resume.ts`、`run/spec.md` |
| D-02 | `acceptResult` 增加 `(taskId, attempt)` 已结算防重，避免重开后旧结果二次结算 | `scheduler/result.ts`、`scheduler/store.ts#findAttempt` |
| D-03 | 不做 TTL / 次数上限；等待期由人工续跑或取消 | `run/spec.md`、`brief.md` |
| D-04 | 续跑复用原 prompt/快照，只改 `attempt` 与 `resume_session_id` | `dispatch`/prompt 无改动；`scheduler/store.ts#reopen` |

已落 pinning test：`TC-EXR-006`、`TC-EXR-007`、`TC-RUN-017`、`TC-RUN-018`。

### Verified sound

- run：timeout + `sessionId` 进入 `waiting_resume`；`finishedAt`/`outcome` 为空；无 session 仍失败（`TC-RUN-017`/`TC-RUN-020`）。
- HTTP：`POST /runs/{id}/nodes/{nodeId}/resume` 后 client 拿到同一 `taskId`、`attempt+1`、`resumeSessionId`；原 prompt 不变；attempt 2 结果正常推进（`TC-RUN-018`）。
- 取消：等待期取消走 `failed(cancelled)`/`cancelled`，无在跑任务，不归档（`TC-RUN-019`）。
- scheduler：`resumeTask` 幂等；非 timeout 不可重开；旧 attempt 迟到结果 `accepted=false`；新 attempt 正常结算（`TC-EXR-006`/`TC-EXR-007`）。
- 迁移：状态 check 与活跃唯一索引包含 `waiting_resume`；`run_artifact` 键未改，旧日志保留。
- 指定 run：`01a1ee50-cd00-7745-be97-333f7c25c03f` 已修到 `waiting_resume`，节点 n3 保持原 `task_id`/`session_id`，未提前续跑。

### Hold

| ID | 事项 | 不阻塞理由 | 去向 |
|---|---|---|---|
| H-01 | confirm 同 visit 续跑的两份日志仍落同一 `run_artifact` 键（后到覆盖） | 与本轮 timeout 续跑无关；本轮用 attempt+1 已避免同类冲突 | 另立工序 |
| H-02 | 人工续跑与 `S-02` 未回报回队共用 `attempt`，会消耗 `taskMaxAttempts` | 只在未回报重派路径生效；client 正常回报 timeout 时不受影响 | `scheduler/spec.md` §8 待定 |
| H-03 | UI 尚未展示 `waiting_resume` / 调用续跑端点 | 独立项目承接；后端契约已就绪 | `T-RTR-06` |

## 3 结论

**通过**。无 blocker；D-01–D-04 已落文档与 pinning test；H-01–H-03 已转出，不阻塞后端合并。指定 run 已可等 UI 接入后调用续跑端点。
