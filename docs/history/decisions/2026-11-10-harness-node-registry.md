---
layer: history
module: global
status: frozen
updated: 2026-11-10
decision: 2026-11-10-harness-node-registry
---

# 决策：Harness 作为 client 节点目录

> 背景：`executor-http-v2` 删除了 client 自注册与心跳，client 身份只剩 token → `clientId`；Harness 有 `concurrency_max`/`queue_policy`/`health`/`last_heartbeat_at` 等节点字段但没有运行期写入，执行面也不知道 Harness 的存在。
> 用户裁决（2026-11-10）：**A. Harness 就是 client 节点目录，管理员维护，不恢复 client 自注册**；不做数据迁移（当前为演示数据，可直接重建）。
> 方案对比：[`node-registry-options.md`](../../works/2026-11-10-harness-node-registry/node-registry-options.md)。

## 1 决策

1. **节点身份**：`harness` 增可空唯一列 `client_id`；一台执行机器对应一个 Harness、一个 `clientId`。绑定/解绑走专用 `PATCH /harnesses/{id}/client`（`API-41`），`create`/`update` 不接受 `clientId`。
2. **凭据**：第一期 token → `clientId` 仍由配置 `EXECUTOR_CLIENTS` 提供；Harness 不存 token。第二期是否落库见 `OQ-23`（需前置管理面鉴权）。
3. **在线状态**：不落库。`catalog` 组合 `CMP-scheduler` 的 `presence` 读，按 `unknown`/`online`/`overloaded`/`offline` 派生 `health` 与 `lastHeartbeatAt`；`harness.health`、`harness.last_heartbeat_at` 两列保留但不再作为权威。
4. **派发门禁**：`scheduler` 派发前经 `kernel.NodeDirectory` 端口（`harness` 实现）校验节点已绑定且 `enabled`。节点停用只停止新增派发，在跑任务继续，不下发 `stop`；与实例 `blocked`（执行失败兜底）区分。
5. **容量与队列**：`concurrency_max`、`queue_policy` 只做管理展示，不参与派发（`executor-http-v2` §9：容量只由 `capacity.free` 表达）。
6. **实例关联**：不加 `instance.harness_id`，按 `clientId` 关联；`instance` 不感知 Harness。
7. **契约**：`executor-http-v2` 不改；产品 REST 为加法（新端点 + DTO 字段 + `409 binding_conflict`）。
8. **迁移**：直接改 `db/migrations/0001_baseline.sql` 加列并重建开发库，不写增量迁移、不回填（演示数据可丢弃；先例见 `2026-10-30-quality-refactor` 的基线拍扁）。

## 2 被否决方案

| 方案 | 否决理由 |
|---|---|
| 新建独立「执行节点」实体 | 与 Harness 字段高度重叠，会产生两套设备概念；用户已裁决 Harness 即节点目录 |
| `clientId` 放进 `PUT /harnesses/{id}` | 全量替换语义下「漏传即解绑」，兼容风险高；沿用「启停走单独端点」的先例改为专用端点 |
| token 与 `clientId` 一起落 Harness（第一期） | 产品端点无鉴权，本地写接口即可发放/换绑凭据；等管理面鉴权后作为第二阶段 |
| 调度器回写 Harness 心跳 | 库内状态有陈旧窗口，仍要按时间戳判新鲜，且引入 `scheduler → harness` 写依赖；派生读更简单 |
| 把 `concurrency_max` 作为派发硬上限 | 与契约 §9 冲突（容量只由 `free` 表达、调度器不做二次限制），会出现「有槽但不派」 |
| 恢复 client 自注册与心跳 | 契约 v2 已明确删除该机制；第一期用 poll 观测已能覆盖 |
| 节点自动摘除（超时未 poll 自动停用） | 写状态应由管理员动作触发，自动摘除会造成难排障的静默变更；本期只做派生展示 |

## 3 影响

- `harness` 表：+`client_id`（可空唯一）；`health`/`last_heartbeat_at` 保留但非权威。
- `CMP-harness`：+`bindClient`/`unbindClient`、`HarnessRead.getByClientId`、`NodeDirectory` 实现；`HarnessSummary.clientId`。
- `CMP-kernel`：+`NodeDirectory` 端口；`binding_conflict` 错误（409）。
- `CMP-catalog`：Harness 列表/详情按 `SchedulerPresenceRead` 派生状态（新增对 `scheduler` 的读依赖）。
- `CMP-scheduler`：派发门禁 + `SchedulerPresenceRead`；启动交集校验（配置 token ∩ 节点目录）。
- `CMP-http-gateway`：+`API-41`、`HarnessClientBinding`、`HarnessListItem.clientId`；产品端点 47 → 48。
- `CMP-instance`：`enroll` 不变；补节点停用与实例回收的顺序说明。
- 场景：+`SCN-0206` 执行节点登记与派发门禁；`SCN-0201` 覆盖边界补引用。
- 未改动：`executor-http-v2`、client、`openapi.yaml`、代码与数据库。

## 4 复试条件

- 需要按节点发放/轮换凭据，或 UI 通过非本机地址访问管理面（`OQ-23`）时，重开「token 落库」与鉴权方案。
- 需要按 `concurrency_max` 强制限流或 `priority` 队列时，先改 `executor-http-v2` §9 与任务优先级模型。
- 节点规模增长到需要自动发现/自动摘除时，另评估注册面（可能回到被否决的 D 方向）。
