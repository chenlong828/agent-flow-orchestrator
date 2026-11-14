---
layer: works
module: global
status: active
updated: 2026-11-13
procedure: 2026-11-13-af-dev-flow-seed
level: P2
---

# 工序：af-dev-flow 种子（流程 + 专家 + 技能）

> 用户裁决（2026-11-13）：提示词只由「运行环境 + 专家」组成，节点名不进提示词；技能不注入提示词，落 `.dsh/skills` 由模型自行发现激活；目标流程定为 8 节点；`arch-design-spec` 按「单技能 + references」打包；种子替换采用重建演示库。

## 1 问题

现有种子是 UI 夹具数据（5 Harness / 10 工具 / 12 技能 / 8 专家），技能是占位正文，专家与流程也与真实研发流程无关。`CMP-run` 把节点名当任务说明拼进 prompt，节点上的文字成了执行语义，无法支撑「专家承载身份、技能承载能力」的模型。

## 2 范围

| 做 | 不做 |
|---|---|
| 7 个技能的真实 `SKILL.md` 内容落到 `scripts/seed-skills/`（5 个来自 af-dev-skill + `workflow-init` + `review-verdict`），种子从文件打包 | 改 `CMP-run` 的 prompt 组成（另立工序，见 `plan/roadmap.md`） |
| 8 个专家按「身份 + 技能装配 + 工具」重写种子 | 改 `expert` / `skill` / `workflow` 表结构 |
| 1 条 8 节点流程 `TRUN-DEV-01` 连回退边写入种子 | 改执行面契约与客户端 |
| 不预置 Harness 与工具；不使用未经验证的虚构内容 | UI 仓库改动 |
| 种子相关测试、README 计数同步 | 真实 client 联调（内容就绪后单独验收） |

## 3 验收标准

1. `bun run db:seed` 幂等：重复执行行数与包数不变，版本不被覆盖。
2. 种子产出 7 技能 / 8 专家 / 1 流程，不写入 Harness 与工具；每个技能包解压后 `SKILL.md` 合法（kebab-case `name`、`version vX.Y`、≤16 KiB），`references/` 附件路径合法。
3. `TRUN-DEV-01` 图通过 `assertRunnableGraph`：1 start / 1 end、8 个节点各绑不同专家、两条回退边（n4→n3、n6→n5）指向祖先。
4. 专家的 `skillIds` 全部存在、每条装配边唯一；专家工具引用全部存在。
5. `tests/scripts/seed.test.ts` 与 `tests/components/skill/read.test.ts`、`draft.test.ts` 按新内容收敛并通过。
6. 重建演示库后 3100 重启，`/healthz` 与 `/openapi.yaml` 为本次版本，技能列表返回 10 条、专家 8 条、流程含 `TRUN-DEV-01`。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-SEED-01` | design | global | 流程 / 专家 / 技能清单与装配关系 | 完成 |
| `T-SEED-02` | change | scripts | 技能内容落 `scripts/seed-skills/`（7 个，含 `references/`） | 完成 |
| `T-SEED-03` | change | scripts | `seed.ts`：读文件打包、新技能与专家、流程与分类 | 完成 |
| `T-SEED-04` | change | tests | 种子计数与技能读/写测试同步 | 完成 |
| `T-SEED-05` | docs | global | README 计数与文档口径同步 | 完成 |
| `T-SEED-06` | verify | global | 重建演示库、重启 3100、`bun run check` | 完成 |
| `T-SEED-07` | change | scripts | 剔除虚构内容：删 `svo`/`test-data`/`ab-review` 与全部 Harness/工具预置及专家工具装配 | 完成 |

装载清单：本文件、`docs/design/components/skill/spec.md` §8、`docs/design/components/run/spec.md` §4.4、`docs/design/components/expert/spec.md`、`scripts/seed.ts`、`docs/history/decisions/2026-11-03-client-workspace-process-model.md`。

## 5 内容清单（定稿）

| 节点 | 类型 | 专家 | 装配技能 |
|---|---|---|---|
| n1 启动 | start | 启动节点 | workflow-init |
| n2 需求 | agent | 需求分析专家 | req-scenario-spec、doc-layout-spec |
| n3 方案 | agent | 方案设计专家 | design-before-coding、doc-layout-spec |
| n4 方案评审 | review | 架构评审专家 | arch-design-spec、review-verdict |
| n5 实现 | agent | 开发实现专家 | dev-execution-spec、doc-layout-spec |
| n6 代码评审 | review | 评审专家 | review-verdict |
| n7 测试 | agent | 测试验证专家 | 无（能力型技能待补） |
| n8 收尾 | end | 收尾专家 | doc-layout-spec |

回退边：`n4 → n3`、`n6 → n5`；其余为 `seq`。

## 6 领取的开放问题

无新增；`OQ-29`（取消后未认领任务占容量）与本次无关。
