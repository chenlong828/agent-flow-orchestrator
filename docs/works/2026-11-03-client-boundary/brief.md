---
layer: works
module: global
status: active
updated: 2026-11-03
---

# 工序：调度器与 agent-flow-client 边界设计

## 背景

调度器（本仓库）负责工作流定义与控制面决策；执行面将独立为 `agent-flow-client`（Bun CLI）。两者分别开发前，需要先冻结边界、职责、流程框架与工作拆分，避免实现期互相侵入，也避免把“谁决定、谁执行、谁持有状态”留到编码时才发现分歧。

本工序只做方案与流程框架，不进入实现细节。

## 目标

产出一份《调度器与 agent-flow-client 边界与职责设计》，回答：

- 哪些决定、状态、数据归调度器，哪些归 client；
- 实例、节点、session、工作区、技能、结果的主流程怎么走；
- 失败、重试、取消、离线、恢复分别由谁负责；
- 两侧各自的工作包、里程碑与依赖顺序，便于分别开工。

## 范围

- 控制面/执行面的定位与边界原则；
- 职责矩阵；
- 运行与流程框架：实例、进程、session、工作区、技能供给、结果回传；
- 状态与数据所有权（高层，不下钻到表/字段）；
- 交互框架：注册与心跳、任务领取与租约、会话绑定与技能集合、结果上报、取消/关闭控制；
- 失败、重试、恢复、并发、安全、可观测性的责任框架；
- 两项目工作拆分与依赖顺序。

## 非目标

- 不写实现代码，不建 `agent-flow-client` 仓库，不改本仓库 API、表或实现；
- 不写字段级 API 契约、JSON Schema、数据库表、状态枚举与迁移；
- 不写本地目录布局、脚本赋权、原子替换、错误码目录等实现细节；
- 不定义 DSH 内部实现，不做 DSH 改造；
- 不做 UI、容量/SLA、跨机迁移方案。

## 输入

- [执行概念稿](../../history/works/2026-10-24-agentflow-execution-concept/concept-design.md) 的 D0–D11；
- 2026-11-02/03 的方案讨论结论（本工序 brief 的“已定框架”）；
- agent-flow-client 的 S0 结果（`agent-flow-client/docs/works/2026-11-03-s0-acp-verification/result.md`）：12 项 11 通过，技能可见性、受控技能根、并发、脚本、崩溃行为已有实测；
- 现有 B1/B3 资产与工作流契约（只读）；
- ACP 能力边界（概念稿与 S0 实测）。

## 已定框架

> 2026-11-10 对齐复核：「交互方式」「session 绑定」「技能供给」三行已被 `executor-http-v2` 取代；进程/session 与并发模型亦有冲突。逐条对照见 [`v2-alignment.md`](v2-alignment.md)。

| 事项 | 结论 |
|---|---|
| client 形态 | Bun CLI；常驻与单次两种运行方式 |
| 交互方式 | 调度器提供 HTTP 租约/长轮询；client 主动领取与上报 |
| 实例归属 | 实例绑定 client；离线等待/失败，不迁移 |
| 进程与 session | 一个活跃工作区一个 DSH 进程；同一工作区顺序节点共享进程；fan-out 分支各自工作区/进程；一个可执行节点一个 DSH session |
| session 绑定 | DSH 生成 session id，client 回传，调度器绑定到实例/节点 |
| 技能供给 | 调度器按节点确定技能组合；client 建 session 后凭 session id 换取清单，刷新工作区项目根；只屏蔽全局技能根，项目根保留 |
| 脚本 | 随技能包附带，模型在 session 内调用；client 只负责落地与路径 |
| 产物 | 只存本地；跨边界只回少量结果 |
| 决策归属 | 评审、分支、fan-out/fan-in 由调度器；client 只执行 |

## 待确认与风险

- 进程组/作业树清理：S0-11 已复现 DSH 崩溃后工具子进程存活，client 必须按进程组清理；
- skill-filesystem 全局根屏蔽配置的分发、版本与升级；
- 一工作区一进程下 fan-out 的进程数与容量；
- 共享工作区跨实例与技能目录争用；
- 实例粘性带来的可用性边界（client 离线时实例停摆）；
- 鉴权、技能包校验和、工作区保留策略等契约前提。

已解决：DSH 在 prompt 时读取工作区技能；建 session 后写技能可见；同 session 替换可见。原“先建 session 再刷新”的顺序保留，不需要改为先取技能。

## 交付物

- [`boundary-design.md`](boundary-design.md)：边界与职责设计（框架稿，已回写 S0 与进程模型）。
- [`client-work.md`](client-work.md)：client 侧工作清单（工作包、S0 结果、里程碑、依赖）。
- 决策记录：[`2026-11-03-client-workspace-process-model.md`](../../history/decisions/2026-11-03-client-workspace-process-model.md)。

## 任务表

| ID | 类型 | 组件 | 状态 | 说明 |
|---|---|---|---|---|
| T-CB-01 | design | global | in_progress | 边界与职责设计框架稿 |
| T-CB-02 | design | global | in_progress | client 侧工作清单 |
| T-CB-03 | design | global | done | 回写 S0 结论（技能可见性、全局根屏蔽/项目根保留、崩溃清理、权限、用量） |
| T-CB-04 | design | global | done | 进程模型决策：一个活跃工作区一个 DSH 进程 |
| T-CB-05 | design | global | open | 按 `executor-http-v2` 改写交互章节（§6 与 §4.2/§4.5/§4.6/§4.7），并更新 `client-work.md` 的 `CW-02`/`CW-07` 出口；见 [`v2-alignment.md`](v2-alignment.md) |

## 装载清单

- `docs/history/works/2026-10-24-agentflow-execution-concept/concept-design.md`
- `docs/design/architecture.md`
- `docs/plan/open-questions.md`
- `docs/design/components/workflow/spec.md`（节点与专家绑定相关）
- `docs/design/components/expert/spec.md`（专家装配）
- `docs/design/components/skill/spec.md`（技能包与下载）

## 验收

- 职责矩阵覆盖定义、调度、执行、状态、技能、工作区、结果、失败、安全、观测；
- 主流程能说明两侧在实例启动、节点执行、技能刷新、结果、关闭、取消、离线时的动作；
- 明确状态与数据所有权，不出现双权威；
- 给出两侧工作包与里程碑，可据此分别开工；
- client 侧工作清单可直接拆任务，S0 验证项明确；
- 未把实现细节写成结论；假设、待定、风险单列。

## 备注

无对应 `REQ`，按旁路（设计/架构）处理；本轮只产出文档，不落实现。评审记录在评审后补 `review.md`，收口时补 `result.md`。
