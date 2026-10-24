---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# `agent-flow-ui` 界面与数据契约分析

> 本文是全量界面分析，覆盖 12 个页面；**B1 只取 Harness、工具、Skill、专家四类资产**。Key/工作区/工作流/实例/看板的段落仅作背景，不进入 B1 设计，也不作为 B1 的范围依据。
> 本文只回答「UI 现在有什么、数据长什么样、哪些能纯 DB 承接」。实现提议见 [`proposal.md`](proposal.md)。
> 依据：`~/harness/agent-flow-ui` 的 12 个页面、11 个 `CMP-*`、`assets/js/mock-data.js`、`assets/js/pages/*.js`、`docs/design/components/*/spec.md`；集合数量以 2026-10-24 在 Bun 中实际加载夹具的结果为准。

## 1 结论先行

1. UI 是**展示驱动**的数据模型：实体字段里混有事实、派生统计、模拟运行时状态和展示文案，不能直接 1:1 映射为数据库列。
2. 12 个页面里，真正适合先做「纯数据库后端」的是**注册中心与流程定义**：Harness、工具、Skill、专家、Key、工作区、工作流。实例与看板依赖执行引擎或运行事实，首期不应伪造。
3. UI 的写操作集中在 9 个页面（实例页的控制操作只改模拟状态），其中 `workflows` 在原型里有两个页面写入口；接后端时必须按聚合重新划分唯一写入口。
4. 夹具中至少有 4 类可验证的契约漂移：`nodeCount/stageCount` 与图不一致、`usedBy/refCount` 与实际引用边不一致、`lastRun` 指向不存在的实例、组件规格字段名与夹具字段名不一致。这决定了后端 schema 必须以**规范化、可派生**为准，而不是照抄 `MOCK`。

## 2 页面与操作矩阵

| 页面 / 组件 | 读取 | 纯 DB 可承接的写 | 依赖运行时或外部系统 |
|---|---|---|---|
| 工作流列表 `CMP-workflow-list` | 工作流列表、类型统计、最近运行、节点/阶段数 | 新建（含从模板复制）、复制、重命名、删除、导出 DSL | 发起运行（创建实例后由引擎推进） |
| 工作流编辑器 `CMP-workflow-editor` | 图、节点/边/阶段、DSL | 增删改节点/边/阶段、批量保存草稿、发布并升版、改名 | 发起运行 |
| 运行实例 `CMP-instances` | 实例列表、轨迹、节点 I/O、日志、fan-out 聚合、评审/确认记录 | 最多只能创建一条排队实例记录；列表/详情可读 | 暂停/恢复/终止、节点重试、从节点重跑、批准/驳回、状态推进、日志与产物写入 |
| Skill 库 `CMP-skills` | 列表、详情、引用方、版本历史（规格有、夹具无数据） | 新建、编辑五区、启停、删除（被引用时禁删）；保存时升版 | —（当前没有独立的历史数据；需要时再由保存动作生成） |
| 专家管理 `CMP-experts` | 列表、五区详情、Skill/工具组合、被引用数 | 新建、编辑、启停、删除、Skill/工具有序关联 | 无（被引用数可由工作流节点派生） |
| Harness 管理 `CMP-harnesses` | 列表、详情、能力标签、配额、当前任务、心跳记录 | 注册、编辑、启停、删除 | 连接测试、心跳、健康判定、当前任务数、配额占用 |
| 工具与集成 `CMP-tools` | 注册表、参数、引用方、最近调试 | 注册、编辑、删除、参数增删 | 调试执行、最近调试结果、可用/不可用状态、所属 Harness 的实际承载 |
| 效能看板 `CMP-analytics` | KPI、趋势、阶段准出、评审记录、Skill 审计 | 无写操作；实例/评审事实齐备后可做只读聚合 | 指标计算所需的运行事实（实例、评审、子任务） |
| 工作区 `CMP-workspaces` | 列表、详情、目录模板、凭证、归档记录 | 新建（仓库/分支/凭证/模板）、编辑 Worktree 策略、删除、归档记录展示 | git 连通性校验、模板初始化、容量统计、清理执行、最后活动时间 |
| 个人 Key `CMP-keys` | 列表、掩码、绑定用途 | 新建（git 公钥 / LLM Key）、改名、绑定/解绑、删除；掩码与指纹由服务端生成 | Key 有效性校验、实际模型/仓库调用 |
| 全局外壳 `CMP-ui-shell` | 导航、用户区、字号、折叠 | 无（仅 localStorage 偏好） | 登录态与用户资料 |

补充：`instances` 的「发起运行」在原型里只是跳转与 Toast，没有落任何实例数据；`workflow-list` 与 `workflow-editor` 都能改 `MOCK.workflows`，是原型里唯一的双写入口。

