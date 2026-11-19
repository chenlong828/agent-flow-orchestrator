---
layer: works
module: global
status: active
updated: 2026-11-17
procedure: 2026-11-17-ui-observability-layer
level: P1
---

# 工序：UI 观测层接入（文件 / 会话 / BFF 流式）

> 输入：orchestrator `API-48`–`API-53` 已实现并通过 416 测试；client **`client-observability-v1.2`（`e0946f4`）** 已通过 176/0 与无 UI 核心联调；UI 仍是 `CMP-instances` 的概要/会话日志两 Tab，BFF 全量缓冲。
> 本工序只产出 UI 层 proposal 与调测 runbook；UI 代码由独立仓库 `agent-flow-ui` 实现。

## 1 范围

| 做 | 不做 |
|---|---|
| UI 组件地图、候选方案、P1 定级与确认点 | 修改 `agent-flow-ui` 代码 |
| BFF 流式契约与超时/头/取消设计 | 新增 orchestrator 端点/迁移 |
| `CMP-run-data` 6 个只读方法与错误映射 | 代理 attempt 产品端点 |
| 文件 Tab / 会话 Tab 的页面生命周期与交互 | 文件编辑/上传/删除/终端 |
| BFF/UI Playwright/真实 run 的调测步骤 | 真实 DSH 模型验收（另立） |
| 验收三件套与 debug runbook | UI 发布/部署 |

## 2 验收

1. proposal 能回答：组件怎么拆、BFF 如何流式、`run-data` 契约、页面如何不打断 SSE、失败如何展示。
2. 明确 `API-48`–`API-53`、`RunSessionRichEvent`、文件限制、无 sessionId、UI 不直连 client。
3. 给出 P0/P1/P2 任务、测试场景、真实调测顺序和已知失败矩阵。
4. P1 边界/契约经人确认后才进入 UI 实现；本工序不写 UI 代码。

## 3 任务

| ID | 内容 | 状态 |
|---|---|---|
| `T-UI-01` | 现状盘点与候选方案（组件/BFF/传输） | 完成 |
| `T-UI-02` | 组件地图、契约、页面生命周期、测试计划 | 完成 |
| `T-UI-03` | P1 边界与契约确认 | 完成（方案 A/EventSource/30s） |
| `T-UI-04` | UI 项目实现（新 work，external） | 待外部领取 |
| `T-UI-05` | BFF/Playwright/真实 run 调测 | 待外部领取 |

## 4 装载

- [proposal.md](proposal.md)
- [debug-runbook.md](debug-runbook.md)
- 产品契约：[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) §4.1.1
- run 规格：[`run/spec.md`](../../design/components/run/spec.md) §3.3
- 跨项目清单：[`handoff.md`](../2026-11-17-client-ui-handoff/handoff.md)
- 集成结果：[`result.md`](../2026-11-17-client-observability-integration/result.md)
- UI 现状：`agent-flow-ui/docs/design/architecture.md`、`components/instances/spec.md`、`components/run-data/spec.md`、`bff/spec.md`
- client 基线：`client-observability-v1.2`（`e0946f4`）

## 5 待确认（P1）

1. ~~组件拆分：方案 A（新增 `CMP-run-files` / `CMP-run-session`）还是方案 B（并入 `CMP-instances`）。~~ → **已确认 A**。
2. ~~SSE 传输：`EventSource` 还是 fetch stream。~~ → **已确认 EventSource**。
3. 场景：扩展 `SCN-0004` 还是新建 UI 场景（由 UI 项目按 req-scenario 流程确认）。
4. ~~BFF 超时：文件/session JSON 30s、SSE/raw 无总超时是否接受。~~ → **已确认**。

## 6 P1 确认记录（2026-11-17）

- 组件拆分：方案 A；新增 `CMP-run-files`、`CMP-run-session`，`CMP-instances` 只做 Tab/上下文编排。
- SSE：`EventSource`；BFF 透传 `Last-Event-ID`。
- BFF：文件/session JSON 30s；SSE/raw 无总超时；stream 路径不缓冲。
- 场景：推荐扩展 `SCN-0004`，最终编号由 UI 项目确认。
- 确认后进入 UI 项目实现；本仓库不改 `agent-flow-ui` 代码。
