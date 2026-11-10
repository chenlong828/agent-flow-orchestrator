---
layer: works
module: global
status: active
updated: 2026-11-10
---

# 评审：执行容错语义提议（调度器侧裁决）

> 对象：`agent-flow-client/docs/works/2026-11-10-execution-semantics-proposal/proposal.md`（219 行，2026-11-10）。
> 契约基线：`agent-flow-client/docs/design/contracts/executor-http-v1.md`（v1 frozen，`protocolVersion = 2026-11-07.1`）。
> 评审级：**P1**（改动执行语义与调度器派发职责）。裁决档位见 `arch-design-spec` 第 8 步。

## 1. 结论

**裁决：通过（方向接受，条件是补两类汇报字段）。**

提案最值钱的一件事，是把「重复执行」从数据事故降级成**成本问题**。这个重排与产品现实一致，我接受，并且它反过来解释了为什么 `SCH-19` 值得冻结：**调度器的工作是安排活儿，不是保证每个活儿只做一次。**

> 第二轮补正（2026-11-10）：上一版把「同一容器只有一个写入者」也升成了硬不变量，并按数据库隔离的思路要求写域/worktree/`.git` 保护。产品侧已裁决**不这么看**——skill 按模块拆分、撞车频率低、产物可重跑，调度器只要一个机械的放行接口即可。`SA-06` 撤回，`SA-04` 改为「放行槽位」，见 §7。

但提案 §6 的自述「契约主体不变，唯一可选加法是 `idleTimeoutMs`」**不成立**。按它自己的 §5.1.6 与 §7 矩阵，有两处语义没有载体，落到实现时会退化成「用别的字段硬凑」或「调度器根本收不到」：

| 编号 | 档位 | 一句话 | 不加会怎样 |
|---|---|---|---|
| `SA-01` | Blocker | 「实例因进程未回收而不可用」没有汇报载体；`claim` 是实例无关的，client 无法拒绝特定实例 | 调度器持续往一个卡死的实例派活，每次都白烧一个 `attemptId` |
| `SA-02` | Blocker | idle 与总超时在结果里不可区分：`CancelReason` 闭集只有 `prompt_timeout`，没有 idle 的取值 | 重试策略无法分流「节点太大」与「工具卡住」；两类都只能盲重试 |
| `SA-03` | Decision now | idle 默认 10 分钟会**系统性误杀**分析类任务：ACP 在长工具执行期间不发 `session/update` | 恰好在该类任务最常见的场景（长检索、长构建）上误杀，产生「杀了→重派→再杀」的循环 |
| `SA-04` | Decision now | fan-out 的并发需要调度器与 client 之间的「放行」接口：现在 `SCH-19` 与客户端实例锁都是独占语义，B 方案无处声明「这个实例能同时跑几个」 | 要么被迫串行，要么绕过锁直接并发（等于没有限流） |
| `SA-06` | 撤回 | 上一版把 `.git` 共享当成 Blocker；产品裁决按「放行」处理，不作数据隔离要求 | 见 §7.3 的 skill 约定（只读 git） |
| `SA-05` | Hold | 进程确认不死后「实例不可用」的解除条件未定义 | 「待清理」永不恢复，实例被永久摘除（随 `SA-01` 落地时一并定） |
| `SH-01`…`SH-04` | Hold | 见 §8 | — |

口径先对齐：**容器 = workspace = 容器根 = `workspacePath`**，同一个东西（architecture §2、`CMP-workspace` §2.1）；fan-out 的多个分支共享这一个容器。B 方案放开并发时，需要的不是写域声明，而是一个「这个实例能同时跑几个」的槽位数字，见 §7.2。

Q1–Q8 的逐条答复见 §3。其中 Q1、Q6、Q7 直接采纳；Q2、Q3 采纳但补充调度器侧口径；Q4 采纳**并扩展**（不只 `idleTimeoutMs`）；Q5 采纳**但不成立**——需要先有 `SA-01` 的载体。

## 2. 判据：哪些该降级，哪些不能降

用户给的定性是对的，但「容错大」不等于「什么都不用管」。按风险重排（第二轮已修正写冲突的档位）：

| 问题 | 判定 | 依据 |
|---|---|---|
| 卡死无限占容量 | **真问题** | 一个 hung session 占住实例，后续节点排队；`SA-01`/`SA-02`/`SA-03` 都在这一条上 |
| 同一节点执行两次 | 成本 | 产物保留，agent 能识别痕迹；损失是 token 与时间 |
| 两个 session 写同一容器 | **低风险，不作机制化** | skill 按模块/调用链拆分，A 写 A、B 写 B；撞到同一文件时工具写前会重读；产物可重跑 |

