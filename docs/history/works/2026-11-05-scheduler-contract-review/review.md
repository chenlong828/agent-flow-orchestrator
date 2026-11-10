---
layer: history
module: global
status: frozen
updated: 2026-11-06
---

# 契约评审：执行面接口提案 v0.1 → v0.2（调度器侧视角）

> 对象：[`agent-flow-client/docs/works/2026-11-04-scheduler-contract-proposal/proposal.md`](../../../../../agent-flow-client/docs/history/works/2026-11-04-scheduler-contract-proposal/proposal.md)（v0.1 997 行 2026-11-04；v0.2 于 2026-11-05 修订）。
>
> 评审级：**P1**（契约冻结输入）。裁决档位定义见 `arch-design-spec` 第 8 步。
>
> 材料：提案全文 §1–§17；client 侧同工序 `review.md`（其逐条裁决）；本仓库 [`boundary-design.md`](../2026-11-03-client-boundary/boundary-design.md)；client 侧 `docs/design/architecture.md` §1/§4.3/§6/§9/§11、`CMP-gateway` §2–§3、`CMP-assets` §1、`CMP-observability` §8、`CMP-cli` §2.4（只读对照）；观测面提案 `docs/works/2026-11-06-observability-http/proposal.md`。
>
> **复核（2026-11-06）**：v0.2 已修订。四条 Blocker 全部关闭，五条 Decision now 与七条 Hold 全部按建议落地；复核新增 2 条 Decision now、4 条 Hold（§8）。裁决收窄为「**有条件通过（条件仅剩 2 条一句话级 Decision now）**」。新增的只读观测 HTTP P1 单列 §9。
>
> **复核（2026-11-07）**：v0.4（含 v0.3 的 `cleanupPending` 机制）已复核。`ND-01`–`ND-06` 全部关闭；新机制自身带来 2 条 Decision now、3 条 Hold（§8.5）。裁决为「**通过（条件：`N2-01`/`N2-02` 两句话落稿后冻结）**」，本轮之后不再新增条目。观测面 `OB-01` 的处置另见 §9.6。

## 1. 结论

**裁决（2026-11-07，三轮复核后）：通过。** 冻结条件是 `N2-01`、`N2-02` 各落两句（§8.5），它们都是机制内部的收口，不触碰契约骨架。骨架本身从头到尾没被推翻——三个身份、两条租约、7 个契约面、`SCH`/`CLT` 的切分是对的，`SCH-11`（按 `(clientId, attemptId)` 归属而不按 `runId`）是首轮就立住、三轮复核都没被推翻的一条，保住了崩溃后的结果重报。

> 首轮裁决为「有条件通过」，条件是四条 Blocker 改文档、五条 Decision now 拍板；v0.2 起逐轮关闭，过程见 §8。

| 编号 | 档位 | 一句话 | 提案位置 |
|---|---|---|---|
| `RB-01` | Blocker | `claim` 声明以 `attemptId` 幂等，但 `attemptId` 不是 `claim` 的入参；丢失响应后的重试会多租出一个 attempt | §2.1、§4.5 |
| `RB-02` | Blocker | 「被 fence」被当成可重派条件，但 fence 不停止旧进程；同实例多 attempt 并发没有写成调度器责任 | §7 `SCH-02`、§5.1.2、§5.6.5 |
| `RB-03` | Blocker | 控制事件的重放没有作用域：`ackSeq` 只在内存，重启后从 1 补发，旧 `cancel` 会杀掉同实例的新 attempt | §5.2.2–4、`CMP-gateway` §144 |
| `RB-04` | Blocker | `C-04` 把 `stale_attempt` / `lease_expired` 归成 `failed(scheduler)`，与 §5.6、§10 的 `cancelled(superseded/lease_expired)` 冲突 | §5.4 vs §5.6、§10 |
| `RD-01` | Decision now | `C-05` 绕过 gateway，但鉴权/TLS/跨 host 不带 token 的策略随之落在 `CMP-assets`：两套凭据来源、两处泄漏面 | §5.5、`CLT-11` |
| `RD-02` | Decision now | `claim` 与 `pause`/`shutdown` 的竞态无规则，且契约没有「退回 attempt」的操作，只有上报终态一条路——需要写死 | §5.3、§9.4 |
| `RD-03` | Decision now | `run_superseded` 退出码取 2（用法/配置）语义错位，属 CLI v1 冻结项 | §15 Q12 |
| `RD-04` | Decision now | `message` 在 `failed`/`timeout` 时恒为空串，丢掉失败现场，冻结后回填属改语义 | §6.2、§5.7 |
| `RD-05` | Decision now | `bindSession` 也返回 `lease`，租约出现两个来源 | §5.4 响应、§6.6 |
| `H-01`…`H-07` | Hold | 见 §4 | — |
| `VS-01`…`VS-07` | Verified sound | 见 §5 | — |
| `ND-01`、`ND-02` | 复核新增 Decision now | `shutdown` 清理意图随丢事件丢失；`SCH-19` 与 Q1 耦合未写明 | §8.3 |
| `ND-03`…`ND-06` | 复核新增 Hold | 同刻比较、`claimRequestId` 保留窗口、`AuthProvider` 定义位置、三处簿记 | §8.3 |
| `OB-01`…`OB-09` | 附评（独立对象） | 只读观测 HTTP P1：非 loopback 明文传 raw 一条 Blocker + 四 Decision + 四 Hold | §9 |
| `N2-01`、`N2-02` | 复核新增 Decision now | `cleanupPending` 的 `failed` 没有终止态；`assignments` 与 `cleanupPending` 的互斥未写 | §8.5 |
| `N2-03`…`N2-05` | 复核新增 Hold | 对账归属越过 executor；`cleanupPending` 无上限；claim 命中待清理实例的收口 | §8.5 |

对「client 起 HTTP」的结论：**不在 S1/M1 做，作为已评估备选登记**。它只改变 7 个操作里的半个（心跳的控制事件），却要求新监听、第二套鉴权方向、endpoint 生命周期与新的失败域；净收益为负。触发条件与最小形态见 §6。

