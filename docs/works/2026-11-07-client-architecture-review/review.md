---
layer: works
module: global
status: active
updated: 2026-11-07
---

# 架构与组件规格评审：执行面客户端 v2026-11-07（调度器侧视角）

> 对象：`agent-flow-client/docs/design/architecture.md`（331 行，`status: current`）与 `docs/design/components/*/spec.md`（9 份，约 2.1k 行，均 `planned`）；字段权威 `docs/design/contracts/executor-http-v1.md`（v1 frozen）只作对照。
>
> 评审级：**P1**（组件切分、端口签名、数据所有权、分层依赖）。裁决档位见 `arch-design-spec` 第 8 步。
>
> 上文：本目录 [`review.md`](../2026-11-05-scheduler-contract-review/review.md)（契约三轮复核）。本文只评「设计自洽与可实现」，不重开已冻结字段。
>
> **复核（2026-11-07，第二轮）**：client 侧 `8e3c168` 已处置 `AB-01`–`AB-04`、`AD-01`–`AD-05` 与 6 条 Hold。四条 Blocker 全部按建议落地；端口裁剪引入 1 条新的 Blocker（`NB-01`：`HeartbeatOutcome` 丢了 `assignments`）与 2 条 Decision now、4 条 Hold，见 §6。裁决收窄为「**通过（条件：`NB-01` 一处补字段）**」。

## 1. 结论

**裁决（第二轮后）：通过，条件一处补字段。** 模块地图、分层方向、端口归属、状态机与冷热隔离这五件事都立得住，比 2026-11-04 那版明显收紧（端口签名收敛到 `CMP-executor` 单点、`claimRequestId` 进 gateway、`cleanupPending` 进合同）。首轮的 **4 条 Blocker 会让 S0 直接写不出来**，全部集中在「谁调谁、谁填什么」这一层——文档单看自洽，按消费方核对就不成立；这四条已在 `8e3c168` 修掉，`JournalPort`、技能冲突码、实例终结归属、`heartbeat` 入参四处现在都能对上。

> 首轮裁决为「有条件通过」；第二轮复核过程与结论见 §6。

| 编号 | 档位 | 一句话 | 证据 |
|---|---|---|---|
| `AB-01` | Blocker | `heartbeat(HeartbeatRequest)` 的入参横跨三个所有者：`ackSeq` 在 gateway、`activeAttempts[].phase/sessionId` 在 executor、容量在 CLI；而 CLI 只有 executor 的 3 个方法，拿不到前两者 | executor §3.4、gateway §2.1/§5、cli §3.2 |
| `AB-02` | Blocker | `JournalPort` 三处签名各不相同（架构 7 个方法 / executor 9 个 / store 7 个且缺 `pendingAll`/`listInstances`），而 CLI 恢复流程要用后两个 | architecture §4.2、executor §3.4、store §3.1、cli §2.4.5 |
| `AB-03` | Blocker | 同一违约条件两个 `code`：契约与 executor 写 `asset_skill_set_conflict`，assets/result/场景写 `skill_set_conflict`；`NodeResult.error.code` 是原值透传 | contract §5.4/§10、executor §2.4.6、assets §3.3、result §2.2 |
| `AB-04` | Blocker | 「实例结束/取消 → `shutdownInstance` + `cleanup`」在 executor 与 CLI 两处各写一遍；且 `cleanupPending` 对账被显式放在 CLI，越过 executor 的实例状态机 | executor §2.4.10、cli §2.4.10/§3.2、architecture §4.2 |
| `AD-01` | Decision now | `prompt_failed` 映射到 `runtime` / `protocol` 二选一未定，实现者要自己猜 | result §2.2 |
| `AD-02` | Decision now | `truncate` 的不变量「输出 ≤ maxBytes」与做法「先截断再追加 `\n…[truncated]`」矛盾，标记字节没预留 | result §2.3/§3.3 |
| `AD-03` | Decision now | `<stateRoot>` 有三个写者（store 的 journal/锁/孤儿、assets 的 `cache/`、observability 的 `logs/`），架构层没有分区声明 | architecture §7、assets §2.4、observability §2.1 |
| `AD-04` | Decision now | `lockInstance` 全设计无调用点；「同实例单写」由谁在哪一步取锁没写 | architecture §4.2、store §2.3、cli §2.4 |
| `AD-05` | Decision now | `DSH_HOME` 归属三说：架构 §7 说归 runtime，runtime §5 说「调用方创建」，CLI §2.3 只创建不删；实例结束删不删、谁删无定义 | architecture §7、runtime §5、cli §2.3 |
| `AH-01`…`AH-08` | Hold | 见 §4 | — |
| `AV-01`…`AV-08` | Verified sound | 见 §5 | — |
| `NB-01` | Blocker（复核新增） | 端口裁剪时把 `assignments`/`assignmentsVersion` 一起丢了：冻结契约 `HeartbeatResult` 带这两项，`HeartbeatOutcome` 没有 | contract §6.6、executor §3.4 |
| `ND2-01`、`ND2-02` | Decision now（复核新增） | `locked` 落不到 `CMP-result` 的来源表；`shutdown` 事件路径的 `pending` 来源未写 | result §2.2、cli §2.4.9 |
| `ND2-03`…`ND2-06` | Hold（复核新增） | 对账去重状态归属、`CleanupReconciler` 未进内部骨架、`snapshotAttempts` 与容量计数口径、契约 `N2-01` 未闭合 | §6 |

