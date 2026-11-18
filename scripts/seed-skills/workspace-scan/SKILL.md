---
name: "workspace-scan"
description: "工作区扫描与检查方案调度：识别技术栈与目录，发现可用的 check scheme，执行 doctor/precheck/report/gate 并聚合结果；供 workspace 初始化、启动节点与各执行流共用。触发：进入工作区、初始化、重新扫描、检查方案发现、质量门禁聚合"
version: "v0.1"
---

# 工作区扫描与检查方案调度

本技能只做三件事：**看清工作区**、**发现检查方案**、**调度并聚合**。它不认识任何语言规则；JS、Java、Rust、Vue 的规则分别住在各自的检查技能里，工作区只通过 `check-scheme` 契约调用。

## 1. 三个命令族

| 命令 | 用途 | 是否写状态 |
|---|---|---|
| `scan` | 技术栈、目录、入口、包管理器、运行时、漂移判断 | `--write` 时写 `.workspace/scan.json` |
| `discover` / `enable` / `disable` / `status` | 发现已安装的检查方案，决定启用哪些 | `enable/disable` 写 `.workspace/checks.json` |
| `doctor` / `precheck` / `report` / `gate` / `calibrate` | 转发给启用的方案并聚合 | 只读 |

## 2. 工作区初始化（管理态）

首次接入或布局大改时，由 `workspace-manager` 执行：

1. `scan --write`：记录技术栈、目录、入口与布局哈希。
2. `discover`：列出适用的检查方案；人工确认启用哪些。
3. 逐个方案执行管理态：`init`、`tools install`、`baseline`、可选 `calibrate`。
4. 写 `checks.json`（启用列表）与各方案 `profile.json`/`baseline.json`，单独提交。
5. 汇报：启用方案、profile revision、工具版本、基线采集时间。

文档骨架与 git 检查属于 `workspace-init` 流程的一部分，但不要塞进检查方案：方案只管自己的规则与工具。

## 3. 进入工作区（执行态）

`workspace-start` 专家在每次 run 开始时执行：

1. `scan --check`：有 `drift` 时阻断，并指向 `WORKSPACE-01` 重新校准；不自动改 profile。
2. `doctor`：任一方案工具缺失或 profile 不可读，直接阻断，不进入开发/评审。
3. 通过后写 `intent.md`，进入正常流程。

评审节点只调用 `precheck --changed`；全量 `report` 给评审与 CI。

## 4. 聚合与退出码

- 每个方案返回 `check-report@1`；调度器把 `schemes[]` 与 `summary` 合并。
- 退出码取最大值：`2`（任一方案 ERROR）> `1`（任一 FAIL，或 gate 下 WARN）> `0`。
- 没有启用方案、方案命令缺失、方案崩溃，都按 `2` 处理，不当作通过。

## 5. 判断清单的拆分

- 本技能只定义语言无关的判断维度（`references/judgment-framework.md`）。
- 每个检查方案在自己的 `references/judgment-checklist.md` 里写该语言的判据与证据要求。
- 评审必须同时看机器报告与判断清单；缺判断清单的方案视为未完成。

## 6. 新增语言检查方案

只新增一个技能包：

1. 提供 `scripts/scheme.json`（manifest，见 `references/check-scheme.md`）。
2. 实现 `doctor/precheck/report/gate/calibrate`，输出 `check-report@1`。
3. 在 `appliesTo` 中写明适用文件与排除条件。
4. 不改 `workspace-scan` 的代码；`discover` 会自动发现。

## 7. 完成标准

- `scan.json` 与仓库事实一致；drift 可解释。
- `checks.json` 的启用列表与人工确认一致。
- 聚合报告保留每个方案的原始结果与退出码。
- 缺工具、缺 profile、方案崩溃都有明确的 `ERROR`，没有静默通过。