---

## 2. Blocker

### `RB-01` `claim` 没有幂等键，重试会漏派 attempt

**证据**

- §2.1 表：`C-03` 的「幂等键」列写 `attemptId`。
- §4.5：「`claim` 重复提交：同一 attempt 不得同时租给两个 client/run；同一 client 的重复调用由 client 单飞去重」。

`attemptId` 是 `claim` 的**返回**值，请求里没有它，所以服务端无法把两次 `claim` 认成同一次。`attemptId` 不能当幂等键，这不是措辞问题，是键不存在。而「client 单飞去重」只覆盖同一时刻的并发调用，不覆盖 §4.5 自己承认的「请求未得到确定响应时重试」：请求到达、响应丢失、client 重试 → 服务端手上是两个不同 attempt 的租约。

**后果**

- 多出来的 attempt 白占一条租约 120s，到期后调度器还得重派；`attemptNo` 被虚增，审计里出现「领取但从未执行」的尝试。
- 若调度器把「已租出」算进容量或并发上限，短时间内的派发被这条影子租约挤掉。
- 每个丢包都触发一次，不是边缘个例。

**修法（冻结前）**

`claim` 请求体加 client 生成的 `claimRequestId`（UUIDv7），语义：同一 `(clientId, claimRequestId)` 在租约窗口内重复请求返回**同一个** attempt（不是新的一次），已过期则允许重新排队。§2.1 的幂等键列改为 `claimRequestId`，§4.5 补一条「claim 重试返回同一 attempt」。桩清单 §14.1 补一条「同 `claimRequestId` 重复 claim 只产生一个 attempt」。

### `RB-02` fence 不等于停止执行，`SCH-02` 据此允许重派会双跑同一容器

**证据**

- §7 `SCH-02`：「重派等旧租约过期**或被 fence**」。
- §5.1.2 / §5.2 语义 4 / §5.6.5：新 `runId` 生效后，旧 run 的 `heartbeat` / `renew` 返回 `409 run_superseded`，旧 run**收到之后**才去取消活跃 attempt。
- 篇幅：旧 run 感知 409 的最快路径是 `renew`（TTL/3，默认 40s）或心跳（≤30s + RTT）。

于是从 register 新 runId 到旧进程真正停下，有最长约 40s 的窗口。这段时间里「fence 完成」为真、「执行已停」为假。若调度器按 `SCH-02` 在 fence 后立刻重派，两个 DSH session 会在同一容器同一技能根上并行写——正好撞上 `SCH-01`、`CLT-04` 与 client `architecture.md` §6.11。

同一类问题还有第二条：`SCH-01` 只保证「一个实例同一时刻只绑定一个 client」，没有保证「一个实例同一时刻只有一个活跃 attempt」。client `architecture.md` §6.1 写的是「一个 client 实例同一时刻只执行一个尝试」，这句可以读成「按 client 进程」也可以读成「按工作流实例」，两种读法在 `maxInstances=4` 下行为相反——这正是需要一个 `SCH` 条目把它钉死的原因。而且它不是 client 能单方面守住的：派发权在服务端，client 拒绝一条 claim 只能靠上报终态。

**后果**：同一容器被两个进程写，产物与技能目录互相污染，而调度器认为新 attempt 成功。属于不可逆的数据损坏。

**修法（冻结前）**

1. 改 `SCH-02`：重派条件是「旧租约过期」**或**「旧 run 已上报该 attempt 的终态」；fence 只阻止旧 run **领取新活**，不构成重派许可。
2. 新增 `SCH-19`「同实例单活跃 attempt」：派发侧保证同一 `instanceId` 同一时刻只有一个未终结 attempt（Q1 选 A 时即「串行」）。这条不能写成 client 不变量。
3. §5.1.2 补一句：新 run 注册后，旧 run 的活跃 attempt 由旧 run 自行收口（`cancelled(superseded)`），调度器在收口或租约过期前不重派。

### `RB-03` 控制事件重放没有作用域，旧 `cancel` 会打到新 attempt

**证据**

- §5.2.2：「至少一次投递；client 重连后带 `ackSeq`，服务端从 `ackSeq + 1` 补发」——队列按 `clientId`，不按 `runId`。
- client `CMP-gateway` 规格 §144：`ackSeq` 存「内存；重连补发」。进程重启即归零。
- §9.3 的恢复步骤（清孤儿 → register → `recover` 重报 → 不自动重跑）没有提 `ackSeq`，`JournalPort` 也不保存它。
- §6.4 的 `ControlEvent` 已带 `issuedAt`，但全文没有定义 client 该拿它做什么。
- §5.2.4 的兜底是「已结算/已释放实例的事件：只 ack」——它假设 client 内存里还有那个实例；重启后的进程没有。

**后果**：`cancel(instanceId=X)` 在 T0 入队未 ack，client 崩溃重启，ackSeq 归零，服务端从 1 补发；client 在 T2 已为 X 领了新 attempt。这条 `cancel` 会命中 T2 的新 attempt，把它当成用户取消杀掉。`pause`/`shutdown` 同理（`shutdown` 还会触发清理）。同时全长补发在事件积累后是一次无意义洪峰。

**修法（冻结前，二选一或并用）**

- **作用域规则（推荐，便宜）**：`ControlEvent` 只作用于 `issuedAt` **之前**已开始的 attempt；对 `issuedAt` 之后领取的 attempt 与本地未知的实例，只 ack + 审计记 stale。有了这条，重放永远安全，不依赖持久化。
- **持久化 ackSeq**：`ackSeq` 落 `CMP-store`（`CMP-gateway` 规格 §144 由「内存」改为「持久」），重启后从持久值续；`(clientId, runId)` 变更时服务端丢弃旧 run 未 ack 的事件。

## 3. Decision now

### `RD-01` `C-05` 的鉴权与 URL 策略落在 `CMP-assets`，需要明确它是资产侧责任还是共享传输

