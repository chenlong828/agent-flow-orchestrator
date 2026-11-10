---
layer: works
module: global
status: active
updated: 2026-11-10
procedure: 2026-11-10-node-registry-implementation
---

# 评审：节点登记与执行面凭据落库

> 按 `arch-design-spec` 第 8 步走查，P2 至少覆盖 blocker / decision now / verified sound 三档。定级 P2（非核心表字段、跨模块、兼容性契约加法、无核心 schema 变更）。

## 1 Blocker

无。冻结后再改会变成 breaking change 的问题没有发现；`executor-http-v2` 未动，产品端点为加法。

## 2 Decision now

| ID | 决策 | 证据/权衡 | 落点 |
|---|---|---|---|
| `D-01` | 凭据明文入库、`HarnessDetail.clientToken` 可读回（用户选项 C），而非哈希 + 一次性发放 | 用户要「方便对接和调试」；代价是本机任意进程可读、dump/备份带出凭据。风险与上线前必须补鉴权的条件已写明 | 决策记录 §1.3、§4；`harness` §2；`gateway` §5.1；测试「登记节点同时写入…详情回读、列表不返回凭据」 |
| `D-02` | `clientId` 与 token 同一次 `API-41` 原子写入，不拆独立 token 端点 | 拆开会产生「已绑定但无凭据」死节点；同写后解绑天然清空，轮换复用同入口 | 决策记录 §2；`gateway` §5.1；测试「API-41 轮换凭据复用同一入口，解绑清空」 |
| `D-03` | Harness 派生态 `health`/`lastHeartbeatAt` 本工序不实现，仍返回列内历史值 | 派生需要 `CMP-scheduler` 的 `presence` 读；调度器未落地，提前实现只能恒为 `unknown`，还会破坏现有 `?health=` 筛选语义 | `harness` §7、`catalog` §2、`gateway` §9 实现状态；`brief.md` §1 |

## 3 Verified sound

| 检查项 | 方式 | 结论 |
|---|---|---|
| 唯一性双保险 | 基线唯一索引 `harness_client_id_key` / `harness_client_token_key` + 服务层按约束名映射错误 | 通过：服务测试与 DB schema 测试各覆盖一次 |
| 凭据不外泄 | `BindingConflictError("clientToken")` 的 `details` 只有 `{field}`，`message` 固定文案；service 测试断言 `JSON.stringify(details)` 与 `message` 都不含 token | 通过 |
| 解绑幂等与 revision | `unbindClient` 重复调用仍 `revision+1`，未绑定不解绑报错 | 通过 |
| 原子性与并发 | `update ... where id and revision` 返回行数判冲突；旧 revision 409 | 通过（`revision_conflict` 测试） |
| 写入口唯一 | `create`/`update` 字段白名单不含 `clientId`/`token`；`PUT` 带 `clientId` 400 | 通过（HTTP 测试） |
| 读模型边界 | 列表 `HarnessSummary` 无 `clientToken`，`getByClientId` 也返回摘要；只有详情带凭据 | 通过（service + 快照测试） |
| 契约一致 | `openapi.yaml` 新增 `API-41`、`HarnessClientBinding`、`clientToken`；operation/path/schema 计数与 `gateway/spec.md` 同步更新 | 通过（OpenAPI 结构测试 + `docs:check`） |
| 依赖方向 | `harness` 只依赖 kernel/platform，实现两个端口；`catalog` 只做投影；`gateway` 不碰 store | 通过（架构测试） |
| 表结构 | 两个可空唯一列 + `client_token ⇒ client_id` 表级 check；无数据迁移 | 通过（schema 测试断言列、索引与孤儿凭据插入失败） |

## 4 Hold

| ID | 事项 | 不阻塞理由 | 去向 |
|---|---|---|---|
| `H-01` | 场景 `SCN-0206` 转 `designed` | 派发门禁（`TC-EXN-002`）与 presence 派生（`TC-EXN-003`）依赖未实现的调度层，测试无法先写 | 调度层实现工序完成后补齐并转状态 |
| `H-02` | 凭据轮换审计（谁在何时换过） | 当前只需「当前值」，审计不影响对接调试；加列属于新范围 | `plan/open-questions.md` 记为后续（本次未开新 OQ，写在本文件与决策 §5 复试条件） |
| `H-03` | 派生 `health` / `lastHeartbeatAt` | 与 `D-03` 同一事项，已明确延后 | 调度层工序 |

## 5 结论

**通过**（blocker 0；`D-01`–`D-03` 已落文档与测试；`H-01`–`H-03` 已转出且不阻塞）。