## 2. Blocker

### `AB-01` `heartbeat` 的入参，CLI 组装不出来

`SchedulerPort.heartbeat(request: HeartbeatRequest)`（executor §3.4）要求调用方传入完整请求，而 `HeartbeatRequest` 含三块不同所有者的数据：

- `ackSeq`：gateway 的 `ControlSeq` 持有并写（gateway §2.1、§5「控制事件 `seq`/`ackSeq` → 写入口 `CMP-gateway`」）；契约 §5.2 序号 3 也规定「下一跳心跳带累计 `ackSeq`」是 gateway 的职责。
- `state.activeAttempts[]`（含 `phase`、`sessionId`）：executor 的 `AttemptRegistry`/`AttemptRunner` 持有；executor §5 数据所有权明确写「尝试状态（内存）｜写入口 `CMP-executor`｜**读方 `CMP-cli`**」。
- `capacity`：CLI 自己的。

问题是读方声明了、读的口子没有：`CMP-cli` §3.2 只允许调 `executeNode` / `cancelInstance` / `recover`，`CMP-executor` §2.1 也没有查询方法。于是 CLI 既拿不到 `ackSeq`（gateway 没有 getter），也拿不到 `phase`/`sessionId`（executor 没有快照方法）。这不是「实现时再说」的问题——端口签名已 P1 冻结，补方法就是契约变更。

**修法（二选一）**

1. 把入参按所有者拆开：`heartbeat(state: ClientState, acks?: CleanupAck[]) → HeartbeatResult`，`ackSeq` 由 gateway 自己拼进 HTTP body；`ClientState` 由 CLI 从 `executor.snapshotState()` 取 `activeAttempts` 再补容量。
2. 保留 `HeartbeatRequest` 但新增 `CMP-executor#snapshotState(): ClientState` 与 `CMP-gateway#currentAckSeq()`；CLI 组装。

推荐 1：`ackSeq` 是传输层状态，出现在 L1 端口签名里本身就是层次泄漏（`arch-design-spec` 的「契约里只出现稳定概念」）。顺带把 `HeartbeatRequest`/`HeartbeatResult` 从 L1 端口的类型里去掉——它们本来就是 HTTP 请求体，不是领域值类型。

### `AB-02` `JournalPort` 有三份不同的签名

| 位置 | 方法数 | 集合差异 |
|---|---:|---|
| architecture §4.2 | 7 | 无 `pendingAll` / `listInstances` |
| executor §3.4 | 9 | 全量（含 `pendingAll` / `listInstances`） |
| store §3.1 | 7 | 缺 `pendingAll` / `listInstances` |

executor 规格自称「签名只在 `CMP-executor` 定义，L0 不另立」，结果架构摘要与 store 实现各抄了一份且不一致；而 `CMP-cli` §2.4.5 的恢复流程明确要用 `JournalPort.listInstances()` / `pendingAll()`（无 `assignments` 时枚举恢复对象）。按 store 规格实现，CLI 的恢复分支编译不过。