`§5.5` 定 `C-05` 由 `CMP-assets` 直连、不经 `CMP-gateway`；client `CMP-assets` §1 也写了「调度器鉴权（下载鉴权走注入配置，不复用 gateway）」。这条在 client 内部已定，但契约把 `CLT-11`（只连 `scheduler.url` 与 manifest 授权地址、跨 host 不带 token）也压给了它，于是 token 的处理出现在两处：`CMP-gateway` 的 `AuthProvider` 与 assets 的注入配置。

**要定的是**：token 的单一来源在哪，以及 Q7 的轮换未来要不要同时改两处。选项：(a) 组合根注入同一个凭据读取器给 gateway 与 assets，策略下沉为 L0 共享值对象（`SchedulerEndpoint` / `AuthProvider`），不改 `CMP-assets` 的依赖边；(b) 由 `CMP-gateway` 提供 `downloadArtifact(url, etag)`，assets 经端口调用，需解掉 client `architecture.md` §4.3「`CMP-assets` 不得 import gateway」。推荐 (a)：不动已确认的依赖边，只把「跨 host 不带 Authorization」写成共享策略的一份实现。

### `RD-02` `claim` 与 `pause`/`shutdown` 的竞态需要一条写死的规则

契约里没有「退回 attempt」的操作，唯一出路是上报终态。那么必须明确：claim 响应到达时，若该实例已被本 client 判定为 paused/已释放、或容器校验在 `bindSession` 之前就失败，client **不建 session、不上报 `failed`**，而是直接 `cancelled(paused|shutdown)` 或按 §9.1 走失败上报，并在租约内完成。现在这条只散在 §9.1 的表格里（`C-04`/`C-05` 行），§5.3 没有任何说明。

顺带确认一条我认为可以写死、不用加操作的选择：**不新增 release/nack 操作**，一律用上报终态表达「这条 attempt 我不执行」。代价是竞态会消耗一次 attempt 并让调度器看到一次 cancelled；收益是操作面不扩张、所有终态收口在同一处。这条要进 §5.3 与 §7。

### `RD-03` `run_superseded` 退出码取 2 语义错位

Q12 暂定 2（用法/配置）。但「同 `clientId` 出现更新的 `runId`」是正常运维事件——守护进程重启、双开部署、滚动升级——不是用户配错了参数。client `architecture.md` §3.2 的退出码表是 v1 冻结项，2 会被运维读成「配置错误」。建议新增专用码（如 7）或对旧 run 直接退 0 并记日志；由运维语义定，不要复用 2。

### `RD-04` `message` 在 `failed`/`timeout` 时恒为空串

§6.2 写「失败/取消时为空串」，§5.7 的 cancelled 示例也是 `""`。但 `failed` 与 `timeout` 恰恰最需要模型最后一条消息：调度器的评审/排障要靠它判断是环境问题还是模型跑偏，而 `NodeResult` 是跨边界唯一的结果载体。建议改为「`message` 只要有输出就填（按 `maxResultBytes` 截断），空串只表示确实没有输出」。现在改是加内容，冻结后改就是改语义。

### `RD-05` `bindSession` 返回 `lease`，租约有两个来源

§5.4 响应与 §6.6 的 `SessionBinding` 都带 `lease`，而 §5.6 说续租只走 `renew`。于是 client 的 `LeaseTracker` 要处理「两个响应都可能刷新租约」。要么删掉 `bindSession.lease`（租约只在 `claim`/`renew` 维护，单一来源），要么明文写「取较晚者」。推荐删：装技能期间本来就该按 TTL/3 续租，不需要这条旁路。

---

## 4. Hold

| 编号 | 项 | 为什么不阻塞 | 后续 |
|---|---|---|---|
| `H-01` | `ackSeq` 之外，「已上报但服务端未确认」的结果保留窗口没定义（journal 无界增长；凭据被吊销后结果永久滞留） | 属 client 内部存储策略，不改调度器契约 | S1 先按「attempt 未重派且未关闭即可重报」实现，`plan/open-questions.md` 记保留策略 |
| `H-02` | `limits` 只能 `register` 下发、运行期不变（§5.1.6），而 `assignmentsVersion` 可随心跳变——两种快照两种更新规则 | 当前无害；限制只在边界上生效 | M1 决定是否允许心跳更新 `limits`，或写明「变更需重启 client」 |
| `H-03` | `capacity.maxInstances` 在 `register` 与每次 `heartbeat.state.capacity` 各出现一次，无权威说明 | 单实例场景不触发 | M1 一句话定权威（建议以最近心跳为准） |
| `H-04` | `C-05` 的 GET 示例只带 `Authorization`，§4.2 却说「所有请求带 `X-Client-Run-Id`」 | 与 `RD-01` 的落点绑定 | 随 `RD-01` 一起定 |
| `H-05` | Q1 选 A 时 `activeAttempts` 与 `activeInstances` 恒等，字段冗余 | B 方案的预留位，删了反而要加回来 | 保留，S2 选 B 时复用 |
| `H-06` | `attemptNo` 的计数口径（按节点 / 按节点跨实例）未定义，仅审计用 | 不影响任何判定 | M1 写一句 |
| `H-07` | §4.4 把 `404 attempt_not_found` / `404 package_not_found` / `410 package_gone` 都归到 `invalid_request` | 端口层多一个值属加法，可后补 | 建议 `attempt_not_found` 归 `stale_attempt`、两个 package 码归 `asset` 类——否则调度器侧资源缺失会被 client 记成「自己的请求写错了」（与 §5.7.7「400 视为实现缺陷」撞在一起）；M1 顺手定 |

---

## 5. Verified sound（查过，确认无问题的区域）

