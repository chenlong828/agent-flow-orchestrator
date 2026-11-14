---
name: "doc-layout-spec"
description: "要新建或改动文档树内的任何文件（总体需求、项目规格、场景、本次任务的 brief/result、归档件）之前，用它定位归属与状态；也为新项目接入工作区、核对既有文档树、决定归档去向时用。需求怎么拆归 req-scenario-spec，文档内容怎么写不归它管。"
version: "v3.2"
---

# 文档布局：工作区、项目、任务三层

文档腐化的根源通常不是写得差，而是没有结构：跨项目真相、项目内真相、本次任务的过程产物堆在同一层，靠记忆和索引表维持秩序——索引先分叉，然后一切跟着腐化。本规范**既是放置规则**（一份新文档该去哪），**也是识别规则**（一棵既有文档树如何归类）：符合规范的文档树，凭路径与 frontmatter 即可推导每份文档的状态与对象，不依赖登记表。

产物怎么产出遵循各自的 skill：需求、场景与任务拆分归 req-scenario-spec，架构规格归 arch-design-spec，组件设计归 design-before-coding，执行与验收归 dev-execution-spec；本规范只决定这些产物的存放位置与生命周期。

## 三层结构

```
<workspace>/
├── doc/                       # 跨项目真相（总体需求、跨项目设计、排期、历史）
│   ├── requirements/
│   ├── plan/                  # 唯一的排期来源
│   ├── design/
│   └── history/
│
├── task-spaces/<YYYYMMDD-HHmmss>/   # 本次任务的过程产物
│   ├── intent.md
│   ├── brief.md
│   ├── result.md
│   └── …                      # 草稿、评审记录、中间产物
│
└── <project>/                 # 一个或多个实际项目，每个项目自带 doc/
    ├── doc/
    │   ├── requirements/
    │   ├── design/
    │   └── history/
    └── …                      # 代码
```

## 判定规则：三问

1. **下一次工作还要读吗？** 不需要 → `task-spaces/<本次任务>/`。过程稿、评审记录、`intent.md`/`brief.md`/`result.md` 都在这里，运行结束随归档冻结。
2. **它描述的是单个项目内部的实现与验收吗？** 是 → `<project>/doc/`。组件规格、项目内需求、场景、项目决策。
3. **它描述多个项目如何协作，或整个产品的总体需求吗？** 是 → 根 `doc/`。总体需求、集成契约、跨项目架构、统一排期与历史。

判据看**读者与对象范围**，不看文件大小或作者。跨项目的文档引用项目文档时写路径，不复制正文。

## 根 `doc/`：跨项目四态

| 目录 | 状态 | 只回答的问题 | 纪律 |
|---|---|---|---|
| `doc/requirements/` | 需求 | 为什么做（多项目共同目标） | 一卡一文件，编号稳定 |
| `doc/plan/` | 调度 | 接下来做什么 | 唯一排期来源，三份固定文档 |
| `doc/design/` | 现行真相 | 系统（多项目）现在是什么 | 唯一权威，只写跨项目内容 |
| `doc/history/` | 记忆 | 怎么走到这里的 | 冻结只读 |

- **排期只在这里**：`roadmap.md`、`risks.md`、`open-questions.md`；项目 `doc/` 不放 roadmap，避免两份排期对不上。
- 跨项目设计只放多项目共同遵守的部分（集成契约、总体架构、共享数据所有权）；单项目内部规格下沉到项目 `doc/`。
- 需求卡编号用 `WS-` 前缀：`WS-REQ-0001-<slug>.md`。

## 项目 `<project>/doc/`：项目三态

| 目录 | 状态 | 只回答的问题 |
|---|---|---|
| `<project>/doc/requirements/` | 需求 | 这个项目内部要做什么 |
| `<project>/doc/design/` | 现行真相 | 这个项目现在是什么 |
| `<project>/doc/history/` | 记忆 | 这个项目的决策与废弃对象 |

- **沿用项目既有编号**（项目内连续、不重编）；跨项目引用一律带路径。根 `doc/` 用 `WS-` 前缀（`WS-REQ-0001-<slug>.md`），与项目编号区分开。
- `design/` 沿用四类：`architecture.md`、`components/<id>/spec.md`、`scenarios/<domain>/<flow>/<scenario>/scenario.md`、生成物 `_index.md`。
- 不放 `plan/`：排期统一在根 `doc/plan/`。
- 项目文档与代码同仓，改代码时同步改文档。

## `task-spaces/`：本次任务

目录名由编排在启动时生成：`YYYYMMDD-HHmmss`（本地时间，冲突追加 `-2`）。**一次运行一个目录**，所有节点共用；节点不得新建、改名或删除。

```
task-spaces/20261113-101922/
├── intent.md      # 启动诉求原文（start 节点写入，之后只读）
├── brief.md       # 本次任务范围 + 涉及项目清单
├── result.md      # 产物清单 + 结论 + 未完成项去向
└── …              # 草稿、评审记录、中间产物
```