**修法**：store §3.1 改成「见 `CMP-executor` §3.4」并补上两个方法（或明确写「转发同一端口，不另立」）；architecture §4.2 的方法列改成引用，不再复制。这正是「一处一事」被违反的典型——同一份签名抄三处，必然漂移。

### `AB-03` 技能集冲突有两个 `code`

- 契约 §5.4、§10 失败矩阵、executor §2.4.6/§2.4.7：`asset_skill_set_conflict`。
- assets §2.5/§3.3、result §2.2 映射表、`SCN-0001` UC-25：`skill_set_conflict`。

`NodeResult.error.code` 在契约里是「组件稳定错误码，保留原值」——所以 assets 抛什么，调度器就收到什么。现在是两条链路各写一个名字：executor 自己判冲突时写 `asset_skill_set_conflict`，而 assets 规格把同类错误定为 `skill_set_conflict`；一旦按后者实现，调度器按契约收 `code` 会认不出来。

**修法**：以契约为准统一成 `asset_skill_set_conflict`，改 assets/result/场景三处；`CMP-result` 的映射表按新名收。

### `AB-04` 「实例关闭 + 清理」有两个主人，而且 CLI 越过了 executor

同一句语义出现在两份规格的同一个步骤号上：

- `CMP-executor` §2.4 第 10 步：「`runtime.closeSession` → `journal.mark(closed)`；**实例结束/取消时 `runtime.shutdownInstance` 与 `workspace.cleanup`**，成功后 `journal.clearOrphan(pid)`」。
- `CMP-cli` §2.4 第 10 步：「**实例结束/取消/关闭：`runtime.shutdownInstance` + `workspace.cleanup`**（按策略）」。

两者都是「真做」，不是描述同一件事的不同视角。叠加 CLI §3.2 的「`cleanupPending` 由 CLI 对账，不穿透 executor」，结果是：实例终结的副作用（取消活跃 attempt、关进程、清容器、写 journal 终态）被 CLI 与 executor 各持一半，而 CLI 拿到的是 `RuntimePort` / `WorkspacePort` —— 这是 executor 定义的领域端口，不是 `*Admin` 管理面。

architecture §4.2 的消费关系是明确的：`RuntimePort`/`WorkspacePort` 的消费方只有 executor，CLI 只有 `SchedulerPort` lease 组、`JournalPort`（pending/list/锁）与各 `*Admin`。CLI §2.4.10 直接调 `WorkspacePort.cleanup` 违反了这条已声明的边（以及 `arch-design-spec` 的「同层不相认、跨层只走门面」）。

**后果**：清理与 journal 终态由两方各写一半，`journal.clearOrphan` 的时机、`closed` 的写入点在两条路径上可能不同；`cleanupPending` 对账时若实例仍有活跃 attempt（旧 run 崩溃前后），CLI 没有 `AttemptRegistry`，无法判断该先 abort 还是先 cleanup。

**修法**：把实例终结与 `cleanupPending` 对账都收进 executor，新增一个用例方法（如 `reconcileCleanup(pending: CleanupPending[]): Promise<CleanupAck[]>`），CLI 只做搬运与回执；`CMP-cli` §2.4.10 与 §3.2 改成调 executor。这样 `WorkspacePort`/`RuntimePort` 的消费方仍是 executor 一家，`closed` 与 `clearOrphan` 的先后顺序也只有一处定义。

## 3. Decision now