| 编号 | 区域 | 怎么查的 | 结论 |
|---|---|---|---|
| `VS-01` | 三个身份与两条租约的切分 | 对照 §2.2、§2.3、§7 `SCH-06/07`、client `architecture.md` §6.12 | 「心跳断了不等于 attempt 立刻失效」「客户端租约决定能不能领新活、尝试租约决定这活算不算我的」两刀切得对，是整份契约的承重墙 |
| `VS-02` | `SCH-11` 崩溃后重报 | 与 §5.7.2、§5.7 补充段、§9.3 交叉核对 | 按 `(clientId, attemptId)` 归属、`reportResult` 不适用 `run_superseded`，两处一致，无矛盾；这是 R-02 能成立的关键 |
| `VS-03` | 长轮询超时层次 | §4.6 表：服务端 30s/20s，客户端 35s/25s；空批 `seq = ackSeq` | 自洽；客户端超时 > 服务端挂起，不会把正常空批当失败 |
| `VS-04` | 时钟处理 | §4.7 + `CLT-12` | `serverTime` + 单调时钟 + ±5s 容忍，不依赖墙钟；跨机部署下这是唯一可靠做法 |
| `VS-05` | 结果截断的责任划分 | §4.7、§6.2、`SCH-12` | 截断在 client（`CMP-result`）、上限由 `limits` 下发、服务端不得静默截断——责任单一，且 `truncated=true` 被显式认定为合法结果 |
| `VS-06` | 错误码新增是加法 | 把 §4.4 的 15 行与 `CMP-gateway` §3.3 的 9 行逐行对照 | 端口层只新增 `invalid_session` / `run_superseded` 两个值，9 个现有值一个未改语义；`late_result` 保持 409，与现有表一致（`404/410` 的归置见 `H-07`） |
| `VS-07` | 技能集 digest 的所有权 | §5.4.3–5、`SCH-05` | 规范化由调度器定义、client 只做相等比较与按包校验，避免「客户端重算集合 digest」这第二条真相；空数组=清空技能根也写清了 |

另核过两处**起草质量**，不属于契约问题但值得写进 §9：§6.6 把 `register`/`heartbeat`/`bindSession` 的端口返回类型从 `void`/`ControlBatch`/`SkillSet` 扩到 `Registration`/`HeartbeatResult`/`SessionBinding` 是对的（否则租约与 `limits` 无处承载），M1 应直接采纳；§13 的差异表按 P1/P2 分档，可直接作为冻结工序的改动清单。

---

## 6. 「在 client 起 HTTP，让调度器反向调用」的评估

### 6.1 它到底改变了什么：7 个操作里的半个

| 操作 | 现状（client 纯出站） | client 起 HTTP 后 | 变化 |
|---|---|---|---|
| `C-01` register | client → 调度器（身份、版本、容量、`limits`） | 不变 | 仍需出站 |
| `C-02` heartbeat | client → 调度器，30s 长轮询，兼控制事件 | **仍需保留**：客户端租约续期、容量上报、存活判定都在这条请求上 | 只有「控制事件」半个搬家 |
| `C-03` claim | client → 调度器，按自报容量 pull | 不变 | 若改 push，服务端要自建容量台账，`SCH-16`「按上报容量派发、不超卖」的判据仍来自心跳 |
| `C-04` bindSession | client → 调度器（`sessionId` 由 client 产生） | 不变 | 反向调用也得 client 先告知 `sessionId` |
| `C-05` download | client → 调度器 | 不变 | 内容在调度器侧 |
| `C-06` renew | client → 调度器 | 不变 | 租约归属的确认天然是持有方发起 |
| `C-07` reportResult | client → 调度器 | 不变 | 结果在 client 侧 |

七个操作里六个半本来就是 pull 或 client 持有事实，只有「服务端手里有事件、要送到一个不在请求中的进程」这半个是 push 语义。

### 6.2 净删掉的东西

`§5.2` 的序号与确认四条（326–329）、`§6.4` `ControlBatch.seq` 的连续性约束、`SCH-08`、`CMP-gateway` 的 `ControlSeq` 子组件、`§10` 里「心跳超时」的部分口径。量级：一页契约 + 一个内部子组件。

### 6.3 净新增的东西（六件，都得自己解）

1. **至少一次投递不会消失。** HTTP 调用没有投递保证：超时你分不清「没收到」还是「收到了还没答完」。所以仍要重试 + 去重 + 顺序，只是把事件从「响应体」挪到「请求体」。现状用「per-client 单调 `seq` + 累积 `ackSeq`」是最便宜的去重（一个整数代替事件 ID 集合）；反向调用则要么给每个事件发 `eventId` 再加去重窗口，要么引入 epoch，比现状更贵。
2. **可达性变成一个契约前提。** 现在「client 不可达」只有一个信号：心跳停了 → 客户端租约过期（`SCH-06/07`）。加了入站后多出一个不对称失败域：出站通、入站不通（代理、NAT、只放行出站的安全组都会造成）。拓扑能解决「能不能连」，但契约必须写清「入站不可达时 cancel 怎么算」——而答案只能是退回租约过期重派，于是入站通道从「替代」降级为「优化」，租约那套照样得留。
3. **endpoint 的生命周期。** 需要在 `register` 里带上监听地址与证书，重启后端口可能变，调度器手里的 endpoint 会过期。现在的模型里没有这种东西：通道由 client 每次自己建立，永远指向配置里的 `scheduler.url`。
4. **鉴权方向反转 + 第二个信任面。** 现状一份凭据、一个方向（client 证明自己）。反向调用要求调度器向 client 证明自己，于是 client 侧要发凭据或上 mTLS，`§4.8`/`SCH-15` 的模型要重写。更麻烦的是能力面：`cancel` / `shutdown(cleanup=clean-client)` 的语义是杀进程、清工作区——一个入站端口上挂着「谁能连上谁就能让本机杀进程并删目录」。
5. **两个服务端 + 两个客户端要各自实现。** 现状只有调度器实现服务端，client 实现客户端（外加桩调度器做测试）。反转后 client 要冻一份自己拥有权威的契约，调度器要写 HTTP 客户端与重试——契约权威从一处变两处，本项目（调度器侧）恰好是应该出权威的一侧。
6. **`ControlBatch` 的语义仍要保留。** 既然事件还得是批量的、有序的、可幂等应用的，§6.4 的类型基本照搬，只是换了载体。省下的只有 `seq` 的承载位置。

### 6.4 两个常被当成理由的点，都不成立

