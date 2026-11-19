---
layer: works
module: global
status: closed
updated: 2026-11-17
procedure: 2026-11-17-client-observability-fix-verification
level: P2
---

# 工序：client 观测面修复复验

> 输入：client `client-fix-response.md`；对应 orchestrator `client-fix-list.md`。
> 范围：只验证修复，不改两侧代码。

## 1 验收

1. 逐条核对 `CF-01`–`CF-19` 的修复声明与实现/测试。
2. 真实 HTTP 复验：SSE 长连接 >15s、Last-Event-ID、ended snapshot+end、run_gone 410、raw Accept-Ranges、session meta、health uptime。
3. client 全量测试/typecheck/docs；orchestrator 真实适配器探针。
4. 残余 Hold 与 client 工作区未提交状态记录。

## 2 任务

| ID | 内容 | 状态 |
|---|---|---|
| `T-FIX-01` | 修复声明 vs 实现/测试静态核对 | 完成 |
| `T-FIX-02` | 真实 HTTP 探针（长 SSE/续传/gone/meta） | 完成 |
| `T-FIX-03` | orchestrator 适配器真实探针回归 | 完成 |
| `T-FIX-04` | 结果/评审 | 完成 |

## 3 装载

- client `client-fix-response.md`、`client-observability-v1.md`、`src/components/observer/*`
- 本仓库 `client-fix-list.md`、验证探针、`integration/probe/adapter-real.ts`