| 编号 | 发现 | 修法 |
|---|---|---|
| `AD-01` | `CMP-result` §2.2 一行里写了 `protocol_error`、`prompt_failed` → `runtime` / `protocol`。一个错误码给两个类别，映射表就不是函数了；实现者只能二选一，而 `ErrorClass` 会进调度器的重试裁决。 | 拆成两行：`protocol_error` → `protocol`；`prompt_failed` → `runtime`（或反之，但要写明判据，比如「ACP 协议层错误 vs prompt 执行错误」）。 |
| `AD-02` | §2.3 说「超过上限：在边界处回退到完整码点，追加 `\n…[truncated]`」；§3.3 的不变量说「输出字节数不超过 `maxBytes`」。先截到 `maxBytes` 再追加 `\n…[truncated]`（15 字节），输出必超上限——而 `maxResultBytes` 是服务端 `413` 的判据，超一点就整条结果被拒。 | 预留标记字节：先按 `maxBytes - markerBytes` 截断再拼标记；或明确「标记不计入上限，由 `limits` 留 margin」。推荐前者，并加「刚好等于上限」的边界用例（验证计划已有该用例，但断言要写「含标记仍 ≤ 上限」）。 |
| `AD-03` | `<stateRoot>` 的写者有三个：`CMP-store`（journal/锁/孤儿）、`CMP-assets`（`cache/skills/`，assets §2.4）、`CMP-observability`（`logs/client.jsonl`，observability §2.1）。architecture §7 只登记了第一个，另两个没登记；「每份数据只有一个写入口」对 `<stateRoot>` 整体不成立。 | 在 architecture §7 加一行分区：`<stateRoot>/{journal.jsonl,locks/,orphans/}` → store；`<stateRoot>/cache/` → assets；`<stateRoot>/logs/` → observability；三者互不读写对方的子树，由 CLI 注入同一 `stateRoot`。 |
| `AD-04` | `lockInstance` 出现在 architecture §4.2/§4.4、store §2.3/§3.1、executor §3.4，但**没有任何流程步骤调用它**：CLI §2.4 的 11 步、executor §2.4 的 10 步都没有取锁点。没有调用点的端口等于没有不变量保障。 | 明确获取点与释放点。建议：CLI 在 `claim` 成功、`executeNode` 之前 `lockInstance`，`closed`/`abandoned` 后释放；失败即拒绝执行该实例并上报 `failed(workspace)`。或者承认它只是「双跑检测」，那就写明检测点与告警方式。 |
| `AD-05` | `DSH_HOME` 归属三说：architecture §7「DSH 进程 / session / `DSH_HOME`｜`CMP-runtime`」；runtime §5「`DSH_HOME`（实例）｜调用方创建；runtime 只使用/写 profile 补丁与空目录」；CLI §2.3 负责创建并校验（`0700`、不是 `~/.dsh`）。谁创建、谁删除都没定。 | 定为：CLI 创建（已在 §2.3）、runtime 独占写入、实例终结由 runtime 在 `shutdownInstance` 内删除（并在失败时记录，留给 `doctor` 报告）。改 architecture §7 与该行表述一致。 |

## 4. Hold

| 编号 | 项 | 为什么不阻塞 | 后续 |
|---|---|---|---|
| `AH-01` | `--concurrency <n>`（cli §2.1）与容量 `maxInstances` 两个容量来源 | S1 配置键未冻结（OQ-014），当前只有 `acp` 段 | M1 定 `capacity.maxInstances` 时把 flag 删掉或改成覆盖键 |
| `AH-02` | 默认 `stateRoot = <runDir>/.agent-flow-client`，而 `<runDir>` 是 `dirname(process.execPath)`；装到 `/usr/local/bin` 时状态写进系统目录（不可写） | 有 `state.root` 配置可覆盖；单机便携部署下正确 | S0 前定「便携模式 vs 平台数据目录（`~/.local/state`/`Application Support`）」的默认；`doctor` 报生效值 |
| `AH-03` | observability §2.1 的 `phase` 闭集是 `claimed…closed`，缺 `abandoned`（executor §3.5 的合法状态） | 只是日志字段枚举，不影响执行 | 补 `abandoned`，否则恢复日志的 phase 落不进闭集 |
| `AH-04` | architecture §6.5「取消是实例级整体终止：**所有活跃 session** 关闭」与 §6.11「同一容器的并发节点由调度器保证同一技能集」，在 `SCH-19`（同实例单活跃 attempt）下不可达 | 是 A 方案的必然结果，B 方案（S2）才需要 | 标成「S2 / B 方案下生效」，或删掉；否则实现者会去写多 session 取消逻辑 |
| `AH-05` | `AuthProvider` / `SchedulerEndpoint` 定义在 L1b 的 `ports.ts`（executor §3.5） | 解决了 assets 不 import gateway 的依赖边，是可用的折中 | 但这让 L1b 持有纯传输类型。建议 `ports.ts` 显式分区「领域端口 ｜ 跨 L0 共享值类型」；若共享类型继续增长，S1 抽一个 L0 小模块 |
| `AH-06` | `CMP-gateway` 与 `CMP-assets` 是两套 HTTP 栈（各自 `fetch`、超时、重试、TLS 配置） | 已确认的设计取舍（assets 自持下载） | S1 实现后核对两者对 `scheduler.url` 的 TLS/超时配置一致，避免「下载能连、上报不能连」的排查困难 |
| `AH-07` | 9 份组件的预算目标合计 ≈238k token（35+30+8+30+45+20+30+25+15），逼近单任务 250k 装载上限 | 单任务只碰 1–2 个组件，实际不会超 | 排任务时按组件切；跨组件任务（如「全链路取消」）必须先拆 |
| `AH-08` | 缺「能力所有权矩阵」与「场景 UC → 测试文件」映射；architecture §4.5 只到组件级，各 spec §7 只列验证类型 | 组件卡职责段已能互相印证，不是致命缺口 | S0 开工前补一张 UC → 测试目录的表，否则「验证计划」无法证明场景覆盖 |

