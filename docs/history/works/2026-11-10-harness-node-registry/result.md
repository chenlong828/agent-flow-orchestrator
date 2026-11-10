---
layer: history
module: global
status: frozen
updated: 2026-11-10
procedure: 2026-11-10-harness-node-registry
---

# 结果：Harness 作为 client 节点目录（第一期设计）

## 1 验收对照

| 判据（[`brief.md`](brief.md) §5） | 结果 | 证据 |
|---|---|---|
| 子决策有选项、代价与推荐，可指回契约/规格 | 满足 | [`node-registry-options.md`](node-registry-options.md) `N-01`–`N-08`；用户采纳推荐组合（2026-11-10） |
| 推荐组合不违反 `executor-http-v2` | 满足 | 不改契约；容量只由 `free` 表达；无注册/心跳；节点停用只停新增派发 |
| 在线状态有唯一数据所有权与推导口径 | 满足 | `harness` §3.3（判定表）+ `scheduler` §3.3/§4.8（presence 读）；Harness 表不写状态 |
| 迁移与兼容影响写清 | 满足 | 决策记录 §1.8：直接改基线、不写增量迁移（演示数据）；`OQ-23` 记第二期 |
| 不做的事写清 | 满足 | `node-registry-options.md` §8、本文件 §4 |

## 2 验证记录

```bash
export PATH="$PWD/.local/bun:$PATH"
bun run docs:index     # 已生成 docs/design/scenarios/_index.md：12 个场景
bun run docs:check     # 场景索引已是最新：12 个场景
bun run check          # tsc --noEmit + bun test + docs:check（本轮无代码改动，测试基线不变）
```

- 本轮无代码改动：`src/`、`db/`、`tests/`、`openapi.yaml` 均未修改。
- 新增/修改文档的相对链接检查：0 处失效。

## 3 结论落点

| 结论 | 落点 |
|---|---|
| `client_id` 绑定、`bindClient`/`unbindClient`、`getByClientId`、`NodeDirectory` 实现 | [`harness/spec.md`](../../../design/components/harness/spec.md) §2–§3.3 |
| `NodeDirectory` 端口 | [`kernel/spec.md`](../../../design/components/kernel/spec.md) §3.7 |
| 派生节点状态（`catalog` 组合 presence） | [`catalog/spec.md`](../../../design/components/catalog/spec.md) §2–§6 |
| 派发门禁、启动交集、`SchedulerPresenceRead` | [`scheduler/spec.md`](../../../design/components/scheduler/spec.md) §3.3、§4.8 |
| 节点停用与实例回收顺序 | [`instance/spec.md`](../../../design/components/instance/spec.md) §4.4 |
| `API-41`、`HarnessClientBinding`、`clientId` DTO、`409 binding_conflict` | [`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) §4.1、§5.1、§5.7 |
| 依赖图、端点计数 48、实施状态 | [`architecture.md`](../../../design/architecture.md) §3–§10 |
| 场景 `SCN-0206` | [`executor-node-registry/scenario.md`](../../../design/scenarios/workflow-orchestration/execution-scheduling/executor-node-registry/scenario.md) |
| 决策与否决理由、无迁移口径 | [`history/decisions/2026-11-10-harness-node-registry.md`](../../decisions/2026-11-10-harness-node-registry.md) |

## 4 未完成与待确认

1. **P2 最终确认**：已确认（用户 2026-11-10），同日追加「凭据落库」裁决；实现已另立 [`2026-11-10-node-registry-implementation`](../../../works/2026-11-10-node-registry-implementation/brief.md)。
2. **实现**（`T-NODE-03`）：`harness.client_id`/`client_token`、`API-41`、`NodeDirectory`/`ExecutorAuthenticator` 已落地；**派生状态 `health`/`lastHeartbeatAt` 仍延后**（依赖调度器 `presence`，见实现工序 `review.md` `D-03`）。
3. **场景状态 `draft`**：`SCN-0206` 仍为 `draft`；登记/凭据用例的测试已落，派发门禁与 presence 断言待调度层实现后补齐再转 `designed`。
4. **已按用户裁决变更**：token 落 Harness 表（[`2026-11-10-executor-client-token.md`](../../decisions/2026-11-10-executor-client-token.md)），`OQ-23` 关闭；`concurrency_max` 告警与 `priority` 队列仍未做。
5. **未做**：节点自动摘除、UI 适配（独立项目）；`openapi.yaml`、`API-41` 已随实现工序更新。

## 5 下一步

- 实现工序：[`2026-11-10-node-registry-implementation`](../../../works/2026-11-10-node-registry-implementation/brief.md)（`T-NODE-03` 已完成，直接改基线并重建开发库）。
- 派生 `health`/`lastHeartbeatAt` 与派发门禁随调度层工序落地；生产前若暴露非本机，先补管理面鉴权（决策记录 §4）。
