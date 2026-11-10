---
layer: works
module: global
status: closed
updated: 2026-11-10
---

# 结果：执行面客户端架构与组件规格评审（调度器侧）

## 1. 验收

| 判据（brief） | 结果 | 证据 |
|---|---|---|
| 四档裁决：每条带证据、后果、修法 | 满足 | `review.md` §2–§5、§6.3 |
| 可实现性：端口签名能被消费方组装 | 满足 | 第二轮复核 §6.1–§6.2，`AB-01`–`AB-04`、`AD-01`–`AD-05`、`AH-01`–`AH-08` 全部关闭 |
| 冻结输入：S0 开工前必须改的条目可照改 | 满足 | `review.md` §6.4 结论「通过」；`NB-01`、`ND2-01`/`ND2-02` 为十行内补齐 |

## 2. 对象变更

- 评审对象是 client `architecture.md`（331 行）与 9 份组件规格（全部 `planned`），契约基线为 `executor-http-v1`。
- 2026-11-10 client 按 `executor-http-v2` 重写（`e047e0a`）：`heartbeat`/`assignments`/`cleanupPending`/租约/`lockInstance` 等端口整体删除，`NB-01`（`HeartbeatOutcome` 缺 `assignments`）与 `ND2-01`/`ND2-02` 失去承载对象。
- 首轮 `AB-01`–`AB-04` 与 `AD-01`–`AD-05` 在 client `8e3c168` 中关闭，v2 重写后相关端口再次被替换，结论只作历史。

## 3. 仍然成立的不变量（v2 实现复核）

| 条目 | 不变量 | v2 实现证据 |
|---|---|---|
| `AD-02` | 截断标记预留字节，含标记不超过上限 | `agent-flow-client/src/components/result/result.ts:43-57` |
| `AD-03` | `stateRoot` 分区（journal/孤儿、技能缓存、日志） | `store/journal.ts`、`assets` 缓存根、`observability/logger.ts` 由 `serve-compose.ts` 分区注入 |
| `AD-05` | `DSH_HOME` 由 runtime 创建、实例关闭时随进程回收，失败留 `doctor` | `runtime/runtime-instance.ts:18`、`runtime/runtime.ts:155-166` |

## 4. 收口说明

- 评审对象已被 v2 重写替换，本评审不再作为后续设计依据；`review.md` 随目录归档为历史证据。
- 无遗留转出项：`ND2-03`–`ND2-06` 随 `cleanupPending`/`reconcileCleanup` 机制删除而失效。
