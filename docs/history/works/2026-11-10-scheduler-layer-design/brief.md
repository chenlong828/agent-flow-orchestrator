---
layer: history
module: global
status: frozen
updated: 2026-11-11
procedure: 2026-11-10-scheduler-layer-design
level: P1
---

# 工序：执行面调度层设计（按 `executor-http-v2`）

## 1 范围

**本轮做**：按冻结的 [`executor-http-v2`](../../../design/contracts/executor-http-v2.md)，把调度器侧落成设计：

1. 组件切分与数据所有权：新增 `CMP-scheduler`、`CMP-instance`；执行面三端点作为 `CMP-http-gateway` 的 `executor` 路由。
2. 执行面场景设计：派发、结果回收与重派、技能包供给、停止与取消、协议版本与凭据，共 5 张场景卡。
3. 相关组件规格：新增 2 份 `planned` 规格；增量修订 `CMP-http-gateway`、`CMP-kernel`、`CMP-config`、`CMP-skill` 与 `architecture.md`。

**本轮不做**：不写实现代码、不改 `openapi.yaml`、不建表、不迁移、不改 `executor-http-v2` 契约正文、不做任务来源与 prompt 组成（B4 运行/任务启动）、不做 client 侧修改。

## 2 输入与约束

- 契约权威：[`executor-http-v2`](../../../design/contracts/executor-http-v2.md)（`P-01`–`P-03`、`S-01`–`S-08`、`C-01`–`C-09`、§3 常量、§13 版本演进）。
- client 已按契约实现（`agent-flow-client` `e047e0a`），接口一致性见 [`verification.md`](../../works/2026-11-10-executor-contract-verification/verification.md)；偏离项 `OQ-15`–`OQ-17` 不在本轮修。
- 用户裁决：本轮只做执行面调度；3 组件切分（scheduler + instance，端点并入 http-gateway）；数据设计到实体/所有权/状态机，列级留实现；实例粘性只重派回原 client；实例与 `workspacePath` 由任务启动时通过界面设置、启动前建好。
- 级别 P1：触碰新增组件、公共契约面、数据所有权，人工确认在切分与契约阶段（已确认切分）与最终冻结（待确认）。

## 3 交付物

| 交付物 | 路径 |
|---|---|
| 调度器规格 | [`design/components/scheduler/spec.md`](../../../design/components/scheduler/spec.md) |
| 实例规格 | [`design/components/instance/spec.md`](../../../design/components/instance/spec.md) |
| 执行面端点与 DTO | [`design/components/http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) §4.3、§5.8 |
| 共享错误与制品端口 | [`design/components/kernel/spec.md`](../../../design/components/kernel/spec.md) §3.1、§3.6 |
| 执行面配置 | [`design/components/config/spec.md`](../../../design/components/config/spec.md) §3.1–§3.2 |
| 包身份与摘要 | [`design/components/skill/spec.md`](../../../design/components/skill/spec.md) §3.3 |
| 系统视图 | [`design/architecture.md`](../../../design/architecture.md) |
| 5 张场景卡 | [`design/scenarios/workflow-orchestration/execution-scheduling/`](../../../design/scenarios/workflow-orchestration/execution-scheduling/) |
| 决策记录 | [`history/decisions/2026-11-10-scheduler-layer-design.md`](../../decisions/2026-11-10-scheduler-layer-design.md) |
| 评审与裁决 | [`review.md`](review.md) |

## 4 任务表

| ID | 类型 | 组件 | 状态 | 出口 |
|---|---|---|---|---|
| `T-SCH-01` | design | `CMP-scheduler`、`CMP-instance` | 完成 | 两份 `planned` 规格：职责、数据、契约、状态机、验证计划 |
| `T-SCH-02` | design | `CMP-http-gateway`、`CMP-kernel`、`CMP-config`、`CMP-skill` | 完成 | 执行面端点/DTO/错误/配置/制品供给口径写入各规格，标注未实现 |
| `T-SCH-03` | design | 场景（5 张） | 完成 | 运行序、不可变引用、3 正 1 反测试方案齐；frontmatter 保持 `draft`，待实现工序补 TC 与入口 |
| `T-SCH-04` | design | `architecture`、`plan`、`docs/README` | 完成 | 12 组件视图、数据所有权、端点计数、在办工序与开放问题同步 |
| `T-SCH-05` | design | 文档门禁 | 完成 | `bun run docs:index` + `bun run docs:check` 通过 |

## 5 装载清单

单任务装载 ≤250k；本工序只读以下文件，不读 `agent-flow-client` 源码（以验证报告与契约为准）：

- `docs/design/contracts/executor-http-v2.md`（全文）
- `docs/design/components/{scheduler,instance,http-gateway,kernel,config,skill,platform}/spec.md`
- `docs/design/architecture.md`
- `docs/history/works/2026-11-10-executor-contract-verification/verification.md`、`docs/history/works/2026-11-03-client-boundary/v2-alignment.md`
- `docs/plan/{roadmap,open-questions}.md`

## 6 验收标准

1. 契约 `S-01`–`S-08` 每条在调度器规格中有唯一落点，且不与契约正文冲突。
2. 执行面三端点在 `CMP-http-gateway` 规格中有路径、成功码、错误码与 DTO 映射。
3. 每个新组件有：一句话职责、不负责清单、数据所有权、公开契约、状态机/不变量、依赖边界、验证计划、预算、待定项。
4. 5 张场景卡四要素齐（入口标 `planned`、运行序、不可变引用、3 正 1 反测试方案），且不在正文复制组件契约。
5. 决策有记录，被否决方案有理由；OQ-18/OQ-20 关闭有落点，OQ-21/OQ-22 有去向。
6. `bun run docs:check` 通过；`bun test`、`bun run typecheck` 不因本轮变化（本轮无代码改动）。

## 7 领取的开放问题

- `OQ-18`（`lastEventAt`）：本轮裁决为观测字段，不参与排序/判活 → 关闭。
- `OQ-20`（实例粘性）：用户裁决只重派回原 client → 关闭。
- `OQ-21`（实例不可用无载体）：给调度器侧兜底（`blocked`），契约缺口保留待定。
- `OQ-12`–`OQ-14`、`OQ-15`–`OQ-17`、`OQ-19`：只读引用，不改本轮范围。

## 8 裁决（P1 人工门，2026-11-11）

- 用户确认 7 项 `Decision now`：组件切分、技能集冲突拒绝、**失败不自动重派**、制品身份与不保留历史包、长轮询单飞、场景保持 `draft`、凭据留配置；详见 `review.md` §7。
- 其中失败重派由原草案的「有限重试」改为「直接结算」，代价与落点见 `review.md` 的 `D-03`。