因此：

- **该降级的**：exactly-once、崩溃自动续跑、DSH 内部死锁检测、以及（第二轮修正）**写冲突的强隔离**。
- **该守的**：有界终止（`timeoutMs` + idle）、调度器可见的「能不能接活」（`SA-01`）、产物保留（`keep`）。
- **可以更省的**：既然重复执行只是成本，调度器不必为「绝不重派」付复杂代价；`SCH-02` 的「等旧租约过期或旧 run 收口」是为了不并发写，而不是为了省一次执行——这一点仍值得写进 `SCH-02` 说明。
- **需要机械化的只有一件事**：并发放行。不问写什么，只问还能开几个槽（§7.2）。

## 3. Q1–Q8 答复

| ID | 答复 | 落点 |
|---|---|---|
| Q1 | **接受。** 执行语义定为：不承诺 exactly-once；同一节点允许顺序重试；同一实例的并发 attempt 数不超过 client 上报的槽位。这三句写进调度器的**重试策略文档**（不是契约主体），契约侧 `SCH-03` 不变，`SCH-19` 从「一个 attempt」放宽为「≤ 槽位数」。 | 调度器文档 + `SA-04` |
| Q2 | **接受，但调度器侧要补口径**：`timeout` 重派的次数上限与退避由调度器定；**「调度器误判重派被 client 拒绝」不计入该节点的尝试次数**（见 `SA-01`）。「重派 prompt 里让 agent 先看工作区痕迹」属编排职责，赞成由编排加，不进契约。 | 调度器文档 + `SA-01` |
| Q3 | **接受。** `timeoutMs` 由调度器按节点类型下发，client 强制执行；建议分析类节点 30–60min。这条已经是契约现状（`C-03.timeoutMs`），无需改。 | 契约现状 |
| Q4 | **接受，但要扩成两项**：`idleTimeoutMs`（调度器按节点下发，缺省 = 关闭而非 10min，见 `SA-03`）+ `reason` 增 `idle_timeout`（见 `SA-02`）。`lastEventAt` 也建议接受——对「安排活儿」它比阈值本身更有用。 | 契约加法（`2026-11-07.2`） |
| Q5 | **接受，但提案给的路径走不通**：client 无法「报告实例不可用」（无字段），也无法「拒绝派发」（`claim` 只带容量）。必须先加 `unavailableInstances[]`，见 `SA-01`。加了这个字段后，调度器把该实例移出派发集并转待清理，答复即为「是」。 | 契约加法 + 调度器行为 |
| Q6 | **确认。** 默认 `keep`，分析产物必须保留。`cleanupPending` 的 `cleanup` 已经是 `keep` 默认，与提案一致，无需改。 | 契约现状 |
| Q7 | **不额外加更短硬上限。** 有 `timeoutMs` 兜底就够了；再加一层「服务端主动 cancel」会让两个终止源互相竞争，反而更难排查。 | 调度器文档 |
| Q8 | **B 另立 P1，前提是放行槽位而不是写域。** 修正上一版：不需要仓库级/目录级写域声明，也不需要 worktree 预置。B 需要的是 §7.2 的三处加法（`maxConcurrentPerInstance` / `availableSlots` / `SCH-19` 改写）。 | 后续工序（见 §7.2） |

## 4. `SA-01`（Blocker）「实例不可用」没有汇报载体

**证据**

- 契约 §5.3 的 `claim` 请求体只有 `capacity: { availableInstances }`（contract §5.3），**不带实例**。派哪个实例完全由调度器决定。
- 契约 §5.2 的心跳 `state` 只有 `pausedInstances` 与 `activeAttempts[]`（contract §5.2）。`pausedInstances` 的语义在 §5.2 明确是「暂停由控制事件驱动、权威在调度器，这里只用于观测」，复用它表达「客户端本地不可用」会污染语义。
- 提案 §5.1.6 写「若 client 报告实例因进程未回收而不可用，调度器应把该实例视为待清理，不再派发」——但全文没有给出汇报字段。§7 矩阵最后一行「调度器误判重派同实例 → client 锁 → 拒绝执行，报 `failed(workspace)`」是唯一的现存手段。

**分两种情形，只有一个真缺载体**

1. **实例正忙**（旧 attempt 还在跑，调度器误判重派）：**不缺载体**。心跳的 `state.activeAttempts[].instanceId` 已经告诉调度器「这个实例有活跃 attempt」，调度器据此不派即可。客户端锁是兜底，不该依赖它。
2. **进程杀不死**（SIGKILL 后仍在 D 状态等，提案 §3.3 末段、§7 第 5 行）：**缺载体**。此时 attempt 已 `settled`，`activeAttempts` 里没有它；实例既不是 `paused` 也不在 `assignments` 的变化里。调度器没有任何途径知道该实例不该再派。