- **「延迟会更好」**：不成立。长轮询在服务端有事件时**立即返回**，client 到事件的延迟等于一次已在链路上的响应，通常比新建一条入站 TCP + TLS（可能还要过代理）更快，也更稳——`cancel` 恰恰发生在机器满载、建连最容易慢的时刻，而此时长轮询的连接是热的。
- **「调试更简单」**：只对人肉调试成立，而且可以用非契约手段解决（桩调度器、`doctor`、日志）。注意这跟 client 现在的一条已确认决策直接冲突：`architecture.md` §1、§11「不提供本地 HTTP 服务或 IPC」，以及提案 `SCH-18`、`CLT-11`。改方向等于重开 2026-11-03 已确认的交互模型，并让 M1 已冻结的字段（`ackSeq`、`ControlBatch.seq`、`nextPollAfterMs`）作废一批。

### 6.5 结论与触发条件

**S1/M1 不做，保持纯出站。** 这不是审美偏好：反向调用省下的是一页契约，付出的是一个新失败域、一套新鉴权、一份新契约权威，而且租约与心跳一条都删不掉。

**值得重开的触发条件**（满足任一再拿出来评估，且按 P1 走）：

1. 出现**同步请求-响应**的编排交互，且 client 必须阻塞等结果——最现实的候选是人工确认/权限审批（client `architecture.md` §9 末条已经把它标为「需新增同步交互面」）。但即使这个也有更便宜的解法：client 把审批请求 POST 给调度器并**保持连接挂起**，调度器定夺后在同一响应里返回，方向不变。
2. 需要调度器向**不在轮询**的 client 推流（例如给某个运维面板做实时视图）。这属于观测面，不是执行面契约，应另立面而不是改本契约。
3. 拓扑上出现「client 只能被调度器反向寻址、无法出站」的部署——与现状前提相反，真出现时再翻转。

**若真要做，最小形态**：`register` 增 `endpoint` + `endpointToken`；调度器只调一个 `POST /control`，请求体就是现有 `ControlBatch`（含 `seq`），响应体是 ack——语义完全不动，只换传输，并保留长轮询作为降级通道。这样两种形态可以共存，不必二选一。

---

## 7. 需要拍板（M1 冻结前）

| ID | 问题 | 选项 | 建议 |
|---|---|---|---|
| `Q13` | `claim` 幂等键（`RB-01`） | 加 `claimRequestId` / 维持现状并接受漏派 | 加 `claimRequestId` |
| `Q14` | 重派许可（`RB-02`） | 租约过期或旧 run 收口 / 租约过期或 fence | 前者，并新增 `SCH-19` |
| `Q15` | 控制事件重放作用域（`RB-03`） | `issuedAt` 作用域规则 / 持久化 `ackSeq` | 作用域规则为主，持久化为辅 |
| `Q16` | `C-04` 失败映射（`RB-04`） | 按错误码分档 / 统一 `failed(scheduler)` | 按错误码分档 |
| `Q17` | `C-05` 鉴权归属（`RD-01`） | 共享凭据读取器 / gateway 代理下载 | 共享凭据读取器 |
| `Q18` | `run_superseded` 退出码（`RD-03`） | 新增码 7 / 退 0 / 维持 2 | 新增码 |
| `Q19` | `message` 语义（`RD-04`） | 有输出就填 / 维持空串 | 有输出就填 |
| `Q20` | `bindSession.lease`（`RD-05`） | 删除 / 取较晚者 | 删除 |

同时把 `§14.1` 桩清单补两条：同 `claimRequestId` 重复 claim、重启后事件补发与 `issuedAt` 作用域。

## 8. 复核（2026-11-06）：v0.2 修订核对

复核方法：逐条对照 client `review.md` 的处置表与提案 v0.2 原文，确认「改的是同一件事、改到了语义层、没有引入新的不一致」；只读了文档，未跑代码（双方代码均未落地）。

### 8.1 四条 Blocker：全部关闭

| ID | v0.2 位置 | 复核结论 |
|---|---|---|
| `RB-01` | §2.1 幂等键、§4.5、§5.3.2、§7 `SCH-09`、§6.1 | **关闭**。`claimRequestId` 由 `CMP-gateway` 生成并持有、传输重试复用同一值、`204` 或成功领取后的下一次换新值；`claim(capacity)` 端口签名不变、id 不穿透领域层。把幂等放在传输层而非领域层是对的：领域层拿不到「这是一次重试」的信息。 |
| `RB-02` | `SCH-02`、新增 `SCH-19`、§5.1.3、§9.3.2、§11 | **关闭**。「重派需旧租约过期或旧 run 已上报终态」「fence 只阻止领新活」「同实例单活跃 attempt」三句到位，双跑写同一容器的路径消失。 |
| `RB-03` | §5.2 序号 1–5、§6.1 `claimedAt`、§6.4、§9.3.7 | **关闭**。队列按 `(clientId, runId)`、新 run 丢弃旧 run 未 ack 事件、`issuedAt` 只作用于 `claimedAt < issuedAt` 的 attempt、`ackSeq` 不跨崩溃——重放路径消失，且不依赖持久化（选了作用域而不是持久化，成本更低）。 |
| `RB-04` | §5.4 分档表、§9.1、§9.2、§10 | **关闭**。`stale_attempt`/`lease_expired`/`404` → `cancelled`；`invalid_session`/`400`/`5xx` → `failed(scheduler)`；manifest → `failed(asset)`。与 §5.6、§10 不再打架；`404` 的归置同步改了 §4.4（`H-07`）。 |

### 8.2 五条 Decision now 与七条 Hold

