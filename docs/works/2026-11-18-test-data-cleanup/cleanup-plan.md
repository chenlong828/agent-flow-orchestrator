---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-test-data-cleanup
level: P1
---

# 测试数据清理方案（已执行，2026-11-18）

> 2026-11-18 已按 E2E + SP 执行；`单一智能体任务` 保留。执行结果见 [result.md](result.md)。

## 1 结论

**明确垃圾（建议删除）**

| 数据 | 数量 | 识别 |
|---|---:|---|
| E2E 工作流 `E2E 流程 *` | 7 | 2026-11-17 14:55–15:54，联调探针创建 |
| E2E 专家 `E2E 专家 *` | 8 | 同上 |
| E2E Harness `E2E 节点 *` | 8 | 含 1 个未绑定 `mwktgnx6` |
| E2E run | 10 | 5 个 succeeded、5 个 cancelled，全部 done |
| E2E 实例 | 5 | `/var/folders/.../afc-e2e-*` |
| E2E task/task_attempt | 15 / 15 | `run_node.task_id` 反查 |
| E2E run_artifact | 15 | 全部 `session_log` |
| `SP-TEST-01` 工作流 | 1 | 2026-11-14，1 个 succeeded run |
| `SP-TEST-01` run/实例/task/artifact | 1 / 1 / 2 / 3 | `/tmp/af-superproj`；使用种子专家，无测试专家 |

**保留（2026-11-18 用户确认）**

| 数据 | 数量 | 说明 |
|---|---:|---|
| `单一智能体任务` 工作流 | 1 | 2026-11-17 07:51；2 个 run（1 succeeded、1 cancelled） |
| 其 `执行专家`、`结束节点` | 2 | 与工作流同一分钟创建；各被该工作流/run 引用；**保留** |
| 其 run/task/artifact | 2 / 5 / 7 | 5 session_log + 2 archive；使用真实 instance `af-workspace-demo` 与 `chenlong-mac-01` |

**保留**

| 数据 | 数量 |
|---|---:|
| 真实工作流 | 3：`单一任务开发流程`、`需求分析流程`、`简单需求开发流程` |
| 种子专家 | 10：启动/需求/方案/架构/实现/评审/测试/收尾等 |
| Harness | 1：`chenlong-mac-01` |
| 真实实例 | 1：`/Users/chenlong/hundsun/af-workspace-demo` |
| 真实 run | 25 |
| 真实 run_artifact | 175 |

## 2 现状计数

当前主库：

```text
workflow 12, expert 20, harness 9, workflow_run 38, instance 7,
task 173, task_attempt 173, run_node 190, run_artifact 200,
workflow_definition 12, workflow_expert_ref 39
```

预期（删除 E2E + SP）：

```text
workflow 4, expert 12, harness 1, workflow_run 27, instance 1,
task 156, task_attempt 156, run_artifact 182
```

> 实例数在“删除 E2E+SP”后为 1：`单一智能体任务` 使用真实实例，保留其 run；清理不触碰该实例。

## 2.1 Dry-run 结果（2026-11-18，已回滚）

脚本：[`cleanup.ts`](cleanup.ts)；输出：[`dry-run-output.txt`](dry-run-output.txt)。

```text
TARGET  workflows=8 experts=8 harnesses=8 runs=11 instances=6 tasks=17 artifacts=18
BEFORE  workflows=12 experts=20 harnesses=9 runs=38 instances=7 tasks=173 attempts=173 artifacts=200 nodes=190
AFTER   workflows=4 experts=12 harnesses=1 runs=27 instances=1 tasks=156 attempts=156 artifacts=182 nodes=168
DRY_RUN_ROLLBACK / DRY_RUN_OK
```

- 事务内执行了完整删除顺序，随后 `ROLLBACK`，主库无变化。
- `ARCHIVE_TARGETS` 共 12 个顶层目录：10 个 E2E run、1 个 SP run、1 个 SP history；单智能体任务的 `runs/01a1e886...`、`runs/01a1e966...` 与 `history/.../01a1e886...`、`.../01a1e966...` **不在目标内**。
- apply 前需停 3100/client、停 PG 备份 `pgdata`/`archive`；脚本只做 DB + 归档目录移动，不做停服/备份。

## 3 为什么不直接用产品 API

- `workflow_run` **没有删除 API**；只能 SQL。
- `workflow` 删除只做 revision 检查，不检查 run 引用；有 run 时会被外键 `ON DELETE RESTRICT` 拦下。
- `expert`/`harness` 删除有引用守卫；在 run/workflow 清理前也删不掉。
- 因此：**先 SQL 事务删 run/task，再用同一事务删 workflow/expert/harness/instance**；不混用 API，避免半套状态。

## 4 外键顺序

```text
1. 收集 target run_id / task_id / instance_id / expert_id / harness_id / workflow_id / store_key
2. DELETE workflow_run WHERE id IN target_runs
   → cascade run_node、run_artifact
3. DELETE task_attempt WHERE task_id IN target_tasks
   → DELETE task WHERE id IN target_tasks
4. DELETE workflow WHERE id IN target_workflows
   → cascade workflow_definition、workflow_expert_ref
5. DELETE expert WHERE id IN target_experts
   → cascade expert_persona/ref/skill/tool
6. DELETE harness WHERE id IN target_harnesses
   → cascade harness_tag
7. DELETE instance WHERE id IN target_instances
   （确认无 run/task 剩余）
8. 事务提交
```

