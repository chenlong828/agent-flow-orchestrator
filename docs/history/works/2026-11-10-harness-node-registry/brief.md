---
layer: history
module: global
status: frozen
updated: 2026-11-10
procedure: 2026-11-10-harness-node-registry
level: P2
---

# 工序：Harness 作为 client 节点目录（方案对比）

## 1 范围

**背景**：`executor-http-v2` 删除了 client 自注册与心跳，client 身份只剩「Bearer token → `clientId`」；执行面已有实例登记（`CMP-instance`），但**没有节点目录**：谁有哪些 client、哪台机器还能接活、界面上按什么选节点，当前都没有权威来源。`CMP-harness` 的字段（`concurrency_max`、`queue_policy`、`health`、`last_heartbeat_at`）看起来就是为节点准备的，但只有管理员的资产 CRUD，没有运行期写入。

**方向（用户 2026-11-10 裁决）**：**A. Harness 就是 client 节点目录，管理员维护，不恢复 client 自注册**。

**本轮做**：把 A 落到可拍板的子决策对比（字段、凭据归属、在线状态推导、派发校验、容量语义、实例关联、迁移），给出推荐组合与分期。

**本轮不做**：不改代码、不改 `harness` 表、不改 `executor-http-v2`、不改 client、不新增组件；不写组件规格（等子决策确认后另起实现/设计任务）。

## 2 输入与约束

- [`harness/spec.md`](../../../design/components/harness/spec.md)：`health`/`lastHeartbeatAt` 只读，规格写明「只由未来执行器更新」（第 53 行）；`concurrency_max`、`queue_policy` 可写但无消费者。
- [`executor-http-v2.md`](../2026-11-10-executor-contract-v2/executor-http-v2.md)：无注册/心跳（第 65 行、§11.1）；容量只由 `capacity.free` 表达，调度器不做二次限制（§9）；凭据 `Bearer <token>` 绑定 `clientId`（§3）。
- [`instance/spec.md`](../../../design/components/instance/spec.md)：`enroll(instanceId, clientId, workspacePath)`，`instance` 无 `harnessId`。
- [`scheduler/spec.md`](../../../design/components/scheduler/spec.md)：派发只看 `instance.isDispatchable` 与 `capacity.free`，不读 Harness。
- 产品端点无鉴权、只监听本机（`http-gateway/spec.md` §2）；因此「在管理面发放凭据」的风险要单独评估。
- 当前 `EXECUTOR_CLIENTS`（config）是 token → `clientId` 的唯一来源，尚未实现。

## 3 交付物

| 交付物 | 状态 |
|---|---|
| [`node-registry-options.md`](node-registry-options.md)：8 个子决策的选项、代价、推荐与影响面 | 完成（推荐组合已采纳） |
| 组件规格增量（harness/kernel/catalog/scheduler/instance/http-gateway/architecture）、场景 `SCN-0206`、决策记录 | 完成 |
| 决策记录（落 `history/decisions/`） | 完成 |

## 4 任务表

| ID | 类型 | 组件 | 状态 | 出口 |
|---|---|---|---|---|
| `T-NODE-01` | design | `CMP-harness`、`CMP-instance`、`CMP-scheduler`、`CMP-config` | 进行中 | 子决策对比与推荐组合 |
| `T-NODE-02` | design | 同上 | 完成 | 按用户选择落组件规格增量、场景与决策记录；无迁移（演示数据） |
| `T-NODE-03` | change | 同上 | 待排 | 实现（P2；若引入调度器写 Harness 则升 P1） |

## 5 验收标准（本轮）

1. 每个子决策有 2–3 个选项、代价与推荐，且能指回组件规格/契约的具体条款。
2. 推荐组合不违反 `executor-http-v2` 的既有条款（无注册、容量只由 `free` 表达、首份结果为准）。
3. 「在线状态」有明确的数据所有权与推导口径，不出现第二真相。
4. 迁移与兼容影响（表、DTO、OpenAPI、UI 消费）写清；不做的事写清。

## 6 裁决

- 2026-11-10 用户采纳 `node-registry-options.md` §4 推荐组合（`N-01`–`N-08`），只做第一期；**不做迁移**（内部为演示数据，可丢弃，直接改基线）。
- 设计落点见 [`result.md`](result.md) §3；实现工序 `T-NODE-03` 待 P2 最终确认后另立。
