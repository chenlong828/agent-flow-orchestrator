---
layer: works
module: global
status: active
updated: 2026-11-11
procedure: 2026-11-11-scheduler-layer-implementation
level: P1
---

# 工序：执行面调度层实现

## 1 范围

按已冻结设计实现 `executor-http-v2` 的调度器侧：`P-01`–`P-03` 三端点、任务列表状态机、实例登记与派发门禁、技能包供给。

**做**：`instance` / `task` / `task_attempt` 三表（直接改基线，演示数据可丢弃）；`CMP-instance`、`CMP-scheduler`、`SkillPackageSource`；执行面路由与协议/鉴权；`catalog` 派生节点状态；组合根与测试基座接线；执行面 6 张场景的测试。

**不做**：任务来源与 prompt 组成（B4）；client 侧改动；`openapi.yaml` 增加执行面端点（契约由 `executor-http-v2` 承载）；历史技能包保留；管理面鉴权。

## 2 输入

- 契约：[`executor-http-v2`](../../design/contracts/executor-http-v2.md)
- 组件规格：[`scheduler`](../../design/components/scheduler/spec.md)、[`instance`](../../design/components/instance/spec.md)、[`kernel`](../../design/components/kernel/spec.md)、[`skill`](../../design/components/skill/spec.md) §3.3、[`http-gateway`](../../design/components/http-gateway/spec.md) §4.3/§5.8、[`config`](../../design/components/config/spec.md)
- 决策：[`2026-11-10-scheduler-layer-design`](../../history/decisions/2026-11-10-scheduler-layer-design.md)（失败不自动重派）、[`2026-11-10-executor-client-token`](../../history/decisions/2026-11-10-executor-client-token.md)（凭据落库）

## 3 任务表

| ID | 组件 | 状态 | 出口 |
|---|---|---|---|
| `T-SCH-I01` | `db` | 完成 | 基线加三表 + `skill` 摘要列；测试库重置表清单同步 |
| `T-SCH-I02` | `kernel` | 完成 | `task_not_found` / `package_not_found` / `unsupported_protocol` / `unauthorized` 错误与 `SkillPackageSource` 端口 |
| `T-SCH-I03` | `CMP-instance` | 完成 | 登记/读取/可派发/block/unblock/retire + 测试 |
| `T-SCH-I04` | `CMP-skill` | 完成 | 保存计算摘要、`SkillPackageSource` 实现 + 测试 |
| `T-SCH-I05` | `CMP-scheduler` | 完成 | enqueue/poll/acceptResult/requestStop/cancelInstances/inspect/presence + 测试 |
| `T-SCH-I06` | `CMP-http-gateway` | 完成 | `EXE-01`–`EXE-03`、协议版本、Bearer、DTO、错误映射 + 测试 |
| `T-SCH-I07` | `CMP-catalog` | 完成 | Harness 派生节点状态 + 测试 |
| `T-SCH-I08` | 组合根/测试基座 | 完成 | `main.ts`、`tests/helpers/app.ts` 接线 |
| `T-SCH-I09` | 场景 | 完成 | 6 张场景补 `entries`/`tests` 并转档 |
| `T-SCH-I10` | 收口 | 完成 | `bun run check`、`quality:gate`、review/result |

## 4 验收

1. `bun run check` 全绿（typecheck + 测试 + 场景索引）。
2. 契约条款 `S-01`–`S-08` 有测试对应；执行面 6 张场景的 3 正 1 反可执行并通过。
3. 失败结果不自动重派；只有未回报按 `S-02` 回队且受 `taskMaxAttempts` 约束。
4. 无密钥进入代码/日志/文档；`git diff` 聚焦本轮目标。
