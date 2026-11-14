---
layer: works
module: run
status: active
updated: 2026-11-14
procedure: 2026-11-14-prompt-entry-reason
level: P2
---

# 工序：提示词构成、回退进入原因与执行侧约定

> 用户裁决（2026-11-14）：prompt 只保留任务头 + 专家块；节点名、技能清单、技能顺序不进 prompt；review 的 verdict 协议由专家描述兜底；被驳回重跑时把驳回理由注入 prompt（引擎保证，不依赖读文件）；进入原因只存指针，理由正文仍以 `verdict` 为唯一来源。

## 1 背景

前一阶段 prompt 仍是「运行上下文 + 节点名 + 输出要求」的硬拼文本：节点名承担了任务说明、引擎下发目录规范、review 的 verdict 格式写死在引擎里。实际运行暴露出三个问题：

1. 节点名当指令用，工作流作者把整段审核要求写进节点名；
2. 技能已按专家装配并由 DSH 注入目录，prompt 再列技能是重复；
3. 驳回重跑时 prompt 与首轮逐字节相同，模型不知道为何被退回。

## 2 范围

| 做 | 不做 |
|---|---|
| prompt 改为任务头 + 专家块；技能/顺序/节点名退出 | 节点级任务说明字段（DSL 不加字段） |
| `run_node.enter_reason` 指针列与 `[本次进入]` 渲染 | 把驳回理由复制进库里第二份 |
| `run` 详情节点行返回 `enterReason` 指针 | 界面改动（UI 另行处理） |
| task-space 目录名改 `task-spaces/<YYYYMMDD-HHmmss>` | 旧 run 路径迁移（非生产，不迁） |
| 种子：7 技能、8 专家、2 条流程、分类迁移 0008 | 虚构技能/工具/Harness 数据 |
| 收尾专家只汇总 task-space 内记录 | 收尾节点二次验证 |

## 3 验收标准

1. `bun run check` 全绿；`bun run quality:report` 违规 0。
2. 首轮 prompt 不含 `[本次进入]`、不含节点名与技能清单，含专家块。
3. review 判定 fail 后，目标节点与回退路径节点都带 `enterReason={kind:"review_fail",from,fromVisit}`，prompt 渲染「节点「X」判定 fail…」+ 驳回理由。
4. confirm 驳回后同样注入，渲染为「人工在「X」节点驳回…」+ 驳回意见。
5. 理由超过 300 字符截断；缺失写「未提供理由」。
6. 迁移 `0009` 可执行、可回滚（`drop column`）。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-PMP-01` | change | run | prompt 改为任务头 + 专家块，技能与顺序退出 | 完成 |
| `T-PMP-02` | change | run | `enter_reason` 指针列、回退写入、prompt 渲染 | 完成 |
| `T-PMP-03` | change | run | task-space 目录名改 `task-spaces/<YYYYMMDD-HHmmss>`（冲突加 `-2`） | 完成 |
| `T-PMP-04` | change | scripts | 种子：技能内容落文件、专家与两条流程、分类迁移 | 完成 |
| `T-PMP-05` | change | tests | run/skill/seed/迁移列表测试同步 | 完成 |
| `T-PMP-06` | docs | global | run spec §2/§4.4/§4.5、契约、场景卡、README | 完成 |

装载清单：`docs/design/components/run/spec.md`、`docs/design/contracts/executor-http-v3.md`、`docs/history/decisions/2026-11-03-client-workspace-process-model.md`、`scripts/seed.ts`、`src/components/run/*`。