- 不能先删 expert/harness/instance：`run_node.expert_id`、`workflow_run.harness_id/instance_id`、`task.instance_id` 是 RESTRICT。
- 不删 `run_node`/`run_artifact` 子表：由 `workflow_run` 级联；collect store_key 必须在删除前。
- `task` 与 `run_node.task_id` 无外键，单独按 task_id 删；`task_attempt` 先删或靠 task 级联（建议显式先删，便于计数）。

## 5 备份

本地没有 `pg_dump`（`.local/pg/bin` 只有 initdb/pg_ctl/postgres），用**停库文件级备份**：

```bash
# 1) 停 3100 + client serve，确认无活跃 run
# 2) 停 PG
bash scripts/pg.sh stop
# 3) 备份；目标路径先确认不存在
cp -a .local/pgdata .local/pgdata-backup-20261118
cp -a .local/archive .local/archive-backup-20261118
# 4) 起 PG
bash scripts/pg.sh start
```

- 必须停 PG 后复制，避免半写页。
- `.local/archive.bak-20261113` 是旧备份，保留，不覆盖。
- 也可以把 `pgdata` 复制到独立目录后用另一个端口启动做 dry-run；不建议直接在主库试删。

## 6 脚本/Dry-run

确认范围后写一个一次性脚本（不放入产品路由）：

```text
docs/works/2026-11-18-test-data-cleanup/cleanup.ts
  默认：dry-run；在事务中执行并 ROLLBACK
  --apply：提交后移动归档目录；需：
    CLEANUP_APPLY_CONFIRM=YES
    CLEANUP_BACKUP_CONFIRMED=YES
```

apply 命令（备份完成后）：

```bash
CLEANUP_APPLY_CONFIRM=YES CLEANUP_BACKUP_CONFIRMED=YES \
  bun docs/works/2026-11-18-test-data-cleanup/cleanup.ts --apply
```

硬约束：

- 目标 ID 用**显式集合/名称+时间窗**，不用无边界 `LIKE` 删除。
- E2E：`name LIKE 'E2E 流程 %'`/`'E2E 专家 %'`/`'E2E 节点 %'` + `created_at` 在 `2026-11-17 14:55–15:55Z`；交叉校验 run 的 workflow_id/harness_id/instance_id。
- SP：显式 workflow id `01a1d7fd-be08-7725-9756-7c3c32784c67`。
- Single（可选）：显式 `01a1e87d-6575-7267-a8f8-67655e4756f7`；专家 `01a1e87c-a1e8-71a4-ad4c-126b714c2575`、`01a1e87c-ea8d-71d2-ba1c-eba504b4280e`。
- 删除前 `SELECT` 计数必须与方案一致；任何不一致停止。

## 7 归档文件

路径（`archiveRoot=.local/archive`）：

- E2E：`runs/<runId>/`（15 个 session_log；无 history/archive）。
- SP：`runs/<runId>/` + `history/<instanceId>/<runId>/`。
- Single（可选）：`runs/<runId>/` + `history/<instanceId>/<runId>/`。
- 真实 run 的 `runs/`/`history/` 不动。

建议**先 DB 事务提交，再把目标 `store_key` 对应目录移到隔离区**：

```text
.local/archive.cleanup-quarantine-20261118/
```

核对产品/文件无引用后，再删除隔离目录。不要直接 `rm -rf .local/archive`。

## 8 执行步骤（确认后）

1. 停 3100 与 client `serve`；确认目标 run 全为 `done`、无活跃 instance/task。
2. 停 PG，备份 `pgdata` + `archive`，起 PG。
3. 先跑 dry-run（`BEGIN ... ROLLBACK`），核对 §2 计数与 §1 集合。
4. 跑 apply（单事务）；失败自动回滚。
5. 按 target `store_key` 移动归档目录到 quarantine。
6. 重启 3100；核对 `/healthz`、workflow/expert/harness 列表、真实 run 数量。
7. 验收通过后删除 quarantine；保留 DB/archive 备份至少一个发布周期。

## 9 验收查询

```sql
-- 应为 0
select count(*) from workflow where name like 'E2E 流程 %' or name = 'SP-TEST-01';
select count(*) from expert where name like 'E2E 专家 %';
select count(*) from harness where name like 'E2E 节点 %';

-- 保留
select count(*) from workflow;       -- 4（3 真实 + 单一智能体任务）
select count(*) from expert;         -- 12（10 种子 + 执行专家/结束节点）
select count(*) from harness;        -- 1
select count(*) from workflow_run;   -- 27（25 真实 + 单一智能体任务 2）
select count(*) from run_artifact;   -- 182（175 真实 + 单一智能体任务 7）
```

## 10 风险与待确认

| 风险/决定 | 处理 |
|---|---|
| 把真实工作流/种子专家误删 | 显式 allowlist；保留集先导出；删除前计数核对 |
| 外键顺序错 | 单事务 + dry-run；失败回滚 |
| 文件删早/删错 | 先备份；DB 提交后移动到 quarantine；核对后删 |
| 活跃 run/客户端仍在写 | 停 3100 + client；确认目标 run done |
| `单一智能体任务` 是否测试 | **已确认保留**（2026-11-18）；不删其工作流/run/专家/文件 |
| `结束节点`/`执行专家` 是否为测试专家 | **已确认保留**；不删 |
| 旧备份被覆盖 | 新备份用新目录；保留 `.local/archive.bak-20261113` |
| 测试库干扰 | 只动 `agentflow`；`agentflow_test` 不碰 |