## 5. Verified sound

| 编号 | 区域 | 怎么查的 | 结论 |
|---|---|---|---|
| `AV-01` | 分层与依赖方向 | 逐份读 9 个 spec 的「依赖与分层」段，对照 architecture §4.3 | L2→L1→端口←L0 方向一致；无循环；`CMP-result` 零依赖（纯函数）成立；除 `AB-04` 外没有发现 L0 横向调用 |
| `AV-02` | 扇出/扇入预算 | executor §4（6）、gateway 扇入 2、observability 扇入最大 | 与 architecture §4.3 的声明一致；热路径（租约循环）同步依赖 1，符合 ≤3 的目标 |
| `AV-03` | 状态机与恢复 | executor §2.2 表 + §2.7 + store §2.2 折叠规则 | `claimed→…→closed` 单向、`settled` 作为重试分界、`abandoned` 只从 `recover` 进入；「有结果重报、无结果标记」与 R-02 一致，崩溃点矩阵在验证计划里逐点覆盖 |
| `AV-04` | 技能安装原子性 | assets §2.1 流程 + §3.2 不变量 + workspace §5 | `staging → rename → .skills.previous` 回滚链完整；同 digest 短路；容器锁 + 进程内 Mutex 双层；`.dsh/skills` 单写入口在 assets，workspace 只提供路径——分工干净 |
| `AV-05` | 路径约束 | workspace §2.2/§2.4 | `realpath` + 按路径段（非字符串前缀）比较 + 不跟随越界符号链接；容器根即技能根且拒绝外层仓库，与 DSH 的 `projectRoot` 语义对齐（这条是 S0 实测过的，不是推测） |
| `AV-06` | 脱敏与凭据 | observability §2.2 + 各 spec 的「不进日志/结果/prompt」 | 键名匹配 + prompt/结果只记长度与 hash；`doctor` 只显示「已配置/未配置」；三处独立声明一致，没有一处放行原文 |
| `AV-07` | 冷热隔离 | architecture §4.6 四张路径卡 + cli §6 + executor §6 | 心跳与领取独立定时器、不与执行共享队列/锁；`append` 只做本地追加且仅 `settled` 一次 `fsync`；观测与日志明确「可丢不阻塞」——热路径失败语义与冷路径可重试分开写了 |
| `AV-08` | 契约与设计的分工 | architecture 开头声明的「字段权威在 contracts，本文不复述」 | 9 份 spec 都指向 `contracts/executor-http-v1.md`，没有复制字段表（`JournalPort` 除外，见 `AB-02`）；这是这版设计比上一版最大的改善 |

## 6. 第二轮复核（2026-11-07）：`8e3c168` 处置核对

复核方法：逐条对照 client 侧 `docs/works/2026-11-07-m1-contract-freeze/review.md` 的处置表与改后 `design/`，并用契约 `executor-http-v1.md` 的线格式逐字段反查端口类型是否够用。只看文档，未跑代码。

