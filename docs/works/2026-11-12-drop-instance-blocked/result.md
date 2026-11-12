---
layer: works
module: global
status: active
updated: 2026-11-12
procedure: 2026-11-12-drop-instance-blocked
---

# 结果：删除实例 `blocked` 状态

## 1 结论

实例状态收敛为 `active` / `retired`。`failed(workspace)` 不再摘除实例，只结算同实例其余排队任务；同一工作区下一次启动照常派发，错误直接显示在节点上。`OQ-32` 关闭。

## 2 验收结果

| 项 | 命令/方式 | 结果 |
|---|---|---|
| 迁移 | 重启服务 | `已应用迁移：0007_drop_instance_blocked.sql`；库里 6 条实例全部 `active` |
| 状态机 | `TC-EXR-004` 改写 | 失败后实例 `active`、兄弟任务 `failed`、新入队任务下一跳派发 |
| 实例服务用例 | `tests/components/instance/service.test.ts` | 只保留 `retire` 幂等与终态；`block`/`unblock` 用例删除 |
| 重跑实测 | 在曾失败的 `/tmp/af-slug-check` 起 run | 正常派发，n1 `succeeded`、run 推进到 n2 |
| 全量测试 | `bun test --max-concurrency=1` | 390 pass / 0 fail |
| 门禁 | `typecheck`、`docs:check`、`quality:report` | 通过；违规 0 |

## 3 结论落点

| 产物 | 落点 |
|---|---|
| 迁移 | `db/migrations/0007_drop_instance_blocked.sql` |
| 状态机与契约 | [`instance/spec.md`](../../design/components/instance/spec.md) §2、§3、§4 |
| 结算语义 | [`scheduler/spec.md`](../../design/components/scheduler/spec.md) §4.5、§4.8 |
| 运行编排复用 | [`run/spec.md`](../../design/components/run/spec.md) §5 |
| 场景 | `SCN-0202`（`TC-EXR-004`）、`SCN-0201`、`SCN-0301` 的失败路径描述 |
| 代码 | `instance/{types,service,store,validate,index}.ts`、`scheduler/result.ts`、`main.ts` |
| 开放问题 | `OQ-32` 关闭；`OQ-21` 改为「部分关闭」 |

## 4 裁决摘要

blocker 0 / decision now 3（已落规格与测试）/ hold 0。详见 [`review.md`](review.md)。

## 5 偏差与未覆盖

- `OQ-21`（契约无「实例不可用」上报载体）保留：当前不需要，若将来引入「自动重排到同实例」再补字段。
- `retired` 仍无 REST 面，与本次无关。