**不加的后果**：调度器持续派发 → client 领到 → 取锁失败 → 报 `failed(workspace)` → 调度器记一次节点失败 → 按 Q2 重试 → 再派 → 再失败。每次循环消耗一个 `attemptId`、抬高 `attemptNo`、污染失败率统计，直到有人重启 client。这与「调度器重点是安排活儿」直接冲突：它在为一个不可用的执行单元持续做功。

**修法（加法字段，最小）**

心跳 `state` 增一个可选数组，语义与 `pausedInstances` 明确区分：

```json
"unavailableInstances": [
  { "instanceId": "<uuid-v7>", "reason": "process_unreclaimed", "since": "2026-11-10T02:00:00Z" }
]
```

- 只由 client 写，调度器只读；调度器把该实例移出派发集，并纳入「待清理」（沿用 `cleanupPending` 的机制即可，不必新增状态机）。
- 解除条件见 `SA-05`：client 重启后重新探活（替身进程存活检查）或成功回收进程组后，该实例从数组消失；数组里没有的实例即视为可用。
- 同时建议在 `claim` 的**响应侧**不需要变更——调度器自己维护派发集即可。

## 5. `SA-02`（Blocker）idle 与总超时在结果里不可区分

**证据**：契约 §6.5 的 `CancelReason` 是闭集（`contract` §6.5，行 770–772）：`user_cancel` / `paused` / `shutdown` / `lease_expired` / `superseded` / `signal` / `prompt_timeout`；`timeout` 状态固定映射 `prompt_timeout`（§6.5 表）。提案 §3.1 的 idle 触发后「结果 `timeout`」，于是两类完全不同的失败在调度器侧长得一样：

- **总超时**：节点本身太大/太慢 → 重派大概率再超时，应升级（加 timeoutMs、换节点类型、或判节点失败）。
- **idle**：卡在某个工具/检索 → 重派大概率能过，应直接重试。

**不加的后果**：Q2 的「重试次数/退避」只能一刀切。按总超时的策略处理 idle，会在一个可恢复的工具卡死上反复失败；按 idle 的策略处理总超时，会无限重试一个永远做不完的节点。**这正是「调度器重点是安排活儿」最需要的分流信号，丢了它，调度器就只能盲派。**

**修法**：`CancelReason` 增 `idle_timeout`（加法枚举值，按契约 §12 的规则「新增值需双方发布」），`reason=idle_timeout` 时 `status` 仍为 `timeout`、`retryable` 仍为 `true`。旧调度器读到未知 `reason` 按现有规则保留原字符串（§12），不会崩。

## 6. `SA-03`（Decision now）idle 默认 10 分钟会误杀分析类任务

**证据**：提案 §3.2 说 idle 只在「连续 N 分钟没有 ACP `session/update`（文本/tool/usage）」时触发，认为误杀率低。但 ACP 的事件模型里，工具的可见性来自 `tool_call` / `tool_call_update`（client `CMP-runtime` §2.5），而多数 CLI 工具只在**开始**与**结束**各发一条，中间不上报进度。也就是说，一个执行 12 分钟的全仓库检索、长构建或大文件解析，在 ACP 层面就是**完全静默**——正好命中 10 分钟阈值。

这恰恰是分析类任务的典型形态：agent 的大部分时间花在「读大仓库、跑静态分析、等工具返回」上，而不是持续输出文本。用「有没有 ACP 事件」当心跳，等于用「有没有说话」判断人还在不在干活。

**修法（三选一或组合）**

1. **默认关闭**（`idleTimeoutMs` 缺省 0），由调度器按节点类型显式开启——推荐。谁下发 timeoutMs，谁就一并下发 idle 阈值，二者同源，不会出现「客户端擅自更短的上界」。
2. 若保留客户端缺省，**缺省值必须显著大于最长工具执行时间**（例如与 `timeoutMs` 同量级，而非固定在 10min），且不得小于 2×p99 工具时长。
3. 把判据从「无 ACP 事件」放宽为「无 ACP 事件 **且** 进程组无 CPU/IO 活动」，用进程级证据而不是协议级证据判断卡死。这样长工具不会被误判，真死锁（0 CPU、无 syscall）仍能被抓到。

无论哪种，结果都必须带 `SA-02` 的 `idle_timeout`，否则调度器无法把误杀与真超时分开。

## 7. 补正（2026-11-10）：并发按「放行」处理，不按数据库隔离处理

