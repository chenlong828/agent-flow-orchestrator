---
layer: works
module: run
status: active
updated: 2026-11-20
procedure: 2026-11-20-task-timeout-config
---

# 结果：任务执行超时配置

## 1 结论

- `run.default_timeout_ms` 默认值改为 **3600000（60 分钟）**；`config/default.toml` 同步。
- 本机部署 `config/local.toml` 增加 `[run] default_timeout_ms = 86400000`（一天），已用 `loadConfig` 验证生效。
- 未改执行面契约与 client：`TaskRequest.timeoutMs` 仍是正数上界，client 继续按值计时并取消；调度器继续按 `timeoutMs + resultGraceMs` 做未回报回队。
- 未新增迁移：`task.timeout_ms` 现有 `>0` 约束已容纳一天；调度校验上限仍为 86400000。

## 2 落点

| 内容 | 文件 |
|---|---|
| 默认值与上限 | [`run-config.ts`](../../../src/core/config/run-config.ts) |
| 默认 TOML | [`default.toml`](../../../config/default.toml) |
| 本机部署覆盖（不入库） | `config/local.toml` |
| 配置规格 | [`config/spec.md`](../../design/components/config/spec.md) |
| 运行规格 | [`run/spec.md`](../../design/components/run/spec.md) |
| 测试 | [`config.test.ts`](../../../tests/core/config.test.ts)、[`validate.test.ts`](../../../tests/components/scheduler/validate.test.ts)、[`service.test.ts`](../../../tests/components/scheduler/service.test.ts) `TC-EXD-010` |

## 3 验证

```text
$ bun -e 'loadConfig({configDir:"./config"})'   # 读取 default + local
{"runDefaultTimeoutMs":86400000}

$ bun run typecheck
$ tsc --noEmit        # 通过

$ bun test --max-concurrency=1
452 pass / 1 skip / 0 fail（453 tests）
```

说明：`config/local.toml` 被 `.gitignore` 忽略，因此本机部署值不会入库；其他环境未设置时得到 60 分钟默认值。

## 4 未做

- 不提供 “0 = 无超时” 哨兵；按用户裁决，保持正数上界，本机用一天近似“不超时”。
- 不改 client：`timeoutMs` 仍由 client 计时取消，调度器只决定值并做未回报回队。
