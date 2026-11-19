---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-test-data-cleanup
level: P1
---

# 结果：清理开发测试遗留数据

## 1 结论

已按确认范围 **E2E + `SP-TEST-01`** 执行清理；`单一智能体任务` 及其 `执行专家`/`结束节点` 已按要求保留。主库从 12 workflow / 20 expert / 9 harness / 38 run / 7 instance / 173 task / 200 artifact 降为 **4 / 12 / 1 / 27 / 1 / 156 / 182**。E2E/SP 残留为 0；真实 3 个工作流、10 个种子专家、`chenlong-mac-01`、真实实例/25 个真实 run 与 single 的 2 个 run 均保留。

无数据丢失事故：删除前已停 PG 文件级备份，删除在单事务中完成，失败可回滚；归档文件先移到 quarantine，未直接删除。

## 2 备份

| 项 | 路径 | 大小 |
|---|---|---:|
| PG 数据 | `.local/pgdata-backup-20261118-002624` | 3.2G |
| 归档文件 | `.local/archive-backup-20261118-002624` | 282M |

- 备份时 3100 已停、PG 已停，`pg_ctl` 启动后执行 apply。
- 旧备份 `.local/archive.bak-20261113` 未触碰。

## 3 Apply 结果

命令：

```bash
CLEANUP_APPLY_CONFIRM=YES CLEANUP_BACKUP_CONFIRMED=YES \
  bun docs/works/2026-11-18-test-data-cleanup/cleanup.ts --apply
```

输出：[`apply-output.txt`](apply-output.txt)。

| 计数 | Before | Target | After |
|---|---:|---:|---:|
| workflow | 12 | 8 | **4** |
| expert | 20 | 8 | **12** |
| harness | 9 | 8 | **1** |
| workflow_run | 38 | 11 | **27** |
| instance | 7 | 6 | **1** |
| task | 173 | 17 | **156** |
| task_attempt | 173 | 17 | **156** |
| run_artifact | 200 | 18 | **182** |
| run_node | 190 | — | **168** |

- Target：8 个 workflow（7 E2E + SP）、8 个 E2E expert、8 个 E2E harness、11 个 run（10 E2E + SP）、6 个实例（5 E2E + SP）、17 个 task、18 个 artifact。
- 删除顺序：`workflow_run`（级联 run_node/run_artifact）→ `task_attempt`/`task` → `workflow` → `expert` → `harness` → `instance`。
- 事务提交后，12 个归档顶层目录移入 `.local/archive.cleanup-quarantine-2026-11-17T16-27-24.510Z`（88K）。

## 4 执行后验证

- 3100 已重启，`/healthz` = `{status:"ok",database:"up"}`。
- `GET /api/v1/workflows?limit=200`：4 条——`单一智能体任务`、`单一任务开发流程`、`简单需求开发流程`、`需求分析流程`。
- `GET /api/v1/experts?limit=200`：12 条——10 个种子专家 + `执行专家`/`结束节点`。
- `GET /api/v1/harnesses?limit=200`：1 条 `chenlong-mac-01`。
- `GET /api/v1/runs?limit=200`：27 条，全部 `done`（25 真实 + single 2）。
- E2E/SP 查询为 0；single 查询仍为 1 个工作流、2 个 run、2 个专家。
- 目标归档目录已从 `.local/archive/runs` 消失；quarantine 仅含目标目录。

## 5 保留与 quarantine

- **保留**：3 个真实工作流、10 个种子专家、`chenlong-mac-01`、真实实例、25 个真实 run、`单一智能体任务` 及其 2 专家/2 run/5 task/7 artifact。
- **quarantine**：`.local/archive.cleanup-quarantine-2026-11-17T16-27-24.510Z`；保留至少一个发布周期，确认无引用后再删除。
- **DB/archive 备份**：同上；保留至少一个发布周期。
- **未触碰**：`agentflow_test`、旧备份 `.local/archive.bak-20261113`、真实归档文件。

## 6 残余

- 客户端 `serve` 未主动停（它只连 3100，不连 DB）；3100 重启后会自动重连。
- quarantine 与备份目录待后续清理；本次不删。
- 没有修改产品 API/schema；没有新增迁移。
