---
layer: requirements
module: workflow-execution
status: accepted
updated: 2026-11-17
req: REQ-0002
---

# REQ-0002 运行文件浏览（人工确认节点）

## 1 场景叙述

研发人员的工作流运行进入 `confirm`（人工确认）节点并挂起后，在运行详情/节点弹层中打开「文件」视图：可浏览本 run 的 task-space 与 workspace 目录树（含子目录），点开 markdown、代码等文本文件阅读内容，再据此批准或驳回。文件读取只读，不修改 client 工作区；client 在线时实时读取，client 离线或版本不支持时给出明确错误。

## 2 价值

不做的话，人工确认只能依据节点最终消息或消息里预写的片段；方案、评审记录、代码改动都落在 client 的 task-space/工作区，服务端没有读取面，确认节点实际上只能凭节点消息判断。会话日志只能看到执行过程，不能稳定还原最终文件内容。

## 3 非目标

- 不做写操作：不编辑、不保存、不上传、不删除 client 文件，不提供终端。
- 不做运行结束后从归档浏览 task-space（v1 只覆盖运行中、client 在线；归档浏览另行评估）。
- 不做进入 `confirm` 时的自动文件快照（v1 不做持久快照；client 离线即不可读）。
- 不做二进制/图片预览与文件下载（v1 只预览文本；二进制只返回元数据）。
- 不做工作区全量递归索引、全文搜索或文件变更历史。
- 不改变 `confirm` 的决策语义与 `API-46` 请求/响应；文件浏览是旁路读。
- 不做管理面鉴权（沿用现状；生产前另立）。

## 4 约束

- 服务端不直接访问 client 工作区；文件由 client 的只读观测面提供，orchestrator 通过其 API 获取（`REQ-0001` §4）。
- client 只新增**只读观测面**，不是控制面；orchestrator 直连观测面取文件；client 必须可被调度器访问（同机/同网段/隧道）。
- `CMP-run` 不直接向 client 发网络请求；由 `CMP-observability-client` 适配器调用观测面。
- 只读、run 级：只能读该 run 的 `workspace_path` 与 `task_space_path`；路径相对、拒绝 `..`/绝对路径、符号链接不得越界。
- 接受 client v1 的 2000 条 / 1 MiB 文件限制；2 MiB/5s 由适配器/UI BFF 侧体现；后续按观察再调。
- 执行面契约只做加法（`TaskRequest.runId?` + poll `X-Observability-Url` 头），不新增执行面端点、不升 `X-Executor-Protocol` 版本；不落库、不改表。
- 文件内容可能含敏感信息；本机无鉴权，生产前必须补鉴权或访问控制。

## 5 影响场景

- `SCN-0303` 人工确认与运行控制：新增断言「`waiting_confirm` 时可按 run 列出 task-space 文件并读取 markdown/代码内容」。
- `SCN-0305` 运行文件浏览（待新建）：列表、读取、路径越界/超时反例。
- 不改变 `SCN-0301`/`SCN-0302`/`SCN-0304` 的现有断言。

## 6 澄清记录

| 日期 | 问题 | 结论 |
|---|---|---|
| 2026-11-17 | 人工审核节点范围 | 以 `confirm`（人工确认）为主；API 按 run 级设计，后续 `review` 旁看可复用 |
| 2026-11-17 | client 文件通道 | poll 反向请求：poll 响应带 `fileRequests`，client 读本地文件后回传；不做 orchestrator 直连 client 入站 |
| 2026-11-17 | 方向调整 | 改为让 client 实现 **session 为主的只读观测面**（attempt 只保留薄视图，状态机归调度面），orchestrator 直连 `O-09`/`O-10` 取文件；poll 反向请求保留为 NAT/离线备选。见 [`2026-11-17-client-observability/proposal.md`](../works/2026-11-17-client-observability/proposal.md) |
| 2026-11-17 | 验证后限制口径 | 已确认接受 client 观测面 v1 的 2000 条 / 1 MiB；不为此改 client。 |
| 2026-11-17 | 生命周期与能力 | v1 运行中实时只读；不做 confirm 快照、不做结束后归档浏览、不做下载 |

## 7 状态

`accepted`（2026-11-17）：场景叙述可判定、非目标明确、影响场景已识别。验收 = `SCN-0305` 3+1 与 `SCN-0303` 新增断言通过；约束未被违反。
