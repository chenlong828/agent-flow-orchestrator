---
layer: works
module: global
status: closed
updated: 2026-11-15
procedure: 2026-11-15-verdict-and-dev-flow-pipeline
level: P2
---

# 结果：review verdict 协议与 af-dev-flow 流程改版

## 1 结论

verdict 不再依赖代码围栏：取消息末尾窗口（256 KiB，与契约 `maxResultBytes` 同宽）内最后一个可解析、`verdict` 为 `pass`/`fail` 的 JSON 对象，裸 JSON 与代码围栏都接受。种子改为 11 技能 / 10 专家 / 2 条流程 / 21 条装配边，`TRUN-DEV-01` 增「任务拆分」「实现鉴定」两节点与 `n10→n5` 回退边；重跑种子只在流程不存在时创建，保留界面改名与改图。

验证：`bun run check` **402 pass / 0 fail**，`docs:check` 通过（16 个场景）；`bun run quality:report` **违规 0**。

## 2 交付物

| 范围 | 落点 |
|---|---|
| verdict 解析 | `src/components/run/verdict.ts`：末尾窗口 + 括号匹配 + 最多 200 个候选；单测 `tests/components/run/verdict.test.ts` |
| 种子技能 | `scripts/seed-skills/task-split/`、`scenario-verify/`、`implementation-accept/`、`swift-ui-probe/`（含 `references/`、`scripts/`）；`req-scenario-spec` v2.0 拆出任务拆分；`doc-layout-spec` v3.6 补节点文件分工与状态翻转；`review-verdict` v1.2 改裸 JSON |
| 种子专家与流程 | `scripts/seed.ts`：`task-splitter`、`accept-reviewer`；`TRUN-DEV-01` 10 节点 3 回退边；流程已存在则跳过 |
| 测试 | `tests/scripts/seed.test.ts`（计数、10 节点 / 3 回退边、幂等、不覆盖已有流程）、`tests/components/skill/{read,draft}.test.ts` 计数同步、`tests/components/run/verdict.test.ts` |
| 文档 | `README.md` 种子口径；`run/spec.md` §4.5；`executor-http-v3.md` §4.2；`SCN-0302` 场景卡 |

## 3 验证记录

- `bun run check`：402 pass / 0 fail；`docs:check` 通过。
- `bun run quality:report`：违规 0；工具健康 8/8（oxlint 仅诊断 7、knip 仅报告 30）。
- `verdict.test.ts` 8 条：末行裸 JSON、同一行紧跟最后一句、取最后一个对象（中间示例被覆盖）、代码围栏兼容、理由约 4 万字符、reason 含 `{}` 与引号、缺 verdict / 值非法 / JSON 损坏、reason 非字符串。
- `seed.test.ts`：首轮 11 / 10 / 2 / 21；分类计数 process 5、review 2、testing 2、coding 1、docs 1；重复执行幂等；`TRUN-DEV-01` 10 节点、3 条回退边；界面改名改图后重跑保留 `name`、`updated_by` 与 10 条专家引用。
- 技能包：11 个 `SKILL.md` 均通过 frontmatter 与 16 KiB 校验；`arch-design-spec` 仍为 v1.1。

## 4 影响与已知限制

- 已有数据库里的 `TRUN-DEV-01` 不会被更新为 10 节点：种子只补缺失流程。需要重建演示库，或删除该流程后重跑 `bun run db:seed`。
- verdict 窗口与 `maxResultBytes`（256 KiB）同宽；消息被截断导致 JSON 不完整时仍按 `verdict_invalid` 处理。
- 未做真实 run 端到端执行：本次验证覆盖单元、组件与种子层，不包含 review 节点真实产出裸 JSON 的一次运行。
- `swift-ui-probe` 的探针需要 macOS 图形会话，本仓库只校验技能包格式，未执行探针。

## 5 提交

| commit | 范围 |
|---|---|
| `c841ac4` `feat(run): verdict 改为解析消息末尾最后一个 JSON 对象` | `verdict.ts`、单测、run 规格 §4.5、执行面契约 §4.2、SCN-0302 |
| `e8ea89f` `feat(seed): af-dev-flow 增加任务拆分与实现鉴定节点` | 种子、4 个新技能、2 个新专家、流程图、种子/技能测试、README |
| 本目录 `docs(works)` | `brief.md` / `result.md` / `review.md` |

## 6 遗留

| 项 | 去向 |
|---|---|
| 本工序仍是先改后补记录（连续两轮） | 待定：是否把「开工先立 brief」做成硬门禁 |
| 种子技能未同步进 `.agents/skills/` | 待定：随技能升级流程统一定 |
