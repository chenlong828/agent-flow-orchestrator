---
layer: works
module: global
status: closed
updated: 2026-11-15
procedure: 2026-11-15-verdict-and-dev-flow-pipeline
level: P2
---

# 工序：review verdict 协议与 af-dev-flow 流程改版

> 用户裁决（2026-11-15）：review 的 verdict 改为消息末尾的裸 JSON 对象，不再要求代码围栏；af-dev-flow 增加「任务拆分」「实现鉴定」两个节点并补 4 个技能；重跑种子不覆盖界面上已改的流程。

## 1 背景

上一工序（`2026-11-14-prompt-entry-reason`）遗留「节点记录约定」「任务日志落点」两项。实际运行继续暴露三个问题：

1. verdict 约定是「最后一段 `json` 代码块」，模型常直接输出裸 JSON 或把 JSON 放在正文中间，导致 `verdict_invalid` 把整个 run 判失败。
2. af-dev-flow 没有任务拆分与实现鉴定：设计通过后直接进实现，测试节点也没有专门技能，验收证据无处落。
3. 种子每次重跑都覆盖流程，界面上改过的流程名与图会被重置。

## 2 范围

| 做 | 不做 |
|---|---|
| verdict 取消息末尾最后一个可解析 JSON 对象，兼容代码围栏 | 改 verdict 字段语义（仍是 `pass`/`fail` + 可选 `reason`） |
| 种子技能：新增 `task-split`、`scenario-verify`、`implementation-accept`、`swift-ui-probe`；`req-scenario-spec` 拆出任务拆分；`doc-layout-spec` 补节点文件分工与状态翻转；`review-verdict` 改裸 JSON | 把种子技能同步进 `.agents/skills/`（本仓库技能目录另行决定） |
| 种子专家：新增任务拆分、实现鉴定两个专家；开发/评审/测试/收尾的职责与注意事项同步 | 改数据库表结构 |
| `TRUN-DEV-01` 增 `n9` 任务拆分、`n10` 实现鉴定与回退边 `n10→n5` | 迁移已有库的旧流程图（保留旧图，重建演示库或删流程后重跑） |
| 种子只在流程不存在时创建，保留界面改名与改图 | 改技能/专家的覆盖策略（仍按种子值更新） |
| README 种子计数、run 规格、执行面契约、场景卡、verdict 单测与种子测试 | UI 改动、真实 run 端到端执行 |

## 3 验收标准

1. `bun run check` 全绿（typecheck + 测试 + `docs:check`），`bun run quality:report` 违规 0。
2. `parseVerdict` 单测覆盖：末行裸 JSON、同一行紧跟最后一句、取最后一个对象、代码围栏兼容、长理由（约 4 万字符）、reason 含大括号与引号、缺 verdict/值非法/JSON 损坏返回 null、reason 非字符串省略。
3. 种子测试：11 技能 / 10 专家 / 2 条流程 / 21 条装配边；`TRUN-DEV-01` 10 节点、3 条回退边（`n4→n3`、`n6→n5`、`n10→n5`）；重复执行幂等；界面改名改图后重跑不被覆盖。
4. 每个技能包 `SKILL.md` 用 kebab-case `name`、`vX.Y` 版本、≤16 KiB。
5. README 种子计数与实际种子一致。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-VERDICT-01` | change | run | verdict 改解析消息末尾裸 JSON，窗口与 `maxResultBytes` 同宽 | 完成 |
| `T-SEED-01` | change | scripts | 4 个新技能、2 个新专家、10 节点流程与文档技能同步 | 完成 |
| `T-SEED-02` | change | scripts | 种子只在流程不存在时创建，保留界面改名与改图 | 完成 |
| `T-TEST-01` | change | tests | verdict 单测、种子计数/结构/幂等/不覆盖、技能计数同步 | 完成 |
| `T-DOC-01` | docs | global | README、run 规格 §4.5、执行面契约 §4.2、场景卡 SCN-0302 | 完成 |
| `T-DOC-02` | docs | global | 本工序 `brief.md` / `result.md` / `review.md` | 完成 |

装载清单：`src/components/run/verdict.ts`、`scripts/seed.ts`、`scripts/seed-skills/`、`docs/design/components/run/spec.md`、`docs/design/contracts/executor-http-v3.md`、`tests/components/run/verdict.test.ts`、`tests/scripts/seed.test.ts`。
