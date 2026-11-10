---
layer: history
module: global
status: frozen
updated: 2026-11-10
decision: 2026-11-10-scheduler-layer-design
---

# 决策：执行面调度层的组件切分与数据身份

> 背景：`executor-http-v2` 已冻结并由 `agent-flow-client` 实现，调度器侧只有契约、没有组件。本决策固定调度器侧的结构、数据身份与不变量；实现细节另立工序。
> 依据：[`executor-http-v2`](../../design/contracts/executor-http-v2.md)、[`2026-11-10-scheduler-layer-design/review.md`](../../works/2026-11-10-scheduler-layer-design/review.md)。

## 1 决策

1. **组件切分**：新增 `CMP-scheduler`（任务列表与派发裁决）与 `CMP-instance`（实例与工作区登记、client 绑定、可用性状态）。执行面三端点（`P-01`–`P-03`）作为 `CMP-http-gateway` 的 `executor` 路由，不新增独立网关组件。
2. **数据所有权**：`task`、`task_attempt` 归 `CMP-scheduler`；`instance` 归 `CMP-instance`；`http-gateway` 无表。技能集 digest 不落实例表，由调度器按任务派生。
3. **制品身份**：`packageId = <skillId>.<revision>`；`digest = sha256(zip)`；`etag = "sha256-<hex>"`；`skillSet.digest` 按 `packageId` 升序对 `[packageId, version, digest, sizeBytes]` 序列化后取 sha256。旧 `packageId` 随保存失效（当前不保留历史包）。
4. **语义取舍**：at-least-once 保持；重派只回原 client（实例粘性作为调度器硬约束，不改契约）；`prompt_timeout`/`scheduler`/`protocol`/`workspace` 不回队；`idle_timeout`/`asset`/`runtime`/`internal` 有限重试（默认 3 次、5s 退避）。
5. **配置**：执行面凭据只从 `EXECUTOR_CLIENTS`（`.env`）读取；重试参数进 `[executor]` 分节与环境变量；契约常量固定在代码。

## 2 被否决方案与理由

| 方案 | 否决理由 |
|---|---|
| 独立 `CMP-executor-gateway` 承载 `P-01`–`P-03` | 执行面与产品面共用同一进程、同一错误信封与同一 `AppError` 词汇；独立组件只会多一层装配与依赖，收益（隔离）在当前单 client 规模下不成立 |
| 单 `CMP-scheduler` 全包（含实例与工作区） | 实例生命周期（登记/摘除/回收）与任务状态机变化原因不同；合并会让「实例不可用」与「任务重派」同步修改，且粘性逻辑无处安放 |
| 跨 client 重派 | 本地 `workspacePath` 会落到另一台机器；要支持必须新增工作区准备职责与契约字段（`OQ-20` 原议题），成本远高于收益 |
| 保留历史技能包以维持旧 `packageId` 可用 | 需要 `CMP-skill` 增加保留策略、GC 与存储预算；当前任务失败一次即可由调度器按 `asset` 重试收敛，不值得预付 |
| 由网关承载长轮询挂起 | 传输层会承载业务唤醒语义（入队事件订阅），并把「谁决定派发」切到网关；挂起留在调度器，网关只传 `holdMs` |
| 在 `[capability]` 类 TOML 分节登记 client 与 token | token 属密钥，只允许 `.env`/进程环境；TOML 会进仓库 |

## 3 影响

- `architecture.md` 组件数 10 → 12（2 个 `planned`），依赖图新增 `gateway → scheduler`、`scheduler → instance`（读）、`scheduler/gateway → kernel.SkillPackageSource` 端口。
- `CMP-kernel` 错误词汇新增 `task_not_found`、`unsupported_protocol`；新增 `SkillPackageSource` 端口（由 `CMP-skill` 实现）。
- `CMP-config` 新增 `EXECUTOR_CLIENTS`、`TASK_MAX_ATTEMPTS`、`TASK_RETRY_DELAY_MS` 与 `[executor]` 分节。
- `CMP-skill` 需在保存时记录包摘要与字节数（`package_digest`、`package_size` 两列，P2 实现工序处理）。
- 场景树新增「工作流编排 / 执行面调度」价值流 5 张场景（`SCN-0201`–`SCN-0205`）。
- 未改动：契约正文、`openapi.yaml`、`src/`、`db/`。

## 4 复试条件

出现下列任一情况时需重开本决策：任务列表规模进入千级以上并要求跨进程调度；需要跨 client 迁移工作区；需要历史包保留或制品的第三方签名直链（`OQ-14`）；契约修订涉及终止范围（`OQ-12`）或 400 语义（`OQ-13`）。
