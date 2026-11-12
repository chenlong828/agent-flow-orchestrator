---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-12-dev-executor-self-enroll
---

# 评审与裁决：执行面身份旁路与节点自注册

定级 **P1**（执行面鉴权属核心契约；自动登记给 `harness` 增加了一条写入路径）。用户 2026-11-12 已就机制作出裁决（见 [`2026-11-12-executor-auth-dev-bypass`](../../history/decisions/2026-11-12-executor-auth-dev-bypass.md) §1），本文件记录实现期的四档裁决。

## Blocker

无。

## Decision now

| ID | 决定 | 影响 |
|---|---|---|
| `D-01` | `EXECUTOR_AUTH` 默认 **`off`**，启动打一条告警；生产部署清单必须设 `on` | 默认值与「鉴权优先」相反，但这是开发期的显式选择，且开关可逆、无迁移；已登记 `R-005` 为上线阻塞项 |
| `D-02` | 已存在的节点行**不被自注册修改**（含 `enabled=false`、人工改过的 `address`） | 「新来替旧的」只作用于「不产生重复行、不报 `409`」；停用语义与人工管理动作保持权威。若需要「客户端重连即复活」，改一行并重开决策 |
| `D-03` | 自动登记在插入时直接写 `client_id`（扩展内部 `insertRoot`），不走 `bindClient` | `bindClient` 要求 token，而旁路模式没有 token；`create`/`update` 的对外契约仍不接受 `clientId`，写入面仍只有 `harness` 组件 |

## Verified sound

| 区域 | 查了什么 / 怎么查 | 结果 |
|---|---|---|
| 严格模式未被削弱 | 全量 `bun test`（384 用例）；`createTestContext` 缺省 `executorAuth: "on"`，原有 `TC-EXV-003` 等 401 用例原样通过 | 通过 |
| 身份优先级 | `executor-enroll.test.ts`：有效 Bearer + 冲突身份头 → 走 Bearer；未知 Bearer + 合法身份头 → 走头 | 通过 |
| 幂等与唯一性 | 服务测试 + HTTP 测试各覆盖一次；两次 poll 后 `total=1`；并发冲突走唯一索引兜底并回查复用 | 通过 |
| 名称冲突 | 人工已建同名资产时自动登记追加 `-2`，不覆盖人工资产 | 通过 |
| 停用不被复活 | 停用后再次 `ensureNode` → `created=false`、`revision` 不变、`enabled=false` | 通过 |
| 形状校验 | `clientId` 空串/含空格/65 字 → `400 validation_error`（`details.field=clientId`），不建行 | 通过 |
| 真实进程 | 3100 重启后 `curl` 带 `X-Client-Id` → `200` 空批；列表出现节点（`health=online`）；第二次 poll `total` 仍为 1；探针节点已删除 | 通过 |
| 文档一致性 | `docs:check` 通过；三份规格与契约 §3 已同步 | 通过 |

## Hold

| ID | 事项 | 去向 |
|---|---|---|
| `H-01` | 自动登记节点无回收机制 | [`risks.md`](../../plan/risks.md) `R-006`；需要时另立节点回收工序 |
| `H-02` | 自动登记不刷新 `address`、不随客户端换机更新 | 本工序 `brief.md` §6 未决；需要时加一行「地址变更即更新」，代价是执行面获得 `address` 写权限 |
| `H-03` | 客户端尚未实现 `X-Client-Id` | [`client-proposal.md`](client-proposal.md) 交 client 仓库；在此之前只能用 curl 验证 |
| `H-04` | 管理面仍无鉴权，旁路关闭后仍需它 | 与 `OQ-23` 同一前置条件；不在本工序范围 |
