---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-test-data-cleanup
level: P1
---

# 工序：清理开发测试遗留的工作流/专家/Harness/run 数据

> 触发：联调后主库 `agentflow` 残留 E2E 实验数据与手工测试数据。用户要求先分析操作方式，未确认前不删除。
> 数据删除不可逆，按 P1 处理；必须先备份、先 dry-run、再确认执行。

## 1 范围

| 做 | 不做 |
|---|---|
| 只读盘点主库测试数据、引用与文件存储 | 删除种子/真实工作流及其 run |
| 给出分类、删除顺序、备份、dry-run、验证步骤 | 未经确认直接 `DELETE`/`TRUNCATE`/`DROP` |
| 产出可复核的 cleanup 方案 | 清理测试库 `agentflow_test`（测试基座自管） |
| 执行后核对 API/计数/文件 | 改产品删除 API 或 schema |

## 2 验收（执行时）

1. 明确测试集与保留集；保留 3 个真实工作流、10 个种子专家、`chenlong-mac-01`、真实实例与 25 个真实 run。
2. 先备份 `pgdata` 与 `archive`；SQL 在事务中执行，失败回滚。
3. 删除后计数与 §4 预期一致；E2E/SP（及确认的单智能体任务）为 0；真实数据不变。
4. 归档文件移入隔离目录，确认后再删；不碰 `.local/archive.bak-20261113`。
5. 重启 3100，`/healthz`、`/api/v1/workflows`、`/api/v1/experts`、`/api/v1/harnesses` 正常。

## 3 任务

| ID | 内容 | 状态 |
|---|---|---|
| `T-CLN-01` | 只读盘点表/数据/引用/文件 | 完成 |
| `T-CLN-02` | 分类与删除顺序方案 | 完成 |
| `T-CLN-03` | 用户确认清理范围（E2E/SP；单智能体保留） | 完成 |
| `T-CLN-04` | 停服备份 + dry-run | 完成（备份 + dry-run） |
| `T-CLN-05` | 事务删除 + 文件隔离 + 验证 | 完成 |

## 4 装载

- [cleanup-plan.md](cleanup-plan.md)
- 主库：`postgres://postgres@127.0.0.1:54329/agentflow`（只读盘点已完成）
- 存储：`.local/archive`；DB 数据：`.local/pgdata`
- 真实工作流：`单一任务开发流程`、`需求分析流程`、`简单需求开发流程`
- 保留：`单一智能体任务` 及其 `执行专家`/`结束节点`（2026-11-18 确认）


## 5 P1 执行记录（2026-11-18）

- 范围：E2E + `SP-TEST-01`；`单一智能体任务` 及其 `执行专家`/`结束节点` **保留**。
- 方式：停 3100 + 停 PG；备份 `pgdata`/`archive`；dry-run 回滚通过；`--apply` 单事务提交；归档移入 quarantine；重启 3100。
- 结果：workflow 12→4、expert 20→12、harness 9→1、run 38→27、instance 7→1、task 173→156、artifact 200→182；E2E/SP 为 0；真实数据与 single 保留。
- 备份：`.local/pgdata-backup-20261118-002624`（3.2G）、`.local/archive-backup-20261118-002624`（282M）。
- 详见 [result.md](result.md)、[review.md](review.md)、[apply-output.txt](apply-output.txt)。