## 3 实体、数量与关系

夹具规模（实际加载结果）：

| 实体 | 数量 | 说明 |
|---|---:|---|
| 专家 `experts` | 8 | 是否启用、五区内容、有序 Skill/工具组合 |
| Skill `skills` | 12 | 4 个类别；五个正文章节、踩坑、引用、版本号 |
| 工具 `tools` | 10 | MCP / CLI / 脚本；参数、所属 Harness、调试记录 |
| Harness `harnesses` | 5 | 容器 / 服务器 / 笔记本；标签、配额、健康、心跳 |
| Key `keys` | 4 | git ssh-key ×2、LLM API Key ×2；三组绑定 |
| 工作区 `workspaces` | 4 | 仓库、分支、Worktree 模板、凭证、归档 |
| 工作流 `workflows` | 6 | 图内共 44 个节点、48 条边、4 个阶段框 |
| 运行实例 `instances` | 8 | 覆盖运行中/等待人工/回退重跑/暂停/成功/失败/终止 |
| 看板 `analytics` | 1 | 8 周趋势、准出记录、Skill 审计 |

关系（按夹具实际引用）：

```
expert 1─N expert_skill N─1 skill          （23 条）
expert 1─N expert_tool  N─1 tool           （23 条）
tool   N─1 harness                          （10 个工具各自挂 1 个 Harness）
key    1─N bindings ──> workspace / harness / expert（三组多对多）
workspace N─0..1 key（credId 作为访问凭证，可为空）
workflow 1─N stage / node / edge（图嵌套在 workflow.graph）
node    N─1 expert；node N─N tool / skill（节点级工具权限、Skill 覆盖、fan-out 子任务 Skill）
node    N─1 node（评审回退目标、fan-out 清单来源）
instance N─1 workflow；instance N─1 workspace
instance 1─N node-run（夹具用对象键控节点，规格写成数组）
```

三个容易漏掉的引用：

- 评审节点的 `rollbackTo` 指向同一张图里的**前序节点**，是图内自引用，不是独立实体。
- fan-out 节点的 `sourceNode` 指向图内上游节点，`sourcePath` 是工作区产物路径。
- 专家的 `refs[].path` 可以指向 `workspace:/...`，这是运行期注入路径，不是工作区外键。

## 4 字段契约与偏差

以下偏差不是笔误，而是「原型先跑通、规格后补」留下的多源事实。接后端前必须选一个权威版本。

| 对象 | 规格写法 | 夹具实际 | 影响 |
|---|---|---|---|
| 专家 | `workContent`、`references[]`、`usedByCount` | `duty`、`skillOrder`、`verifyOrder`、`notes`、`refs[]`，无 `usedByCount` | 详情五区的字段边界不清；引用数需派生 |
| 工作区 | `repoUrl`、`template`、`credentialId`、`usedByInstances`、`lastActivity` | `repo`、`branch`、`worktreeTemplate`、`autoClean`、`retainDays`、`credId`、`credStatus`、`usedBy`、`archives[]`、`lastActivityM` | 新建向导与详情页字段需要统一命名 |
| Harness | `concurrencyMax` | `max`、`running` | 配额字段命名不一致；运行数不是持久事实 |
| 工具 | `harnessId`、`timeout` | `harness`、`timeoutMs` | 外键字段名与单位需要统一 |
| Key | `lastCheckedAt` | `lastCheckedM`；git Key 的 `provider/model` 用 `'—'` | 空值语义混乱；应改为可空列 |
| 工作流 | `nodeCount`、`stageCount` 作为卡片字段 | 由 `graph` 可数，但 `w5` 写 5/图 4、`w6` 写 5/图 3 | 冗余统计与图不一致 |
| 工作流 | `lastRun` 指向实例 | `w6.lastRun.instId = INS-2024`，实例集合中不存在 | 冗余投影会漂移；应由实例反查 |
| 实例 | `nodes` 为数组 | `nodes` 为以节点 ID 为键的对象 | 落库应是一行一节点，不复制原型形状 |
| Skill | 规格有版本历史 | 夹具只有 `version` 字符串，无历史条目 | 首期不建历史表，避免为空需求造表 |
| 全局 | 状态是中文展示值 | `运行中`、`等待人工确认`、`可用` 等文案直接作为数据值，没有代码/标签分离 | 数据库应用稳定代码，中文只做展示标签 |

## 5 派生字段与「重复真相」证据

### 5.1 引用计数

夹具里 `refCount` / `usedBy` 是存下来的数字，与真实引用边不一致：

