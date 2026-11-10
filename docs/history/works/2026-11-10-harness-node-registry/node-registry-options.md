---
layer: history
module: global
status: frozen
updated: 2026-11-10
procedure: 2026-11-10-harness-node-registry
level: P2
---

# 方案对比：Harness 作为 client 节点目录

> 方向前提（用户 2026-11-10 裁决）：**A. Harness 就是 client 节点目录，管理员维护，不恢复 client 自注册。**
> 本文比较 A 内部的 8 个子决策，给出推荐组合与分期；确认后按 `brief.md` `T-NODE-02` 落组件规格与迁移。
> 契约基线：[`executor-http-v2`](../../../design/contracts/executor-http-v2.md)（不改）。

## 1 现状（证据）

| 事实 | 证据 |
|---|---|
| Harness 是资产目录：7 个端点、`harness`/`harness_tag` 两张表、status `current` | [`harness/spec.md`](../../../design/components/harness/spec.md)、`tests/components/harness/service.test.ts`（13 例） |
| `health`、`last_heartbeat_at` 只读，**从未被写入** | 规格第 53 行「只由未来执行器更新」；代码只有读取（`src/components/harness/service.ts:46-47`、`store.ts:60`），全仓无写入路径 |
| `concurrency_max`、`queue_policy` 可写，但**无消费者** | 调度器只用 `capacity.free`（[`scheduler/spec.md`](../../../design/components/scheduler/spec.md) §4.3） |
| `enabled` 可启停，但**不参与任何运行判定** | Harness 只做 CRUD 与引用保护；无运行期读取方 |
| client 身份只剩 token → `clientId`，无注册、无心跳 | 契约第 65 行、§11.1；[`BC-02`](../../works/2026-11-03-client-boundary/v2-alignment.md) |
| 实例登记不引用 Harness | [`instance/spec.md`](../../../design/components/instance/spec.md) §2，`instance` 无 `harnessId` |
| 产品端点无鉴权、只监听本机 | [`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) §2 |

**结论**：Harness 现在只是「静态资产」，执行面完全不知道它。要做成节点目录，需要补三件事：**节点身份（clientId）**、**运行期状态（在线/离线/满载）**、**派发侧的可用性判定**。

## 2 目标语义

1. **节点 = Harness**：管理员创建 Harness 并绑定一个 `clientId`；一台执行机器对应一个 Harness。
2. **client 不自注册**：client 仍只用 Bearer token 领取任务；token → `clientId` 的映射保留在调度器配置（`EXECUTOR_CLIENTS`）。
3. **派发看节点**：只有「Harness 存在、`enabled=true`、`clientId` 与实例归属一致」的 client 才拿得到任务。
4. **状态是派生值**：在线/离线来自调度器观测到的 poll 时间，不落 Harness 表，避免第二真相。
5. **契约不动**：`executor-http-v2` 的三端点、at-least-once、容量只由 `free` 表达都不变。

## 3 子决策对比

### `N-01` 节点身份与 `clientId` 的绑定位置

| 选项 | 做法 | 代价 / 风险 |
|---|---|---|
| a 扩展 `PUT /harnesses/{id}` 携带 `clientId` | 复用全量更新 | `PUT` 是全量替换语义，漏传即清空绑定；已有消费方（UI）需回填，兼容风险高 |
| b 新增 `PATCH /harnesses/{id}/client`（或 `/binding`） | 单字段绑定/解绑，带 `If-Match` | 多一个端点；但语义清晰，和现有「启停走 `API-05`」的先例一致 |
| c 另建 `harness_client` 映射表 | 不动 Harness 聚合 | 第二写入口，跨表事务，违反「数据单家」 |

**推荐 b**：`clientId` 为 Harness 的可空单字段，通过专用端点绑定/解绑；`POST /harnesses` 不接受 `clientId`（创建后再绑定），保证 `PUT` 全量语义不变。

### `N-02` token 的权威来源

| 选项 | 做法 | 代价 / 风险 |
|---|---|---|
| a 配置权威（现状 `EXECUTOR_CLIENTS`），Harness 只存 `clientId` | 凭据不落库 | 轮换要改 `.env` 并重启；配置与节点目录可能漂移（启动校验缓解） |
| b Harness 存 token 哈希（新增列），管理面发放/轮换 | 界面可管理 | 产品端点无鉴权，本地写接口可被用来换绑/发放凭据；需先做管理面鉴权 |
| c 配置为主、DB 覆盖 | 渐进 | 两套来源并存，排障时说不清哪条生效 |

**推荐 a（第一期）**，`b` 作为第二阶段，前置条件是管理面鉴权（`OQ-23`）。第一期用启动校验保证一致性：`EXECUTOR_CLIENTS` 里多出的 `clientId` 不派发并记日志；Harness 有 `clientId` 但配置无 token 的节点不派发。

### `N-03` 在线状态的推导与写入口

| 选项 | 做法 | 代价 / 风险 |
|---|---|---|
| a 派生展示：`catalog` 组合 Harness 读 + 调度器 presence 读 | 不落状态、无第二真相 | `catalog` 新增对 `scheduler` 的读依赖；调度器重启后到首次 poll 前显示 `unknown`（≤ 40s） |
| b 调度器回写 Harness（新增内部写契约） | Harness 表有真实状态，读路径简单 | 引入 `scheduler → harness` 写依赖；库内状态存在陈旧窗口，仍要按时间戳判新鲜 |
| c 不展示，保持 `unknown` | 最省 | 界面看不到节点死活，节点目录价值减半 |

**推荐 a**。派生口径（写入组件规格）：

| `health` | 条件 |
|---|---|
| `unknown` | 从未收到该 `clientId` 的 poll（含调度器重启后） |
| `online` | 最近 poll 距今 ≤ `clientSilentMs`（120s）且 `free > 0` |
| `overloaded` | 最近 poll 距今 ≤ `clientSilentMs` 且 `free = 0` 且在跑任务数 > 0 |
| `offline` | 最近 poll 距今 > `clientSilentMs` |

`lastHeartbeatAt` 改为「最近一次 poll 时间」的派生值；`harness.health` / `last_heartbeat_at` 两列保留但不再作为权威（是否删列另立任务，删列属破坏性迁移）。

### `N-04` 派发侧的节点可用性判定

| 选项 | 做法 | 代价 / 风险 |
|---|---|---|
| a 派发前经 `kernel` 的 `NodeDirectory` 端口校验（Harness 实现） | `enabled=false` → 不派发新任务，在跑任务继续，不 `stop` client | `scheduler` 多一个端口依赖（业务扇出 2 → 3，仍 ≤5） |
| b 在 `instance.enroll` 强制校验节点 | 登记时失败 | `instance` 要读 Harness（同层互读），且节点停用后已有实例仍合法但不可派发，两处都要判 |
| c 不校验，仅展示 | 最省 | 管理员停用节点后任务仍会派给该 client，节点目录失去控制力 |

**推荐 a**。`NodeDirectory` 端口定义在 `kernel`（与 `ExpertStatusReader` 同模式），由 `CMP-harness` 的读契约实现，组合根注入 `scheduler`；`CMP-instance` 不感知 Harness。
`enabled=false` 与实例 `blocked` 的区别：前者是管理员意图（允许在跑任务完成），后者是执行失败兜底（同实例任务结算失败）；两者都落到「不派发新任务」。

### `N-05` 容量与队列策略语义

| 选项 | 做法 | 代价 / 风险 |
|---|---|---|
| a `concurrency_max` 只做展示与告警，不参与派发 | 与契约 §9「容量只由 `free` 表达、调度器不做二次限制」一致 | 管理员配置的上限不能强制，只能事后发现 |
| b 作为派发硬上限（`min(free, concurrency_max - 已下发未结算数)`） | 管理端可强制 | 与 §9 冲突，需改契约；且 `free` 已由 client 自报，双上限会出现「有槽但不派」的费解现象 |
| c 删除字段 | 收敛 | 破坏性变更，UI 依赖，需 `/api/v2` 级迁移 |

**推荐 a**：`concurrency_max`、`queue_policy` 保持管理语义（展示/规划），不进入派发判定；`priority` 需要任务优先级模型，记 `待定`。

### `N-06` 实例与节点的关联

| 选项 | 做法 | 代价 / 风险 |
|---|---|---|
| a 靠 `clientId` 关联，不加外键 | 零迁移 | 节点回收时要按 `clientId` 反查实例（现有读契约可做） |
| b `instance.harness_id` 外键 | 关联更硬，删除可保护 | `instance` 依赖 Harness 聚合；跨机器同一 `clientId` 多节点时会歧义 |

**推荐 a**：实例已绑 `clientId`，节点目录也绑 `clientId`，关联天然成立；`retire` 节点前按 `clientId` 取消/结算该节点实例的任务。

### `N-07` `health` 语义变更的兼容

| 选项 | 做法 | 代价 / 风险 |
|---|---|---|
| a 沿用 `health`/`lastHeartbeatAt` 字段，值改为派生 | UI 不改字段名 | 语义从「静态未知」变为「实时派生」，需在契约注明；旧数据不再有意义 |
| b 新增 `nodeStatus`，保留静态 `health` | 无歧义 | 两套状态并存，UI 要判断读哪个，长期重复 |

**推荐 a**，并在契约里写清「派生值、非持久化、调度器重启后短时 `unknown`」。

### `N-08` 迁移与端点范围

| 项 | 推荐 |
|---|---|
| 表 | 增量迁移：`harness` 加 `client_id text`，唯一索引（`where client_id is not null`）；不加其他列 |
| 端点 | 新增 `PATCH /api/v1/harnesses/{id}/client`（绑定/解绑，`If-Match`，204 或 200 详情）；`POST`/`PUT` 不变 |
| OpenAPI | 新增该 operation；`HarnessSummary` 增 `clientId`；`health`/`lastHeartbeatAt` 描述改为派生 |
| 启动校验 | `EXECUTOR_CLIENTS` 与 Harness `client_id` 求交；`clientId` 只在一边的节点不派发并记日志 |
| 测试 | 绑定唯一/互斥、`enabled=false` 不派发、派生状态四类、调度器重启后 `unknown`、配置与目录漂移告警 |

## 4 推荐组合与分期

**推荐组合**：`N-01 b` + `N-02 a` + `N-03 a` + `N-04 a` + `N-05 a` + `N-06 a` + `N-07 a` + `N-08`。

| 阶段 | 内容 | 级别与前置 |
|---|---|---|
| 第一期（最小可用） | `client_id` 绑定端点 + 调度器派发校验 + 派生状态 + 停用语义；token 仍在配置 | P2（表字段增量、契约加法、读依赖）；若确认「调度器写 Harness」则升 P1（未推荐） |
| 第二期（管理化） | token 哈希与轮换、`concurrency_max` 告警 | P2；前置管理面鉴权（`OQ-23`） |
| 第三期（可选） | 节点回收与实例生命周期联动、`priority` 队列 | 待定；需要任务优先级模型 |

**分期理由**：第一期不改契约、不碰凭据、不加组件，只补字段 + 一个端点 + 两处读依赖，能先把「界面选节点、看节点是否可用、停用节点不再派活」跑通；凭据落到库里会引入新的攻击面，必须等管理面鉴权。

## 5 影响面

| 对象 | 变更 | 兼容性 |
|---|---|---|
| `harness` 表 | +`client_id`（唯一、可空） | 增量迁移；旧行 `null`，不参与派发 |
| `CMP-harness` 契约 | 读模型增 `clientId`；新增 `bindClient`/`unbindClient`（或 `setClientId`）写方法；`health`/`lastHeartbeatAt` 读值改为派生（由 `catalog` 组合） | 加法为主；`health` 语义变更是行为变化，需通知 UI |
| `CMP-kernel` | 新增 `NodeDirectory` 端口（`isDispatchable(clientId)`、`listClientIds()`） | 加法 |
| `CMP-scheduler` | 派发前校验 `NodeDirectory`；提供 presence 读契约（供 `catalog`） | 加法；业务扇出 3 |
| `CMP-catalog` | Harness 列表/详情组合派生状态 | 加法；新增对 `scheduler` 的读依赖 |
| `CMP-http-gateway` | 新端点 + OpenAPI + DTO 字段 | 加法 |
| `CMP-config` | `EXECUTOR_CLIENTS` 保留；启动校验与漂移日志 | 行为增量 |
| `executor-http-v2` | 不动 | — |
| `agent-flow-ui`（独立项目） | 读同字段；语义从静态变为派生；如需绑定按钮，调用新端点 | 由该项目适配 |

## 6 被否决的方向（记录理由）

| 方向 | 否决理由 |
|---|---|
| B 新建独立「执行节点」实体 | 与 Harness 字段高度重叠（名称/类型/地址/并发/队列策略），会产生两套设备概念；用户已裁决 A |
| C 只配置声明、不做节点目录 | 界面无法选节点、看不出节点死活；管理动作只剩改 `.env` 并重启 |
| D 恢复 client 自注册与心跳 | 合同 v2 已明确删除该机制（无注册/心跳/租约），恢复等于重写契约与双端，收益是「节点状态自动准确」，但第一期用 poll 观测已能覆盖 |

## 7 风险与待定

| 项 | 说明 | 处置 |
|---|---|---|
| 管理面无鉴权 | `PATCH /harnesses/{id}/client` 与现有写端点一样无鉴权，仅本机可用；若将来 UI 远程访问，换绑可被滥用 | 部署层同源代理/鉴权；第二期补管理面鉴权（`OQ-23`） |
| 派生状态依赖 `catalog` 读 `scheduler` | 新增一条读依赖，调度器不可用时 Harness 列表状态退化为 `unknown` | 降级可接受；写进组件规格的失败语义 |
| 配置与目录漂移 | 两处都要有 `clientId` 才能派发 | 启动校验 + 日志；`OQ-23` 讨论是否收敛到一处 |
| `lastHeartbeatAt` 列长期不写 | 陈旧列会引起误解 | 契约注明「保留列不作权威」；删列另立任务（破坏性） |
| `priority` 队列 | `queue_policy=priority` 无消费者 | 记 `待定`，需要任务优先级模型后再做 |

## 8 不做什么

- 不改 `executor-http-v2`，不给 client 增加注册/心跳/状态上报。
- 不新增执行节点组件或第二套节点表。
- 不做节点自动摘除（超时未 poll 自动 `enabled=false`）——第一期只做派生展示，写状态是管理员动作。
- 不做 `priority` 队列、不做 `concurrency_max` 强制上限。
- 不在本轮落组件规格、迁移、场景与实现代码。