上一版把这个问题按数据库的并发控制来建模了——写域、worktree 隔离、`.git` 元数据保护。产品侧已裁决**不这么看**，我接受，理由成立：

- fan-out 的各个分支按 skill 描述**已经按模块/调用链拆分**，session A 写文档 A、session B 写文档 B，天然不重叠；
- 即使撞到同一文件，现在的 agent 工具在写之前会检测文件变动并重新读取，模型看到的是最新版本，不是盲写；
- 冲突频率低、影响小（分析产物可重跑，代价是 token），**不值得**为它引入写域声明、worktree 预置、git 元数据保护这类机制。

所以上一版的 `SA-06`（`.git` 共享）**降级为一次运维注记**，`SA-04` 改判为「只需一个机械的放行接口」。记录这次纠正，是因为它决定了 B 方案的设计输入。

### 7.1 结论修正

| 编号 | 上一版 | 改判 | 理由 |
|---|---|---|---|
| `SA-06` | Blocker | **撤回**（见 §7.3 注记） | 把分析产物的 last-write-wins 当成了数据损坏。产物可重跑，且工具写前会重读；`.git` 只在 agent 主动跑 git 写命令时才涉及，频率低且可恢复 |
| `SA-04` | Decision now（写域必须先定义） | **Decision now（只要放行接口）** | 不需要写域语义。调度器只需要知道「这个实例还能同时跑几个」，不需要知道跑的是什么、写哪里 |

### 7.2 `SA-04` 改后：机械的并发放行接口

设计目标：**调度器不理解写域，只做槽位计数**；契约里只多一个数字，不多一个语义。

**契约加法（3 处，全为可选字段）**

| 位置 | 字段 | 含义 |
|---|---|---|
| `register.capacity` | `maxConcurrentPerInstance`（integer ≥1，默认 1） | client 声明同一实例可同时跑几个 attempt。默认 1 = 现状 A 方案，缺省即旧行为 |
| `claim` 请求 `capacity` | `availableSlots`（integer ≥0） | 当前可用的总槽位数。旧服务端读 `availableInstances` 的语义不变 |
| `SCH-19` 改写 | — | 「同一 `instanceId` 同时活跃 attempt 数 ≤ client 上报的 `maxConcurrentPerInstance`；同一实例并发的 attempt 技能集 digest 必须一致（`SCH-05`）」 |

**调度器侧行为（机械，无新概念）**

1. 记每实例的在飞 attempt 数；`claim` 只在 `inFlight < maxConcurrentPerInstance` 时派发，不超卖（`SCH-16` 已有此要求，只是单位从「实例」换成「槽」）。
2. 槽位在 attempt 终态（`settled` 上报成功、`late_result`、租约过期）时释放。释放规则与现有租约生命周期一致，不需要新状态。
3. 不关心 attempt 写什么、写到哪；不做写域校验，也不下发分支路径。

**client 侧改动（把锁换成信号量）**

1. `store.lockInstance(instanceId)` 从「独占锁」改为「每实例计数信号量」：`acquireSlot(instanceId, limit)` 成功返回 lease 句柄，满则拒绝。
2. 槽位释放点不变（`closed`/`abandoned` 后）。进程未确认死亡时**不释放槽位**（沿用 `SA-01` 的处理），这是唯一需要比「计数」多一点逻辑的地方。
3. 撞车（调度器超卖或 race）：退化为一次无效派发 + 拒绝，与 `SH-02`/`SH-03` 同一收口。

**验收（替代上一版的门禁）**

- 同实例并发 2 个 attempt：两个 session 各自 skill digest 相同、互不阻塞、各自 settle；
- `maxConcurrentPerInstance=1` 时行为与现状完全一致（回归）；
- 槽位满时 `availableSlots=0`，调度器不派发，客户端不产生拒绝日志。

### 7.3 残留风险（不进契约，只作 skill 约定）

一条运维注记，不值得机制化，但值得写进 skill 编写规范：

- agent 在 session 里跑 `git add/commit/checkout/stash` 会改写共享的 `.git/index`；并发时 gh 可能互相看到对方的暂存内容。建议分析类 skill **只读 git**（`log/diff/show`），需要写就显式说明。
- 崩溃时残留的 `.git/index.lock` 会让同容器其他 session 的 git 命令失败，直到手工删除。`doctor` 可以顺带检查这个文件并提示，不作为执行路径的依赖。
- 同一套 skill 的脚本若写固定相对路径，仍可能撞；这条靠 skill 作者按分支参数化输出路径，与调度器无关。

