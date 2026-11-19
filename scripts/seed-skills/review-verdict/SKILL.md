---
name: "review-verdict"
description: "审核判定：核验 task-space 产物并通过 MCP 信号提交 verdict（pass/fail）；不再使用最终消息 JSON。触发：review 节点、审核、准出、判定"
version: "v1.9"
---

# 用途

评审节点使用。把「审什么、怎么算过」落成结构化结论：**报告写进 `review.md`，结论通过 MCP 工具提交**。

## 步骤

1. 读取 `<task-space>/intent.md`，明确本次运行的目标与约束。
2. 读取本阶段应审的产物（方案、代码说明、测试结论等），逐项对照目标核验。
3. 每条结论给出证据：文件路径、命令输出或测试结果；找不到证据的一律按不通过处理。
4. 把完整报告写进 `<task-space>/review.md`（审什么、证据、结论、未决项）。
5. 调用工具列表里的 `mcp__agentflow__signal`（语义别名 `agentflow_signal`）提交结论：
   - `kind=review_verdict`
   - `verdict=pass` 或 `fail`
   - `reason`：通过依据或可执行的回退理由
   - `evidence`：证据列表（文件/命令/测试结果，可选）
   - 参数错误时按工具返回的错误修正后重试；不要在正文里另写一份 verdict。

## 判定标准

- `pass`：产物满足目标，证据齐全，没有未决的阻塞项。
- `fail`：存在缺失、与目标不符、证据不足，或留有必须修复的缺陷。
- `reason` 写「回哪个阶段、改什么」，不写情绪化评价。
- `fail` 必须引用任务出口或场景卡的具体条目（`T-xxxx` / `T-SCN-xxxx` / 文件行）；卡外新增的证据要求只能记建议。
- 证据层级按任务出口与场景卡标注核对，不越级要求；证据分级见 `af-flow-rule` §1；确认与默认确认见 `auto-confirm`。

## 常见踩坑

- 工具可用却只在正文写结论：服务端不再解析消息 JSON，会按 `verdict_invalid` 判失败。
- 把工具公开名写成裸 `agentflow_signal` 去调用；模型应以工具列表显示的名字为准。
- `verdict` 用了 `passed`/`ok`/`true` 之类的值；工具会拒绝，按错误修正。
- 为了推进流程默认给 pass，却没有证据。
- 用「证据不够」判 fail，却指不出任务出口/场景卡的哪一条，或要求卡外的更高层级证据。