- `brief.md` 必须列出**本次涉及哪些项目**（如 `uumail`、`i2xclient`），后续文档按此归属到对应项目 `doc/`。
- 跨项目或项目内真相**边做边写**进对应 `doc/`，不搞「最后统一迁移」：下一次工作只读 `doc/`，留在 task-space 等于丢失；运行可能超时或取消，等收尾再搬会一起丢。
- `task-space` 里的同名文件只是过程记录，最终版以 `doc/` 为准；不要在两处维护同一份现行内容。
- 运行结束 → 编排打包归档（tar.gz 在编排侧），本地目录保留只读。
- 确需留档整次工作时，人工复制到根 `doc/history/works/<目录名>/`；不是默认动作。

## 项目怎么放进工作区

工作区的形态由用户决定，编排只把它当不透明路径；下面三种项目接入方式都支持，按团队习惯选一种：

| 方式 | 形态 | 适用 |
|---|---|---|
| **工作区内目录** | `<project>/` 是工作区内的真实目录，目录内自带 `.git` | 默认，最稳 |
| **符号链接** | `<project>` 指向工作区外的已有仓库 | 项目已在别处开发，不想搬 |
| **git 超项目** | 工作区根是 git 仓库，项目作为 submodule（`<project>/.git` 是 `gitdir: ../.git/modules/<name>` 指针文件） | 需要固定多项目版本组合、整体可回放 |

共同要求：

- 项目目录必须**可解析到真实仓库**；符号链接指向的目标要在 `brief.md` 里写清绝对路径。
- `.dsh/` 必须是工作区内的真实目录（不能是符号链接）。
- 无论哪种方式，**项目文档都由项目自己的 git 保管**；`task-spaces/` 归档只覆盖本次任务的过程产物，不包含项目文档。

符号链接方式的额外纪律：

- 实测 DSH 的 workspace-write 沙箱可以穿过符号链接写到工作区外，因此**链接目标就是节点的可写范围**；不要把链接指向家目录、仓库根或其他敏感位置。
- `git` 命令在链接目标内执行（例如 `git -C <project> status`），不要在工作区根执行。
- 运行结束核对 `git -C <project> status`，确认工作区根没有产生误改。

超项目方式的额外纪律：

- 节点**只在项目目录内**执行 `git add/commit/push`；不在工作区根提交——根提交会一次性牵动所有子模块指针。
- 新增项目用 `git submodule add <url> <name>`；需要更新子模块指针时，在 `brief.md` 或 `result.md` 里写明「从 `<old>` 到 `<new>`」，由人工确认后提交。
- 工作区根的 `.gitignore` 至少忽略 `.dsh/`、`task-spaces/`、`.agent-flow/`；`doc/` 纳入版本库（跨项目文档随超项目提交）。
- 子模块未初始化（目录为空）时不要直接开跑：先 `git submodule update --init`，否则节点会往空目录里写代码，提交后才发现不是同一个仓库。

## 状态表达：frontmatter

每份文档带 frontmatter：

```yaml
---
layer: design
module: drawer          # 所属领域/模块；global 表示跨模块
scope: project:uumail   # workspace | project:<name>
status: current
updated: 2026-11-14
---
```

状态值按对象固定：

| 对象 | 合法值 |
|---|---|
| requirements 卡 | draft / accepted / delivered / superseded / dropped |
| plan 文档 | draft / current |
| 组件规格 | planned / active / retired |
| 场景 | draft / designed / verified / deprecated |
| task-space 文档 | active / closed |
| history 文档 | frozen |

- `scope` 与路径必须一致：根 `doc/` 用 `workspace`，项目 `doc/` 用 `project:<name>`，task-space 用 `run`。
- 组件规格另带 `component: CMP-xxx`；场景另带 `flow:` 与 `scenario: SCN-xxxx`。
- 必写不省略，保证可直接检索盘点。

## 违规信号

- 需求卡里写了拆分方案或验收测试；场景文档复制了组件契约内容。
- 手改 `_index.md` 或其他生成物；同一事实需要同步改多份文档。
- 单项目内部规格写进根 `doc/design/`，或跨项目集成契约埋进某个项目 `doc/`。
- 本次任务的过程文件写进 `doc/`，或跨项目/项目真相只留在 task-space（等「最后再迁移」）。
- 项目 `doc/` 里出现 `plan/roadmap.md`（排期出现第二份）。
- 编号跨项目重复，或引用时不带路径。
- 符号链接指向家目录、仓库根等敏感位置，或 `brief.md` 未记录链接目标。
- 在超项目模式下于工作区根执行 `git commit`；或子模块未初始化就开跑。
- 项目内重新编号（已有 `REQ-0007` 却又新建 `UUM-REQ-0001`）。

## 与 req-scenario-spec 的边界

本规范不定义需求、场景、任务怎么拆；只定义它们的位置、frontmatter 与归档方式。发现「怎么拆」的规则进了本规范，移到 req-scenario-spec。
