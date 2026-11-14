---
layer: works
module: global
status: frozen
updated: 2026-11-13
procedure: 2026-11-13-af-dev-flow-seed
level: P2
---

# 结果：af-dev-flow 种子（流程 + 专家 + 技能）

## 1 结论

> 未验证：`TRUN-DEV-01` 没有端到端执行过一次。本节结论只覆盖种子写入、技能包合法性与静态结构（读库 / 读 HTTP / 测试），不含任何一次真实节点执行。

种子只保留有真实出处的内容：5 个技能来自 `~/skills/af-dev-skill`，`workflow-init` 与 `review-verdict` 是流程必需、本项目新写；共 7 个技能、8 个专家、1 条 8 节点流程 `TRUN-DEV-01`。不预置 Harness 与工具，专家不装配任何工具（Harness 由 client 首次 poll 自注册）。

## 2 交付物

| 范围 | 落点 |
|---|---|
| 技能内容 | `scripts/seed-skills/<slug>/SKILL.md`（7 个）；`arch-design-spec/references/arch-design-workflow.md` |
| 种子脚本 | [`scripts/seed.ts`](../../../scripts/seed.ts)：读文件打包、7 技能、8 专家、`TRUN-DEV-01` 图与 `workflow_expert_ref`；不写 Harness/工具 |
| 分类参考数据 | 迁移 [`0008_skill_category_flow.sql`](../../../db/migrations/0008_skill_category_flow.sql)：新增 `process`（流程）、`docs`（文档） |
| 测试 | `tests/scripts/seed.test.ts`、`tests/components/skill/{read,draft}.test.ts`、`tests/db/schema.test.ts`、`tests/components/platform/db.test.ts`、`tests/components/http-gateway/{skill,skill-scenarios,journey}.test.ts` |
| 文档 | [`README.md`](../../../README.md) 种子口径 |

## 3 验证记录

- `bun run check`：typecheck 通过；测试全绿；`docs:check` 通过。
- `bun run db:seed`：`Skill 7、专家 8、流程 1；专家技能装配 11 条（不预置 Harness/工具）`。
- HTTP 读回（3100，重建后）：
  - `GET /api/v1/skills` 返回 7 条，`slug` 与分类与清单一致；
  - `GET /api/v1/experts` 返回 8 条，`toolCount` 全为 0，技能计数合计 11；
  - `GET /api/v1/tools` 返回 0 条；
  - `GET /api/v1/workflows` 返回 `TRUN-DEV-01`（`nodeCount=8`），图含 7 条 `seq` + 2 条 `rollback`（`n4→n3`、`n6→n5`）。
- 技能包：`arch-design-spec` 解压含 `SKILL.md`（10,822 B）+ `references/arch-design-workflow.md`，frontmatter `name=arch-design-spec`、`version=v1.0`；全部 `SKILL.md` ≤16 KiB。

## 4 演示库重建

1. 停 3100；旧存储目录改名备份：`.local/skills.bak-20261113`、`.local/archive.bak-20261113`（首次重建前）。
2. `drop database agentflow` → `create database agentflow`。
3. `bun run db:migrate`（0001–0008）→ `bun run db:seed`。
4. 重启 3100，`/healthz` 返回 `{"status":"ok","database":"up"}`。

代价：旧库的 run / task / workflow 行（含 TRUN09 联调证据）已清空；旧存储目录保留为备份。

## 5 修订记录

**2026-11-13 第一次重建后纠偏。** 第一次种子把两类来源不同的内容混在一起，且未在方案里标出来源：

| 被移除的内容 | 原来源 | 原因 |
|---|---|---|
| `svo`、`test-data`、`ab-review` 三个技能 | 旧 UI 夹具的虚构占位技能，`af-dev-skill` 里不存在这些概念 | 用户确认「全部清掉」 |
| 10 个工具（含 `metadata_query`、`business_tree_query` 两个 MCP，`trace_call_chain`、`linter`、`data_factory` 等） | 旧 UI 夹具，从未存在、从未运行 | 用户确认「全部清掉」 |
| 5 个 Harness（build-01 / build-02 / agent-07 / etl-03 / dev-lap） | 旧 UI 夹具，虚构地址 | 用户确认「全部清掉」 |
| 8 个专家上的 11 条工具装配边 | 我把上述虚构工具自行绑到新专家 | 用户确认「全部清掉」 |

保留：5 个来自 `af-dev-skill` 的技能；`workflow-init`、`review-verdict` 两个新写技能（用户确认保留）。测试验证专家因此暂时没有技能，等真实能力型技能补充后再装配。

## 6 遗留

| 项 | 说明 | 去向 |
|---|---|---|
| 提示词重组 | 节点名仍会进入 prompt、技能仍无注入通道 | 下一工序（`CMP-run` prompt 改为环境块 + 专家块，`run_node.enter_reason`） |
| 真实联调 | 新流程未跑过真实 client | 提示词重组后联调 |
| 测试验证专家无技能 | 虚构的 `svo` / `test-data` 被移除后暂缺能力型技能 | 有真实技能后再装配 |
| 旧历史文档计数 | `history/works/` 中 2026-10/11 的结果文档仍写 12 Skill 等 | 历史冻结，不回改；以本文件与 README 为准 |