| ID | 落点 | 复核结论 |
|---|---|---|
| `RD-01` | §5.5 新增「鉴权归属」段 | 方向对：组合根注入同一个 `AuthProvider`/`SchedulerEndpoint`，assets 不 import gateway。**定义位置未写死**，见 `ND-05`。 |
| `RD-02` | §5.3.11、§10 新增行 | 关闭。「不新增 release/nack，一律用终态表达不执行」写死了，竞态消耗一次 attempt 的代价被显式接受。 |
| `RD-03` | 全稿改 Q18 + 退出 7、§10 行、§13 | 关闭：7 与 0–6 不冲突，`2`（用法/配置）不再被误用。簿记缺口见 `ND-06`。 |
| `RD-04` | §6.2、§13 | 关闭：「有输出就填、空串仅表示确实没有输出」，失败现场不再固定丢失。 |
| `RD-05` | §5.4 响应、§6.6、§13 | 关闭：`bindSession` 不再带 `lease`，租约单一来源；装技能期靠 `C-06` 续租也写得通。 |
| `H-01` | `OQ-021`（client `plan/open-questions.md`） | 接受：不阻塞冻结。 |
| `H-02`–`H-07` | §5.1.7/§5.1.5/§5.5/§5.2/§6.1/§4.4 | 全部落地，其中 `H-07` 顺手改净了 §4.4 的 404/410 归置。 |

### 8.3 复核新发现

| 编号 | 档位 | 发现 | 修法 |
|---|---|---|---|
| `ND-01` | Decision now | **`shutdown` 的本地副作用随丢事件一起丢了。** §5.2.2 规定新 run 注册时丢弃旧 run 未 ack 事件；而 `shutdown(instanceId, cleanup)` 是**带本地副作用**的事件（清容器/清技能）。典型序列：实例运行中 client 崩溃 → 调度器释放实例并发 `shutdown(cleanup)`（事件入队，无人收）→ client 重启（新 run）→ 事件被丢。§5.1.4 又明确「实例从快照消失不触发删除容器」，于是这次清理意图无任何补偿通道，容器永久留存，且调度器认为已释放、不会重发。`cancel`/`pause` 不存在此问题（重启即无 attempt、无派发），只有 `shutdown` 会。 | 把「实例释放 + 清理」表达成**幂等状态**而不是一次性事件：`assignments[]` 增 `released`/`cleanup` 字段（或 `register`/`heartbeat` 响应带 `cleanupPending[]`），client 重启后按状态对账执行（幂等、可重复）。事件仍按 `runId` 丢弃，不矛盾。 |
| `ND-02` | Decision now | **`SCH-19` 与 Q1 耦合未写明。** `SCH-19` 写成无条件的「同一 `instanceId` 同一时刻只有一个未终结 attempt」，而 Q1 的 B 选项（同容器并发、同 digest）正是要打破它。冻结 `SCH-19` 等于提前把 Q1 定成 A——这本身符合评审建议，但文档没这么说，将来选 B 就是改已冻结的 `SCH` 条目。 | `SCH-19` 后加一句：「本条等价于 Q1 选 A；若选 B，改为『同实例多 attempt 仅当技能集 digest 相同（`SCH-05`）』，需升 `protocolVersion`」。 |
| `ND-03` | Hold | `issuedAt` 作用域用的是严格小于（`claimedAt < issuedAt`）。同刻签发与非签发无定义；`cancel` 与 `claim` 撞在同一毫秒时，用户取消会被忽略一次。 | 改 `claimedAt <= issuedAt`（同刻取消优先）或由调度器保证 `issuedAt` 严格晚于同批 `claimedAt`。一句话，M1 顺手写。 |
| `ND-04` | Hold | `claimRequestId` 的服务端幂等记录保留窗口未定义（契约只说「租约窗口内」）。窗口短于「最长停顿 + 重试」时会重新排队，产生影子租约——虽比 `RB-01` 轻，但仍是同一类问题。 | 调度器内部实现细节，M1 写一句建议值（≥ 尝试租约 TTL + 结果确认窗口）；不必进对外契约。 |
| `ND-05` | Hold | `RD-01` 的 `AuthProvider`/`SchedulerEndpoint` 没有说定义在哪个组件。若定义在 `CMP-gateway`，`CMP-assets` import 它就违反 client `architecture.md` §4.3「`CMP-assets` 不得 import gateway」；若定义在 `CMP-executor` 的 ports，L0 只读依赖该处值类型是既有模式，可行。 | 写一句「定义在 `CMP-executor` 的 ports，由组合根注入同一实例」。 |
| `ND-06` | Hold | 三处簿记：① Q12 原为退出码问题，现改为「旧 run 收口」，退出码移到 Q18，但 Q12 行没标「原问题已移」——首轮评审与本稿 §7 都还按旧含义引用过；② 退出码 7 属 `architecture.md` §3.2，§13 只列了 `CMP-cli` §2.8；③ §4.4 的「端口层错误」列现在混了两套词表（`C-05` 行填的是 `asset`，属 `ErrorClass` 而非 gateway 端口错误）。 | 各补一句话；不影响语义。 |

### 8.4 复核结论

**有条件通过**，条件只剩 `ND-01`、`ND-02` 两条，都是一句话级改动，落进 M1 冻结工序即可。`Q13`–`Q16`（Blocker 结论）与 `Q17`–`Q20` 维持本稿 §7 的建议，不再有分歧。

`ND-01` 建议按「状态而非事件」修：它同时解释了为什么 `assignments` 快照机制值得保留——快照天然幂等、可重放，而事件只对在线进程有效。

### 8.5 第三轮复核（2026-11-07）：v0.4 与 `cleanupPending` 机制

| ID | 落点 | 复核结论 |
|---|---|---|
| `ND-01` | §5.1.5、§5.2、§6.6 类型、`SCH-20`、`CLT-13`、§9.3.3、§10 新行 | **关闭**。选「独立数组」而不是给 `assignments[]` 加 `released` 是对的：`assignments` 是可省略快照，清理意图不能因为快照缺失而丢。`releaseId` 幂等、`keep` 也要 ack、未知 `releaseId` 视为已完成——三处都是幂等对账必须的细节，齐了；`shutdown` 事件降级为「在线加速」而状态是权威，这个分层正确。 |
| `ND-02` | `SCH-19`、§11、Q1 | **关闭**。等价关系、选 B 的改写方式、需升版本，三句都在。 |
| `ND-03` | §5.2 / §6.1 / §6.4 / §14.1 | **关闭**。改 `<=` 并补同刻测试，是把一句话的边界钉死。 |
| `ND-04` | §5.3 | 接受。`>=` 尝试租约 TTL + 结果确认窗口（建议 10min）作为调度器实现参数不对外，合理——client 在窗口外重试只会拿到新 attempt，没有可见破坏。 |
| `ND-05` | §5.5 | **关闭**。定义在 `CMP-executor` 的 ports、组合根注入同一实例，与 `architecture.md` §4.3 的禁止边相容。 |
| `ND-06` | §4.4 脚注、§13、Q12 | **关闭**。脚注写清了 `C-05` 行的 `asset` 是 `ErrorClass` 而非端口错误，M1 拆列已排期。 |

