---
layer: works
module: global
status: active
updated: 2026-11-17
procedure: 2026-11-17-client-ui-handoff
level: P2
---

# 工序：client / UI 补充工作交接

> 输入：orchestrator 6 个产品 API 已实现并通过 416 测试/quality 0；client P0/P1 修复已复验；UI 尚未接入文件/会话视图。
> 本文是跨项目交接；详细清单见 [`handoff.md`](handoff.md)。本仓库不改 client/UI 代码。

## 1 范围

| 做 | 不做 |
|---|---|
| 整理 client 残余修复与发布前检查 | 改 client 源码 |
| 整理 UI 的 BFF 流式、数据层、文件 Tab、会话 Tab、测试 | 改 UI 源码 |
| 给出 API 对照、错误/限制口径、验收清单与顺序 | 新增 orchestrator 端点/迁移 |
| 指出 client/UI 与 orchestrator 的边界 | 把 UI 作为验收前置（UI 是独立项目） |

## 2 验收

1. 文档能让 client/UI 各自按表领取任务，不需要再读 orchestrator 内部实现。
2. 6 个产品 API 的路径、DTO、错误、限制、SSE 名称写清。
3. client 残余项有优先级、证据、落点；UI 任务有 P0/P1 与验收。
4. 明确“UI 不直连 client”“sessionId 不出现在产品响应”“文件限制 2000/1 MiB”等边界。

## 3 任务

| ID | 内容 | 状态 |
|---|---|---|
| `T-HO-01` | 汇总 client 残余与发布检查 | 完成 |
| `T-HO-02` | 汇总 UI BFF/数据层/Tab/测试 | 完成 |
| `T-HO-03` | API 对照与验收清单 | 完成 |
| `T-HO-04` | 交接给 client/UI 仓库 | 待外部项目领取 |
| `T-HO-05` | client 阻塞复核（测试门禁/P1/P2） | 完成 |
| `T-HO-06` | 无 UI 核心联调（client serve + fake ACP + orchestrator 3100） | 完成 |

## 4 装载

- [`handoff.md`](handoff.md)
- client 契约：`agent-flow-client/docs/design/contracts/client-observability-v1.md`
- client 修复反馈：`agent-flow-client/docs/works/2026-11-06-observability-http/client-fix-response.md`
- 复验结果：[`fix-verification/result.md`](../2026-11-17-client-observability-fix-verification/result.md)
- orchestrator 集成结果：[`integration/result.md`](../2026-11-17-client-observability-integration/result.md)
- HTTP 契约：[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) §4.1.1
