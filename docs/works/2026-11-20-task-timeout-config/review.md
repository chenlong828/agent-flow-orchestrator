---
layer: works
module: run
status: active
updated: 2026-11-20
procedure: 2026-11-20-task-timeout-config
---

# 评审：任务执行超时配置（P2）

## 1 Blocker

无。

## 2 Decision now

| # | 决定 | 证据 |
|---|---|---|
| D1 | 默认 60 分钟；本机部署用 `config/local.toml` 覆盖为一天 | 用户 2026-11-20 明确「默认 60 分钟，agentflow-local 设置成天」；`loadConfig` 实测返回 86400000 |
| D2 | 不做 `0 = 无超时`，保持 `timeoutMs > 0` | 用户裁决「一天约等于不超时」；避免改执行面契约与 client |

## 3 Verified sound

| 区域 | 查了什么 | 结果 |
|---|---|---|
| 配置默认值 | 无配置文件时 `runDefaultTimeoutMs` | 3600000（config.test.ts） |
| 部署覆盖 | `default.toml` + `local.toml` 合并 | 86400000（`loadConfig` 实测） |
| 调度契约 | `timeoutMs` 仍限 1–86400000；一天边界接受 | `validate.test.ts` |
| 回队行为 | 一天上界在 12h 内不按超时回队；client 静默仍回队 | `TC-EXD-010` |
| 全量门禁 | typecheck + test | 452 pass / 1 skip / 0 fail |

## 4 Hold

| 项 | 原因 | 去向 |
|---|---|---|
| 按节点覆盖超时 | 超出本次范围 | `run/spec.md` 待定 |
| 0 / 真正无限超时 | 用户已否决，改用一天近似 | 不实现 |
| 本机部署值的版本化 | `config/local.toml` 按现有约定不入库 | 部署环境自行维护 |

## 5 结论

**通过（P2）**。默认值与部署覆盖符合用户裁决；无契约、client、DB 迁移改动；全量测试通过。
