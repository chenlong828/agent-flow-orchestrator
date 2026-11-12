---
layer: works
module: global
status: active
updated: 2026-11-12
procedure: 2026-11-12-client-skill-package-304
---

# 结果：客户端技能包 304 缺陷（提案已交付）

## 1 结论

带技能包的 run 失败不是服务端或编排链路问题：客户端在缓存未命中时仍用任务自带的 ETag 发 `If-None-Match`，服务端按 `P-03` 回 `304`，客户端判定「无字节可用」并让节点失败。修改提案已写好，交 `agent-flow-client` 实施；本仓库不改代码。

## 2 验收证据

| 项 | 命令/方式 | 结果 |
|---|---|---|
| 无缓存语义 | 同一包：不带条件头 → `200` / 367 B；带该包 ETag → `304` | 与服务端逻辑一致，`304` 由客户端主动触发 |
| 影响面 | `task.skill_set` 历史：`packages=0` 的 run 成功，`packages≥1` 的 run 全部 `failed(asset)` | 100% 复现，与网络/凭据无关 |
| 客户端代码 | `gateway.ts:64-73`、`package-cache.ts:26-36` | 缓存未命中仍传 `etag` |
| 文档 | `OQ-17` 由「待定」改为「已实测触发 + 修复归属」 | 见 [`open-questions.md`](../../plan/open-questions.md) |

## 3 结论落点

| 产物 | 落点 |
|---|---|
| 修改提案（补丁、测试、验收、临时办法） | [`client-proposal.md`](client-proposal.md) |
| 开放问题状态 | [`OQ-17`](../../plan/open-questions.md) |
| 契约（不改） | [`executor-http-v3.md`](../../design/contracts/executor-http-v3.md) `P-03`；[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) §5.5 的 `304` 说明保持原样 |

## 4 偏差与未覆盖

- 未改 `agent-flow-client`，补丁未在其仓库跑测试；提案里的测试代码基于该仓库现有用例风格，实施时需按实际 `skillSet()` 助手调整。
- 未处理「技能包版本轮换后旧缓存堆积」：`cacheRoot` 下按 digest 累积 zip，清理策略不在本提案范围。