| 对象 | 存储值 | 实际引用（专家 + 工作流节点） |
|---|---:|---|
| `t-trace` | 5 | 3 + 2 |
| `t-meta` | 6 | 5 + 2 |
| `t-smell` | 2 | 1 + 0 |
| `sk-meta` | 6 | 2 + 1 |
| `sk-ab` | 6 | 2 + 1 |
| `sk-ldp` | 3 | 1 + 1 |

结论：引用计数必须由关系表实时聚合（或做成可重建投影），不能作为可独立写入的事实列。

### 5.2 图统计与最近运行

- `w5` 的 `nodeCount = 5`，图里只有 4 个节点；`w6` 的 `nodeCount = 5`，图里只有 3 个节点。`w1`–`w4` 一致，说明不是统一规则，而是手工维护的冗余。
- `w6.lastRun` 指向 `INS-2024`，但 `MOCK.instances` 只有 8 条，不含 `INS-2024`。最近运行应由实例表按 `workflow_id` 取最新，而不是写在工作流行上。

### 5.3 模拟运行时字段

- `harness.health` / `heartbeatM` / `running`：由夹具生成，注册弹窗直接写「在线」，没有真实心跳。
- `tool.status` / `lastDebugM` / `runs`：调试结果模拟；新建后本应「未验证」，只有真实调试成功才会变「可用」。
- `workspace.status` / `size` / `lastActivityM` / `credStatus`：依赖 git 校验、目录初始化与磁盘统计。
- `instance.durationS` / `progress` / `nodes[].durS`：运行事实，或可由节点记录推导。
- `key.status` / `lastCheckedM`：依赖真实调用或人工校验。
- `harness._disabled`（页面内停用标记）、`wl-view` / `df-font`（localStorage）是 UI 状态，不进数据库。
- Skill 保存时 `bumpVersion`、工作流发布时 minor+1 是页面里的业务规则；后端应作为服务端规则实现，不能只靠前端。

结论：首期后端只承接**注册信息与定义**；这些状态字段要么不建、要么只由未来的运行时/外部适配器写，不能由 CRUD 接口随意改。

## 6 纯数据库边界

| 能力 | 纯 DB？ | 说明 | 首期处理 |
|---|---|---|---|
| 资产注册信息 CRUD（Harness/工具/Skill/专家） | 是 | 名称、描述、能力标签、配置、关联、排序 | 做 |
| 启停（enabled） | 是 | 状态位与引用提示 | 做 |
| 关联与排序（专家↔Skill/工具、Key 绑定） | 是 | 多对多 + 顺序 | 做 |
| 引用计数与删除保护 | 是 | 由关系表聚合；删除前检查引用 | 做 |
| 流程定义的增删改、草稿、发布、升版、复制、DSL 导出 | 是 | 纯结构化数据与校验规则 | 做（独立批次） |
| 工作区/Key 的注册信息 | 是 | 仓库地址、分支、Worktree 策略、绑定、掩码 | 做（独立批次） |
| 连接测试、Key 校验、工具调试 | 否 | 需要 git / 模型供应商 / 工具进程 | 不做；接口不伪造成功 |
| Harness 心跳、健康、当前任务数 | 否 | 需要执行器上报 | 不做；首期状态为 `unknown` |
| 工作区初始化、容量、清理、最后活动 | 否 | 需要 git 与文件系统操作 | 不做；状态为 `uninitialized` |
| 实例状态推进、控制、评审/确认、fan-out | 否 | 属于执行引擎与状态机 | 不做；等 M2/执行设计 |
| 看板聚合 | 依赖事实 | 实例/评审事实齐备后是纯 SQL 只读 | 首期不做；不造假数据 |
| 登录/鉴权/用户体系 | 否 | 需要身份源 | 不做；仅本机开发 |

## 7 首批候选与结论

按依赖与风险排序，候选是：

1. **B1 资产注册中心**：Harness、工具、Skill、专家（含关联、启停（Harness/Skill/专家）、引用保护）。理由：工作流节点要绑定专家/工具/Skill，流程定义依赖它；四类数据都在 UI 中高频读取；不需要外部系统就能形成完整闭环。
2. **B2 凭据与工作区**：Key、工作区（含绑定与 Worktree 策略）。理由：依赖 B1 的专家/Harness 作为绑定目标；Key 涉及密钥安全，单独成批便于评审。
3. **B3 流程定义**：工作流、阶段、节点、边、草稿/发布/版本、复制、DSL 导出。理由：依赖 B1 的专家/工具/Skill 外键；图模型是本项目最核心的持久化结构，值得单独设计与验收。
4. **B4 运行实例与看板**：建议**不做**，至少等执行模型和状态机设计确定后再做；只做读侧或排队记录会制造「看起来能跑」的假象。

因此首期建议只做 **B1**；若用户希望一次多推一批，建议 B1 + B2，B3 单独排。
