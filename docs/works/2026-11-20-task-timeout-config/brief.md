---
layer: works
module: run
status: active
updated: 2026-11-20
procedure: 2026-11-20-task-timeout-config
---

# 工序：任务执行超时配置（默认 60 分钟，本机部署一天）

## 1 范围

- `run.default_timeout_ms` 是既有的节点任务终止上界配置；本次把默认值从 30 分钟改为 **60 分钟**，并把本机实际部署（`config/local.toml`，agentflow-local）覆盖为 **86400000 ms（一天）**。
- 不改 `TaskRequest.timeoutMs` 契约、不改 client 代码、不新增 DB 迁移；正数上界仍然是 client 到点执行 `session/cancel` 的依据，调度器仍用 `timeoutMs + resultGraceMs` 做未回报回队。
- 不做：按节点覆盖、0/无限超时、超时续跑 TTL、服务端取消通道重做。

## 2 验收

1. 无 `local.toml` 时配置默认值为 3600000；环境变量与 TOML 覆盖仍按现有优先级生效。
2. `config/local.toml` 设置 `[run] default_timeout_ms = 86400000` 后，`loadConfig` 返回 86400000。
3. 调度器继续接受 1–86400000 的 `timeoutMs`；新任务按配置值下发，重派仍保持该值。
4. 相关测试与全量门禁通过；服务重启后 `/healthz` 正常。

## 3 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-TMO-01` | change | config | 默认值 1800000 → 3600000；默认配置注释 | 完成 |
| `T-TMO-02` | change | config（本机） | `config/local.toml` 覆盖为 86400000 | 完成（本地，不入库） |
| `T-TMO-03` | test | config/scheduler | 默认值、上限、12h 不回队、静默回队 | 完成 |
| `T-TMO-04` | docs | config/run | 规格同步默认值与部署覆盖 | 完成 |
