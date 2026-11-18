---
layer: works
module: global
status: closed
updated: 2026-11-18
procedure: 2026-11-18-check-skill-extraction
level: P1
---

# 工序：把代码质量门禁抽取为可复用的检查技能

> 触发：现有 `scripts/quality-report.ts` 与本仓库布局、工具版本、阈值强耦合，无法复用到其他 JS 后端，也无法承载 Java/Rust/Vue 等后续检查方案。
> 定级 P1：新增技能资产、工作流与专家，改变评审链路的入口与状态归属。用户在 2026-11-18 明确「把 AB 一起执行」，作为本轮人工评审确认记录。

## 1 范围

| 做 | 不做 |
|---|---|
| 定义 check-scheme 契约：发现、doctor、precheck、report、gate、calibrate | 替换本项目现有 `quality:report`（先并存，parity 通过后另立工序切换） |
| `js-backend-code-review` 技能包：引擎、30 条规则、JS 后端判断清单、管理态/执行态命令 | 实现 Java/Rust/Vue 的具体检查规则（只留接入契约与占位） |
| `workspace-scan` 技能包：扫描工作区、发现并聚合检查方案 | 改现有 `quality-report.ts` 的规则与阈值 |
| AF 接入：`workspace-start` / `workspace-manager` / `workspace-end` 专家、`WORKSPACE-01` 工作流 | 新建 UI 页面或改 HTTP 契约 |
| 夹具、selftest、parity 对照、seed 测试更新 | 提交任何密钥、把工具二进制入库 |

## 2 验收

1. `js-backend-code-review` 能在本仓库以示例 profile 跑出与现有报告一致的关键结果：HARD/工具健康口径一致，违规 0，工具 8/8。
2. 在非本项目布局的最小 fixture 上可跑出报告，不因 `src/components`、`http-gateway`、`main.ts` 等硬编码误报。
3. 判断清单按技术栈独立：JS 后端在 `references/judgment-checklist.md`；`workspace-scan` 只定义通用判断框架，不写 JS 规则。
4. 工作区可发现多个 check scheme：`workspace-scan` 读取各技能的 `scripts/scheme.json`，按 `appliesTo` 给出启用建议；新增语言只加技能包，不改工作区代码。
5. 两阶段可交替：执行态输出 `calibration` 请求；`calibrate --accept --reason` 写 `profile.revision+1` 与基线，管理态变更带前后数据。
6. 执行态离线可跑：工具从本地缓存或仓库 `node_modules` 解析；缺失时退出 2 并说明缺什么，不当作 PASS。
7. `WORKSPACE-01` 工作流、三个专家可在种子数据中创建；seed 测试按新计数通过。
8. `bun run typecheck`、`bun test`、`bun run quality:report` 均通过。

## 3 任务

| ID | 内容 | 状态 |
|---|---|---|
| `T-CSK-01` | 定义 check-scheme 契约与目录规范 | 完成 |
| `T-CSK-02` | 实现 `workspace-scan`：scan / discover / doctor / 聚合调度 | 完成 |
| `T-CSK-03` | 实现 `js-backend-code-review` 引擎与管理态/执行态命令 | 完成 |
| `T-CSK-04` | 写 JS 规则目录与判断清单、示例 profile | 完成 |
| `T-CSK-05` | 夹具、selftest、本仓库 parity | 完成 |
| `T-CSK-06` | AF 接入：技能种子、三个专家、`WORKSPACE-01` 工作流 | 完成 |
| `T-CSK-07` | 更新 seed 测试并跑全量验证 | 完成 |
| `T-CSK-08` | result.md 与决策记录 | 完成 |

## 4 关键约定

- 技能包内路径只允许 `SKILL.md`、`scripts/**`、`references/**`；配置与夹具放 `scripts/` 下。
- 检查方案 manifest 固定为 `scripts/scheme.json`；报告 schema 为 `check-report@1`。
- 状态目录：`.workspace/checks/<scheme>/`（profile、baseline、tools.lock、reports）；扫描结果 `.workspace/scan.json`。
- 技能包不写死语言；JS 专属规则只在 `js-backend-code-review` 内。
- 阈值、豁免、基线变更必须由管理态写入并记录理由；执行态只读。

## 5 装载

- 现有门禁：[scripts/quality-report.ts](../../../scripts/quality-report.ts)、[docs/playbook/code-health-rules.md](../../playbook/code-health-rules.md)
- 技能包机制：[src/components/skill/package.ts](../../../src/components/skill/package.ts)、[scripts/seed.ts](../../../scripts/seed.ts)
- 工作流节点类型：[src/components/workflow/graph.ts](../../../src/components/workflow/graph.ts)
- 现有工作流与专家种子：[scripts/seed.ts](../../../scripts/seed.ts)

## 6 结果

见 [result.md](result.md)：引擎自检 17/17、本仓库 parity 违规 0/仅报告 224/工具 8-8、precheck 约 1s、全量测试 418 pass / 1 skip、种子 15 Skill / 13 专家 / 3 流程 / 52 装配边。