新机制本身带来 5 条，均不推翻 `ND-01` 的方向：

| 编号 | 档位 | 发现 | 修法 |
|---|---|---|---|
| `N2-01` | Decision now | **`failed` 没有终止态。** §5.2 定「调度器只在 `status=done` 时移除，`failed` 保留并继续下发」；§5.1.5 又举了 `failed(workspace_not_found)` 仍保留 pending 的例子。于是任何**永久失败**的清理（工作区从未准备、路径越界、磁盘只读）都会每 30s 重发一次，直到人工介入；pending 只增不减，告警被刷。`CleanupAck.retryable` 字段已经存在，却没有任何规则用它。 | `failed` 且 `retryable=false`（或同一 `releaseId` 失败超过 N 次）→ 调度器停止下发，转 `cleanupStuck` 审计/人工，client 不再重复执行。两句话，字段已在。 |
| `N2-02` | Decision now | **`assignments` 与 `cleanupPending` 可能同时包含同一 `instanceId`。** 两个数组相互独立、都能带 `instanceId`，而 §5.1.5 要求「cleanup 完成前不得为该实例领取」。若调度器把「释放」与「重新派发」判成并发，两个数组就会同时出现该实例、语义相反；client 没有裁决规则。 | 写一句互斥 + 一句兜底：调度器保证同一 `instanceId` 不同时出现在两处；同时出现的，client 以 `cleanupPending` 为准、暂停该实例领取并告警。 |
| `N2-03` | Hold | **对账归属越过 executor。** §9.1 的 `C-02` 行与 `CLT-13` 写「`CMP-cli` 对账 + `WorkspacePort.cleanup`」，但 `WorkspacePort` 是 `CMP-executor` 定义、由 `CMP-workspace` 实现的端口，`CMP-cli` 只有 executor 与各 `*Admin` 两条合法边（`architecture.md` §4.3）。CLI 直接调 `WorkspacePort.cleanup` 会绕开 executor 的 attempt 状态机与实例锁。 | 建议 executor 增 `reconcileCleanup(pending): CleanupAck[]`，CLI 只做搬运与回执；`CLT-13` 的「实现点」改为 `CMP-executor`。 |
| `N2-04` | Hold | `cleanupPending` 无上限、无分页；长期离线后再注册，单次响应会随释放数线性增长。 | 给上限（如 50）与「先到先发」语义，或分页；与 `cleanupAcks` 的 20 条/跳对齐。 |
| `N2-05` | Hold | `claim` 命中一个仍在 `cleanupPending` 的实例时的收口未写：client 该报哪个终态、调度器该不该重派。 | 一句话：拒绝执行、按 `cancelled(shutdown)` 上报（与 §5.3.11 的竞态规则同族），调度器在 cleanup 期间不派发。 |

### 8.6 第三轮结论

**通过（条件 2 条）**——`N2-01`、`N2-02` 各落两句后即可冻结；`N2-03`–`N2-05` 进 M1 清单。本轮之后不再新增条目：v0.4 的骨架、身份、租约、事件作用域与幂等键都已核对过多轮，剩下的都是机制内部的收口问题。

## 9. 附评：只读观测 HTTP P1（独立对象）

> 对象：client 侧 `docs/works/2026-11-06-observability-http/proposal.md`（2026-11-06，442 行）。它不在本工序的冻结范围内，本节只给调度器侧视角，供其 P1 确认门使用。

### 9.1 方向判断：这是入站 HTTP 唯一成立的位置

§6 给的三条重开触发条件里，第 2 条是「给不在轮询的 client 推流，属观测面，应另立面」。这份提案正好落在那里，而且**成立的理由是它没有任何 liveness/ordering 语义**：观测请求丢了不影响执行，不需要租约、不需要 `seq`、不需要重试窗口。控制面缺的正是这一点。建议把这条判据写进提案，作为「为什么观测面可以入站、控制面不行」的依据，防止将来有人拿它当先例。

另外两处判断是对的：规范化事件来自 client 自己的日志、raw 只做原样归档不解析 DSH 格式（与 `VS-07` 同一条原则：不把外部格式变成我们的契约）；实例清理前必须先归档、归档失败不删 home。

### 9.2 `OB-01`（Blocker）：非 loopback 上明文传 raw

提案 §5.4 默认 `bind=127.0.0.1`，§6 写「TLS/mTLS/轮换后续特性」，§4.2 又要求「调度器跨机访问：把 bind 设为可达地址」。三条合起来就是：**用长期静态 Bearer token、在明文 HTTP 上，暴露 `session.v4.jsonl.zstd`（含 system prompt、模型推理、工具完整 I/O）**。token 一旦被嗅探即可无限制重放，而 raw 端点是一次整份下载，没有别的降级。

这与我 §6 里「入站要新增一套鉴权方向」的判断是同一件事的变体：这里不是 mTLS，而是「一个长期 token + 无传输安全」。

修法按代价从低到高：

1. **v1 只允许 `bind` 为 loopback（或 unix socket）**，跨机由拓扑解决（SSH 隧道 / 反向代理 / 同机 sidecar）——与用户「网络拓扑解决」的前提完全一致，同时把「第二套鉴权模型 + TLS + 证书轮换」整个消掉；
2. 若必须非 loopback：强制 TLS、token 带过期时间、`raw` 端点默认关闭并需显式开启；
3. 接受风险：在提案里写明「调度器被攻破 = 所有 client 的会话全文泄露」并加审计与限流。

