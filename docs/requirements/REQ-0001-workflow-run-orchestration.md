---
layer: requirements
module: workflow-execution
status: accepted
updated: 2026-11-11
req: REQ-0001
---

# REQ-0001 工作流运行编排与节点回传

## 1 场景叙述

研发人员在工作流定义完成后，通过 HTTP 启动一次运行：提供目标节点（`harnessId`）、客户端工作区路径和一段 markdown 启动诉求。服务端按启动时的图快照逐个节点推进：执行节点在 client 上拉起 session、读写本运行的 task-space；审核节点返回 pass/fail，失败时沿预设回退边退回指定节点；人工确认节点等待外部 API 决策；每个节点结束由 client 上传 session-log，运行结束后打包上传 task-space 归档。研发人员可查询运行状态、读取会话日志、取消运行。

## 2 价值

不做的话，工作流定义只能保存与校验，无法真正执行；现有执行面只能跑手工注入的单条任务，无法串成一次完整的业务流程。

## 3 非目标

- 不做 UI；`agent-flow-ui` 是独立项目，按 REST 契约接入。
- 不做 `split` / `fanout` 两类节点的执行（第二期：task.db 拆分、大任务量展开、技能集一致性）。
- 不做多实例 / 多 client 的 run 调度、优先级与负载均衡。
- 不做运行过程的实时事件推送与可视化；状态以查询为准。
- 不做管理面鉴权（沿用现状，进生产前另立工序）。

## 4 约束

- 只提供 HTTP API `/api/v1`；执行面契约由 v2 升到 v3，需与 `agent-flow-client` 同步发布。
- 不改变 `CMP-scheduler` 对「任务列表」的职责：run 编排不得让调度器依赖工作流与图。
- 服务端不访问 client 工作区；归档只写服务端配置的 `archive.root`。
- 图结构变更（节点类型、回退边）是定义侧契约变更，外部 UI 必须按新枚举适配。

## 5 影响场景

- `SCN-0301` 运行启动与节点推进（已建 `draft`）
- `SCN-0302` 节点判定、回退与会话日志回传（已建 `draft`）
- `SCN-0303` 人工确认与运行控制（已建 `draft`）
- `SCN-0304` 运行归档（已建 `draft`）

## 6 澄清记录

| 日期 | 问题 | 结论 |
|---|---|---|
| 2026-11-11 | 节点类型与现有 DSL 的关系；start/end/confirm 语义 | 7 类：`start/agent/split/review/confirm/fanout/end`；start 执行并接收启动输入，end 执行并整理输出，confirm 为人工节点（开发期可默认通过），删 `fanin` |
| 2026-11-11 | 跳转如何表达 | 复用 `rollback` 边，只允许 `review`/`confirm` 发起、目标为祖先；模型只输出 pass/fail，不决定目标 |
| 2026-11-11 | 启动参数与目标 | 启动请求带 `harnessId`、`workspacePath`、`intent`，服务端自动登记 instance |
| 2026-11-11 | 上下文传递 | 以 task-space 目录为唯一上下文载体，prompt 只注入路径；task-space 按 run 隔离，靠提示词与 skill 规范约束，不靠文件权限 |
| 2026-11-11 | 制品与归档 | task.db 用 SQLite、由 skill 脚本生成、client 上传、调度器只读校验；session-log 全量 JSONL + gzip，上传成功才算节点完成；run 结束 client 打包 task-space 上传，服务端存 `<archive.root>/history/<instanceId>/` |
| 2026-11-11 | 分期 | 第一期：run 骨架 + 常规 + 审核回退 + confirm + session-log + 归档；第二期：split + fanout |

详细定案见 [`2026-11-11-workflow-run-orchestration/design-proposal.md`](../history/works/2026-11-11-workflow-run-orchestration/design-proposal.md) §2。

## 7 状态

`accepted`（2026-11-11）：场景叙述可判定、非目标明确、影响场景已识别。交付验收 = 四个影响场景全部 `verified` 且约束未被违反。
