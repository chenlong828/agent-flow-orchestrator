---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-check-skill-extraction
level: P1
---

# 结果：代码质量门禁抽取为多方案检查技能

## 1 结论

A（技能包与引擎）与 B（AF 接入）已一起完成：

- `js-backend-code-review`：可复用的 JS/TS 后端检查技能，30 条规则、管理态/执行态命令、JS 判断清单、夹具与自检；在本仓库以示例 profile 跑出与现有报告一致的关键结果。
- `workspace-scan`：check-scheme 契约与工作区调度，发现/启用/聚合检查方案，不含任何语言规则；后续 Java/Rust/Vue 只新增技能包。
- AF 接入：新增 `workspace-start`、`workspace-manager`、`workspace-end` 三个专家与 `WORKSPACE-01` 工作流，并加入种子。
- 现有 `quality:report` 未替换；`tsconfig.json` 只新增一条排除，避免夹具参与项目类型检查。

## 2 交付物

| 交付 | 位置 |
|---|---|
| JS 检查技能 | [scripts/seed-skills/js-backend-code-review/](../../../scripts/seed-skills/js-backend-code-review/) |
| 工作区扫描技能 | [scripts/seed-skills/workspace-scan/](../../../scripts/seed-skills/workspace-scan/) |
| 通用判断框架 | [workspace-scan/references/judgment-framework.md](../../../scripts/seed-skills/workspace-scan/references/judgment-framework.md) |
| JS 判断清单 | [js-backend-code-review/references/judgment-checklist.md](../../../scripts/seed-skills/js-backend-code-review/references/judgment-checklist.md) |
| 种子（技能/专家/工作流） | [scripts/seed.ts](../../../scripts/seed.ts) |
| 决策记录 | [docs/history/decisions/2026-11-18-check-skill-extraction.md](../../history/decisions/2026-11-18-check-skill-extraction.md) |
| 工序 brief | [brief.md](brief.md) |

## 3 验证

| 项 | 命令 | 结果 |
|---|---|---|
| 引擎自检 | `node scripts/seed-skills/js-backend-code-review/scripts/selftest.mjs` | 17/17 通过 |
| 本仓库 parity | `review.mjs report --profile .../examples/agent-flow.json` | 违规 0；仅报告 224；工具 8/8；WARN 与旧报告同为 Q-16/Q-19/Q-26/Q-28 |
| precheck 时延 | `review.mjs precheck --changed` | 约 0.98s |
| 工作区发现 | `checks.mjs discover --skills-dir scripts/seed-skills` | 发现并启用 `js-backend` |
| 调度聚合 | `checks.mjs precheck --changed --profile ...` | 退出 0，聚合结果含 `schemes[].result` |
| 类型检查 | `bun run typecheck` | 通过 |
| 全量测试 | `bun test --max-concurrency=1` | 418 pass / 1 skip（夹具中的 skip 用例）/ 0 fail |
| 种子测试 | `bun test tests/scripts/seed.test.ts` | 15 Skill / 13 专家 / 3 流程 / 52 装配边 |
| 项目门禁 | `bun run quality:report` | 违规 0；仅报告 224；工具 8/8 |

## 3.1 专家与技能装配（最终）

| 专家 | 技能 | 说明 |
|---|---|---|
| `workspace-start` | `workflow-init`、`workspace-scan`、`af-flow-rule`、`auto-confirm` | 诉求落盘 + scan/doctor + 漂移阻断；仅 `WORKSPACE-01` 使用，研发流仍用 `start-node`（2026-11-18 决定保持现状） |
| `workspace-manager-js` | `workspace-scan`、`js-backend-code-review`、`doc-layout-spec`、`af-flow-rule`、`auto-confirm` | JS/TS 项目的接入与校准；后续按项目新增 `workspace-manager-java` / `workspace-manager-vue`，各自只挂对应方案 |
| `workspace-end` | `doc-layout-spec`、`af-flow-rule` | 核对状态文件与提交，不做状态翻转 |
| `implementer` | 原 5 项 + `js-backend-code-review` | 提交前跑 precheck，结果写 dev.md |
| `code-reviewer` | 原 4 项 + `js-backend-code-review` | 评审第一步 precheck，再 report + 判断清单，最终裁决仍归 `review-verdict` |

装配边 39 → 52（新增 11 条工作区装配 + 2 条评审/实现装配）。`WORKSPACE-01` 的 n3 固定绑 `workspace-manager-js`；Java/Rust/Vue 项目复制工作流并把 n3 换成对应专家。

## 4 与旧报告对照

| 指标 | 旧报告 | 新引擎 |
|---|---|---|
| 文件行数最大 | 500（harness/service.ts） | 500 |
| 单文件导出最大 | 28（kernel/ports.ts） | 28 |
| 单文件函数数最大 | 23（observability-client/adapter.ts） | 23 |
| 组件扇出最大 | 8（http-gateway/app.ts） | 8 |
| 可选字段比例 | 60.0% | 60.0% |
| 可空列比例 | 56.3%（run_node） | 56.3% |
| 多任务 churn | 47 | 47 |
| 违规 / 仅报告 / 工具 | 0 / 224 / 8-8 | 0 / 224 / 8-8 |

## 5 未做与后续

- **未替换** `scripts/quality-report.ts`；切换需另立工序，先保持两套结果并行对照。
- **Java/Rust/Vue 方案未实现**：只落契约与占位建议，具体规则、工具链与判断清单由后续技能包补齐。
- **未在真实 AF 环境演练** `WORKSPACE-01`：种子与图已加入并通过种子测试，但未启动 UI 跑一次完整接入；需要另一次联调验证。
- **未提交**：本轮只改工作区文件，未产生 commit；`git status` 中另有一批本工序之外的历史改动，未触碰。
- 工具安装命令 `tools install` 依赖 npm 与网络，未在本机执行（本仓库直接复用 `node_modules`）。
