---
name: "review-verdict"
description: "审核判定：核验 task-space 产物并输出 verdict JSON（pass/fail）；结束前必须输出，否则本次判定无效。触发：review 节点、审核、准出、判定"
version: "v1.2"
---

# 用途

评审节点使用。把「审什么、怎么算过」落成可解析的结论：**报告写进 `review.md`，最终消息只留一行 verdict JSON**。

## 步骤

1. 读取 `<task-space>/intent.md`，明确本次运行的目标与约束。
2. 读取本阶段应审的产物（方案、代码说明、测试结论等），逐项对照目标核验。
3. 每条结论给出证据：文件路径、命令输出或测试结果；找不到证据的一律按不通过处理。
4. 把完整报告写进 `<task-space>/review.md`（审什么、证据、结论、未决项）。
5. 结束前在最终消息的**末尾**输出一个裸 JSON 对象（独占最后一行，或紧跟在最后一句之后都可以），不加代码围栏、不加行内反引号；它之后不要再出现别的 JSON。两种形态：

   {"verdict":"pass","reason":"通过依据"}

   {"verdict":"fail","reason":"可执行的回退理由"}

## 判定标准

- `pass`：产物满足目标，证据齐全，没有未决的阻塞项。
- `fail`：存在缺失、与目标不符、证据不足，或留有必须修复的缺陷。
- `reason` 写「回哪个阶段、改什么」，不写情绪化评价。

## 常见踩坑

- 只写自然语言结论、消息里没有 verdict JSON，编排侧判 `verdict_invalid`。
- 把 JSON 放在正文中间、后面还跟了新的 JSON 示例：取最后一个 verdict 对象，容易判错对象。
- JSON 里 `verdict` 用了 `passed`/`ok`/`true` 之类的值，解析失败。
- 为了推进流程默认给 pass，却没有证据。
