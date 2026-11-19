---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-test-data-cleanup
level: P1
---

# 评审：清理开发测试遗留数据（P1）

## 结论

**通过**。范围按用户确认的 E2E + `SP-TEST-01` 执行；`单一智能体任务` 及两专家保留。删除前备份、dry-run、单事务、归档 quarantine、执行后 API/计数核对均完成；blocker 0。

## Blocker

无。删除后计数与预期完全一致；真实数据/种子专家/single 保留；3100 健康；E2E/SP 为 0。

## Decision now

| 决策 | 结论 |
|---|---|
| 清理范围 | E2E + `SP-TEST-01`；`单一智能体任务` + `执行专家`/`结束节点` 保留（用户 2026-11-18 确认） |
| 执行方式 | 停 3100/PG → 备份 `pgdata`/`archive` → dry-run → apply 事务 → 归档 quarantine → 重启 |
| 删除路径 | 不用产品 API（run 无删除 API、FK RESTRICT）；一次性脚本显式集合 |

## Verified sound

| 项 | 证据 | 结果 |
|---|---|---|
| 目标集合 | dry-run/apply TARGET：8/8/8/11/6/17/18 | 与分类一致 |
| 事务 | `APPLIED`，after 计数 4/12/1/27/1/156/182 | 通过 |
| 真实/保留 | API 4 workflows、12 experts、1 harness、27 runs；single 1/2/2 | 通过 |
| 残留 | E2E/SP 查询 0 | 通过 |
| 归档 | 12 个目标目录移入 quarantine；archive 内目标目录消失 | 通过 |
| 服务 | `/healthz` ok | 通过 |

## Hold

| 项 | 处理 |
|---|---|
| quarantine 目录 | 保留一个发布周期；确认无引用后再删 |
| DB/archive 备份 | 保留一个发布周期；确认后再删 |
| 客户端 `serve` | 未主动停止；只连 3100，不连 DB；重启后自动重连 |
| 测试库 | `agentflow_test` 未动；测试基座自管 |

## 备注

- 备份为停 PG 后文件级复制（本地无 `pg_dump`）；不是逻辑导出，但一致。
- 本次不改产品代码/API/schema；脚本与输出保留在工序目录供复核。