我推荐 1。它也顺带回答了 §10 待确认第 1 条（同机 or 跨机）：**v1 按同机做，跨机留给拓扑**。

### 9.3 四条 Decision now

| 编号 | 问题 | 建议 |
|---|---|---|
| `OB-02` | **写盘可能进热路径。** `ObservationEvent` 每事件写 `events.jsonl`；Bun 单线程，同步写/`fsync` 会阻塞心跳长轮询与 `renew`（40s 租约节奏），自伤成租约过期。§8 只覆盖「写盘失败」，没覆盖「写盘延迟」。 | 写明缓冲批量、批量上限、溢出丢弃计数、执行路径上不 `fsync`；观测写入失败降级为丢事件，不阻塞执行。 |
| `OB-03` | **信任面反转没有登记。** 观测面让调度器持有每个 client 的访问凭据并能读取 client 本地全文；client `architecture.md` §4.4/§11 的前提是「全文不跨边界」。这不是不能做，但它是新增的、跨两侧的信任面。 | 提案加一节「风险与接受理由」；`raw` 默认关闭；若将来走 `register` 上报 `observabilityUrl`，额外说明调度器如何保存 client 凭据（建议 v1 不进 `register`）。 |
| `OB-04` | **组件切分与预算。** `CMP-observability` 目标 ≤15k token，现在要加 HTTP server + 查询/索引 + SSE hub + 保留策略 + 归档读取。A/B/C 三候选选 A 合理，但预算没重算，越过目标不会有人发现。 | 改写 `CMP-observability` §8 预算为目标 ≤60k、上限 120k，并给出拆分阈值（实现超 60k token 或端点超 12 个即走 B 方案）。 |
| `OB-05` | **归档目录是两个 L0 之间的隐式文件契约。** `CMP-runtime` 写 `sessions/*`、`CMP-observability` 读同一棵树，而 client `architecture.md` §4.3 规定「跨组件数据只走端口」「L0 之间不横向调用」。提案用「归档路径由组合根注入，写入是文件契约」绕过去了，但这个文件契约没被写成正式契约。 | 按 `journal v1` 的处理方式登记：布局、原子性、版本字段、谁写谁读、失败语义，并在数据所有权矩阵加一行。 |

### 9.4 Hold

- `OB-06`：`/health.version` 与 `register.clientVersion` / `protocolVersion` 撞名。建议 `{ observabilityVersion, clientVersion }` 两个字段，冻结后再改就是改字段名。
- `OB-07`：loopback + token 为空时，本机任意用户可读 raw。单用户开发机可接受；多用户机器应改为 unix socket + 权限位。写进 §6 的一句前提即可。
- `OB-08`：`404` 与 `410` 的区分规则要写死（`404` = 从未存在或索引已删；`410` = 曾存在且已按保留策略删除），否则调度器无法区分「base URL 配错」与「数据已过期」。
- `OB-09`：`O-05` 的 `maxStreams=20` 是全局还是 per-attempt，未写清。

### 9.5 附评结论（2026-11-06 首轮）

**有条件通过**：方向对，`OB-01`（Blocker）按 9.2 的方案 1 落地后，其余四条 Decision now 补齐即可。若采纳「v1 只 bind loopback」，本提案与 §6 的结论完全兼容——它不会变成控制面入站，也不会让 client 变成调度器可寻址的执行服务。

### 9.6 处置复核（2026-11-07）

`OB-02`–`OB-09` 全部落稿，且都落在正确的位置：写盘改「执行路径只入内存队列 + 后台批量」是这轮最有价值的一处（Bun 单线程下同步写盘会把观测面变成租约过期的原因）；归档目录补成带 `layoutVersion` 与原子写规则的文件契约，补上了我指出的「两 L0 靠口口相传」；`404`/`410` 用 tombstone 区分，调度器能分辨「URL 配错」与「过期」；`maxStreams` 明确全局。

`OB-01` 没有被修，而是按产品决策「保持 `0.0.0.0` + 可选 token」被**接受为风险**（`2026-11-07` 签字，见其 `review.md` §2）。我的意见分两半：

- **可接受**：默认监听 `0.0.0.0` 是无障碍访问的产品需要，与安全策略正交；只要部署时能收到 `observability_insecure` 告警并按需改 `bind`，我不反对。
- **不接受的**：**「非 loopback + 空 token」仍然正常启动**。这不是产品决策，是 fail-open 默认值——它把「必须限定受控网络」这条只写在风险表里的前提，交给每个部署者自觉执行，而失败方式是静默的（没人在泄露发生前会发现）。`raw_enabled` 默认 `true` 让最坏情况再放大一层：一次请求拿到 system prompt、推理与工具完整 I/O。

**要求收窄到一行**：`bind` 非 loopback 且 `token` 为空 → 拒绝启动（退出 2，`observability_token_required`），或强制 `raw_enabled=false`。这一行不改 `0.0.0.0` 默认、不挡产品需求、也不要求实现 TLS——它只是把「已声明的部署前提」变成启动期可检查的条件。若维持现状，我不再把它算作契约阻塞项（它不在控制面路径上），但会在结论里记为「未采纳的安全建议」，并建议在 `risks.md` 里把「必须限定受控网络」改成可执行的检查项而不是一句前提。

## 10. 下一步

1. `N2-01`、`N2-02` 由 client 侧各落一句；`N2-03`–`N2-05` 并入 M1 清单。此后本 `review.md` 收口为「通过」，补 `result.md`，整目录归档。
2. 观测面：`OB-01` 的一行强制鉴权建议由 client P1 决定是否采纳；不采纳则按其 `review.md` 记录的风险接受执行，调度器侧 S1 不消费该观测面（v1 不进 `register`），因此不影响契约冻结。
3. M1 冻结工序以本稿 §7、§8.3、§8.5 为输入；`RB-02`/`RB-03`/`SCH-20` 的结论同时要落调度器侧执行组件规格（该切分本身是另一个 P1，本工序不展开）。