另外仍建议你们内部对一下文档矛盾（与并发无关，是历史遗留）：`boundary-design` §4.1/§4.3/§4.7 写「fan-out 子任务**各自工作区**、各自进程（clone / worktree）」，client `architecture.md` §2 与 `CMP-workspace` §6 写「fan-out 分支**共享同一容器**」。以现在共享的版本为准的话，上游那份需要标注已被取代。

## 8. Hold

| 编号 | 项 | 为什么不阻塞 | 后续 |
|---|---|---|---|
| `SA-05` | 进程确认不死后「实例不可用」的解除条件未定义。journal 只有 attempt 级记录，没有实例级的 unavailable 记录，重启后 client 也无从判断上次是否留了活进程。 | `SA-01` 的字段先落地才谈得上解除条件；S1 阶段重启本身就会清孤儿 | 定：client 启动时 `listOrphans` + 探活 → 已死则清除该实例的不可用标记；仍活则保持。这样「待清理」有自愈路径 |
| `SH-01` | 提案 §4.2 的缺口表与代码现状一致（我核过：`gateway.renew` 有实现但 CLI 循环无调用点；`runAttempt` 只做 `store.lockInstance` 不做进程探活）。缺口判断成立。 | 属 client 内部实现排期 | 按提案 §10 的顺序做；建议把「续租未接线」的**风险表述**改准确——见下 |
| `SH-02` | 提案 §4.2 把续租缺口说成「调度器可能误判并重派，造成并发重叠」。实际不会重叠：`runAttempt` 取实例锁失败即拒绝执行（证据：`serve-loops.ts` `lockInstance` → 失败 `rejectAttempt(..., "workspace")`）。真正的损失是每次误判白烧一个 attempt。 | 只是表述，不影响做法 | 改成「会造成一次无效派发与一次伪失败」，与 §7 矩阵最后一行一致 |
| `SH-03` | 提案 §7 最后一行「client 锁 → 拒绝执行，报 `failed(workspace)`」：`failed` 会让调度器把它算节点失败。既然只是「这活儿本来就该我拒绝」，更贴切的收口是 `cancelled(superseded)`，让调度器不把它计进失败率。另核实现状：`serve-events.ts` 里这条路径的错误是 `code=locked, class=runtime`（不是 `workspace`），而 `locked` 不在 `CMP-result` §2.2 的映射表里——口径本身也需要统一。 | 属结果语义细节，两者都能跑通 | 若采纳 `SA-01`，这条路径会大幅减少，优先级下降；仍建议改成 `cancelled(superseded)` 并把 `locked` 补进映射表 |
| `SH-04` | `lastEventAt`（Q4 的第二项）比 idle 阈值本身更有价值：调度器能据此判断「在动」还是「不动」，也可以据此做派发排序。 | 加法字段，不影响主体 | 建议一并接受；与 `SA-02` 的 `idle_timeout` 同时进 `2026-11-07.2` |

## 9. 验收：本稿建议补进 §8.4 的门禁

提案 §8.4 的五条验收都对，补两条与本次裁决直接对应的：

1. **卡死实例不再被派活**：注入「进程杀不死」→ client 心跳带 `unavailableInstances` → 调度器 30s 内不再为该实例派发，且不产生新的 `attemptId`。
2. **idle 与总超时可区分**：两种触发分别产出 `reason=idle_timeout` 与 `reason=prompt_timeout`，调度器按不同策略处理且都能解释。
3. **并发放行是纯计数**：`maxConcurrentPerInstance=1` 时行为与现状逐位一致；设为 2 时同实例两个 attempt 并行且各自 settle；槽位满时 `availableSlots=0`、调度器不派发、客户端不产生拒绝日志。

## 10. 下一步

1. 契约加法（四项，全为可选）：`NodeRequest.idleTimeoutMs`、`CancelReason.idle_timeout`、心跳 `state.unavailableInstances[]`、`activeAttempts[].lastEventAt`；按 §12 规则升 `protocolVersion` 末位为 `2026-11-07.2`，双方发布。
2. B 方案的放行加法（§7.2）：`register.capacity.maxConcurrentPerInstance`、`claim.capacity.availableSlots`、`SCH-19` 改写。这三项属 B，不与上一条同批发布。
3. 调度器文档（不改契约）：Q1 的执行语义、Q2 的「被拒绝不计入尝试次数」口径、Q7 的「不加更短硬上限」。
4. `SA-05` 与 `SA-03` 的默认值一起定；`SA-06` 只留 §7.3 的 skill 约定（只读 git），不进契约。
4. 上述落定后，B 方案（fan-out 并发）另立 P1，本提议的 Q8 作为其输入。