### 6.1 首轮四条 Blocker：全部关闭

| ID | 改后落点 | 复核结论 |
|---|---|---|
| `AB-01` | executor §3.4（`heartbeat(state: ClientState, acks?)` + `RegistrationOutcome`/`HeartbeatOutcome`/`ClientState`）、gateway §2.2、cli §2.4.6、contract §6.6 | **关闭（端口侧）**。`ackSeq`/`clientLease` 退回 gateway 是对的，`snapshotAttempts()` 把 `activeAttempts` 的来源也补上了。但裁剪过度，见 `NB-01`。 |
| `AB-02` | store §3.1（9 个方法，标注「实现视图，不另立契约」）、architecture §4.2（改为引用） | **关闭**。三处现在同源；`pendingAll`/`listInstances` 补齐，CLI 恢复分支可编译。 |
| `AB-03` | executor §3.4、assets §2.5/§3.3、result §2.2、scenario UC-25 | **关闭**。全仓已无裸 `skill_set_conflict`（`grep` 复核：0 处残留）。 |
| `AB-04` | executor §2.1（`reconcileCleanup`）+ §2.4.11（顺序只在 executor 定义一次）、cli §2.4.4/§2.4.10/§3.2、architecture §4.3/§9 | **关闭**。CLI 不再调 `RuntimePort`/`WorkspacePort`，依赖矩阵与 §4.2 的消费关系重新对齐；`CLT-13` 的实现点同步改成 `reconcileCleanup`。 |

### 6.2 五条 Decision now 与六条 Hold

| ID | 落点 | 复核结论 |
|---|---|---|
| `AD-01` | result §2.2 拆两行（`protocol_error`→`protocol`、`prompt_failed`→`runtime`） | 关闭，映射表恢复成函数。 |
| `AD-02` | result §2.3/§3.3/§7：预留 15 字节标记，含标记 ≤ `maxBytes` | 关闭，字节数核对过（`\n`1 + `…`3 + `[truncated]`11 = 15）；`maxBytes < 15` 的退化路径也写了。 |
| `AD-03` | architecture §7 分区（journal/locks/orphans → store；cache → assets；logs → observability） | 关闭，并补了「新增子树必须登记」的规则。 |
| `AD-04` | cli §2.4.8 + executor §3.4「取锁点」+ architecture §5 主流程第 1 步 | 关闭，三处一致（claim 成功后取、`closed`/`abandoned` 后放、失败报 `failed(workspace)`）。 |
| `AD-05` | architecture §7、runtime §2.6/§5、cli §2.3 | 关闭，四处同口径：CLI 建/校验、runtime 独占写、`shutdownInstance` 内删、失败留 `doctor`。 |
| `AH-01/03/04/05/06` | cli §2.1（删 `--concurrency`）、observability §2.1（补 `abandoned`）、architecture §6.5/§6.11（标 S2）、executor §3.5（`ports.ts` 两区）、gateway/assets（共用 `SchedulerEndpoint`） | 全部落地。 |
| `AH-02/07/08` | cli §9、architecture §4.7 | 正确延后（随 OQ-014 / S0 排期）。 |

### 6.3 复核新增

