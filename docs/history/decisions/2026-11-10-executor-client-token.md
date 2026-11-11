---
layer: history
module: global
status: frozen
updated: 2026-11-10
decision: 2026-11-10-executor-client-token
---

# 决策：执行面 Bearer 凭据落 Harness 表

> 背景：`executor-http-v2` 只有 `Bearer <token> → clientId` 一种身份，没有注册/心跳。节点目录第一期把 `clientId` 绑定放到 Harness，凭据仍留在配置 `EXECUTOR_CLIENTS`（[`2026-11-10-harness-node-registry.md`](2026-11-10-harness-node-registry.md) §1.2），留下了「配置与节点目录两份真相、轮换要改 `.env` 并重启」的问题（`OQ-23`）。
> 用户裁决（2026-11-10）：**凭据落库，明文入库、详情可读回**；目的是让对接与调试不必改环境变量、不必重启；随后确认 P2，允许直接实现。

## 1 决策

1. **存储**：`harness` 增 `client_token text`（可空、唯一索引 `harness_client_token_key`、1–128 个不含空白与控制字符的字符）。`client_token` 非空时 `client_id` 必须非空（表级 check 兜底），即凭据只能挂在已登记的节点上。
2. **写入面**：凭据与 `clientId` 由同一次 `API-41 PATCH /harnesses/{id}/client` 写入，`{clientId, token}` 原子生效；换绑与轮换复用同一端点；`{clientId: null}` 解绑并同时清空凭据。不做「先绑节点、后补凭据」的中间态，避免出现绑定了但无法鉴权的死节点。
3. **可读性**：明文入库，`HarnessDetail.clientToken` 可直接读回；`HarnessListItem` 不返回凭据；凭据冲突的错误 `details` 与 `message` 都不回显 token 值；任何日志、commit、文档不写真实 token。
4. **权威切换**：`harness.client_token` 是执行面 Bearer 的唯一权威；配置不再有 `EXECUTOR_CLIENTS`，启动期不再做「配置 token ∩ 节点目录」交集校验（凭据与节点在同一行，天然一致）。
5. **鉴权端口**：`kernel.ExecutorAuthenticator.resolveClientId(token)` 由 `harness` 实现并查询 `client_token` 唯一索引；未知 token、已解绑、已轮换的旧 token 都返回 `null`，执行端据此回 `401 unauthorized`；节点停用不返回 `401`（鉴权通过、空批、不派发）。
6. **迁移**：直接改 `0001_baseline.sql` 加列与索引、重建开发库，不写增量迁移、不回填（演示数据可丢弃；先例见 `2026-10-30-quality-refactor` 的基线拍扁）。

## 2 被否决方案

| 方案 | 否决理由 |
|---|---|
| 只存 `sha256(token)`，不可读回 | 对接调试时无法把凭据交给界面/客户端，忘记只能重置；用户明确要求可读回 |
| 服务端生成、仅创建时返回一次明文 | 对接时仍要人工复制，且界面无法回看；与「方便调试」的目标不符 |
| 凭据继续留在 `EXECUTOR_CLIENTS`（`.env`） | 轮换要改环境变量并重启；配置与节点目录可能漂移，需要额外启动交集校验 |
| 独立 `client_token` 表或独立资源 | 一个节点一个凭据，`1:1` 且随节点解绑清空，独立表只增加连接与事务复杂度 |
| 单独的 `PUT /harnesses/{id}/client-token` 端点 | 会让 `clientId` 与凭据可以分开写，出现「已绑定但无凭据」或「有凭据但未绑定」的中间态；合并进 `API-41` 才能保证原子性 |

## 3 影响

- `harness` 表：+`client_token`（可空唯一）+ 表级 check；`client_id`、`client_token` 两个唯一索引。
- `CMP-harness`：`bindClient` 输入扩为 `{clientId, token}`；`HarnessSummary.clientId`、`HarnessDetail.clientToken`；实现 `ExecutorAuthenticator`。
- `CMP-kernel`：+`ExecutorAuthenticator` 端口；`binding_conflict` 语义扩到节点登记。
- `CMP-http-gateway`：`API-41` 请求体加 `token`；`HarnessDetail` 加 `clientToken`；产品端点 47 → 48（`API-41` 落地），`openapi.yaml` operation 48 → 49（含 `/healthz`）、`x-api-count` 47 → 48。
- `CMP-config`：删除 `executorClients`；`[executor]` 只留重试参数。
- `CMP-scheduler`：鉴权改走 `ExecutorAuthenticator`，删除启动交集校验。
- 场景 `SCN-0206` 增补登记/轮换/解绑与 `401` 失败路径；`OQ-23` 关闭。
- 未改动：`executor-http-v2`、client 实现、`instance`、`task`/`task_attempt`。

## 4 风险与边界

- **产品端点无鉴权**：本机任意进程可读回凭据、换绑节点。当前只监听本机、数据为演示数据，用户已接受该风险；**上线或暴露到非本机之前必须先做管理面鉴权，或改为哈希存储 + 一次性发放**。
- **明文落库**：数据库 dump、备份、排障查询都会带出凭据。禁止把 `client_token` 写进日志、错误信息、commit、文档或对话记录。
- **凭据冲突不回显**：`BindingConflictError("clientToken")` 的 `details` 只有 `{field}`，`message` 不含 token，避免通过错误响应枚举他人凭据。
- 凭据轮换没有审计历史（无 `client_token_updated_at`/轮换日志）：当前只保留「当前值」，需要审计时另立设计。

## 5 复试条件

- 产品端点暴露到非本机、或需要多用户/角色时：先补管理面鉴权，再评估把明文换成哈希 + 一次性发放。
- 需要「谁在什么时候轮换过凭据」时：补凭据轮换审计（时间戳或独立事件），不改 `executor-http-v2`。
- 需要按节点限流、吊销全部凭据时：在 `harness` 上扩展，不引入第二份凭据来源。