| 编号 | 档位 | 发现 | 修法 |
|---|---|---|---|
| `NB-01` | Blocker | **端口裁剪把 `assignments` 一起裁掉了。** 冻结契约的 `HeartbeatResult`（contract §6.6）有 `assignmentsVersion` + `assignments?`，§5.2 明确「版本不同时响应额外带 `assignments` 快照，client 以最新快照替换本地视图」；`HeartbeatRequest` 也要求上报 `assignmentsVersion`。新 `HeartbeatOutcome` 只有 `{serverTime, control, cleanupPending, nextPollAfterMs}`，`ClientState` 只有 `{capacity, pausedInstances, activeAttempts}`——收不进来、也报不上去。`clientLease` 是传输状态、裁掉对；`assignments` 是 CLI 的容器视图（cli §2.4.5 明确「无 `assignments` 时」才回落到 journal 枚举），不是传输状态。结果是运行期的快照更新路径断了，实现无法履行已冻结契约。 | 二选一并写清：① `HeartbeatOutcome` 补 `assignments?: Assignment[]`；`assignmentsVersion` 由 gateway 与 `ackSeq` 同样处理（截留、回传给服务端）；② 或把 `assignmentsVersion` 放进 `ClientState` 由 CLI 携带。推荐 ①，保持「快照与待办同源、同一条响应」。 |
| `ND2-01` | Decision now | **`locked` 落不进错误分类。** cli §2.4.8 规定取锁失败报 `failed(workspace)`，但 `CMP-result` §2.2 的映射表没有 store/journal 来源行；`locked` / `corrupt` / `io_error`（journal 侧）都会掉进兜底 `internal`。 | 加一行 store 来源：`locked` → `workspace`/false；`corrupt` → `internal`/false；journal `io_error` → `internal`/true（与 assets 的 `io_error` 同名不同源，要么改名要么注明「按来源区分」）。 |
| `ND2-02` | Decision now | **`shutdown` 事件路径的 `pending` 来源没写。** cli §2.4.9 写 `executor.reconcileCleanup([pending])`，但事件可能先于 `cleanupPending` 到达（契约 §5.1.5 要求此时也按 `releaseId` 幂等执行）。括号里的 `pending` 需要由事件字段合成：`{releaseId, instanceId, cleanup}`，`workspacePath` 缺失时按契约回落到 journal 按 `instanceId` 查。 | 补一句「由事件合成 `CleanupPending`（缺 `workspacePath`），executor 按契约 §5.1.5 回落查 journal」。 |
| `ND2-03` | Hold | `reconcileCleanup` 声明「按 `releaseId` 去重」，但去重状态存哪没说；executor §5 的数据所有权只有进程内的单飞去重表。 | 写一句「去重只是进程内优化；正确性依赖 `workspace.cleanup` 幂等与调度器按 `releaseId` 幂等，崩溃后重复执行可接受」。 |
| `ND2-04` | Hold | `CleanupReconciler` 没有进内部骨架：executor §2.8 与 architecture §4.4 的 executor 行仍是旧的 6 个单元，读者按「改一条规则进哪个组件」找不到对账逻辑。 | 两处各加一行。 |
| `ND2-05` | Hold | `snapshotAttempts()` 返回全部活跃 attempt，而 `ClientState.capacity.activeInstances/activeAttempts` 由 CLI 自算，两侧可能瞬时不一致。 | 明确「观测字段，允许瞬时偏差；判定以服务端为准」即可。 |
| `ND2-06` | Hold | 契约 `N2-01`（`CleanupAck.failed` 没有终止态、`retryable` 无规则）在冻结稿仍未闭合（contract §5.2 第 376 行）。`reconcileCleanup` 会忠实返回 `failed`，于是永久重发。 | 不阻塞 client 设计（是调度器侧行为），但请在 M1 冻结工序记 follow-up：`failed + retryable=false` 停止下发、转审计；否则 S0 联调会看到周期性重复清理与告警噪声。 |

### 6.4 第二轮结论

**通过。** 首轮四条 Blocker 全部关闭，修法都对到了语义层（`JournalPort` 同源、实例终结单点、错误码统一、端口按所有者裁剪）。`NB-01` 是裁剪时的一个具体遗漏，补一个字段即可；`ND2-01`/`ND2-02` 是十行内的补齐。补完这三处，本设计可以带进 S0，不再需要就该文档开新一轮评审。

## 7. 下一步

1. `NB-01` 补 `assignments`（+ `assignmentsVersion` 归属）、`ND2-01` 补 store 错误行、`ND2-02` 补事件合成 `CleanupPending`——三处都在 `design/` 内，改完本工序可收口。
2. `ND2-03`–`ND2-06` 进 S0/M1 的待办清单；`ND2-06` 同时记进调度器侧契约 follow-up。
3. 本评审不改变已冻结的调度器契约；`AB-03` 已按「实现向契约对齐」落地，未改契约。
4. `AH-02` 随 OQ-014；`AH-07`/`AH-08` 在排 S0 任务时处理。
