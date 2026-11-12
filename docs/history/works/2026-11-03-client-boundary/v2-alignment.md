---
layer: history
module: global
status: frozen
updated: 2026-11-10
---

# 对齐检查：边界预设 vs 执行面契约 v2

> 对象：[`brief.md`](brief.md)「已定框架」、[`boundary-design.md`](boundary-design.md)、[`client-work.md`](client-work.md)。
> 基线：[`docs/design/contracts/executor-http-v2.md`](../2026-11-10-executor-contract-v2/executor-http-v2.md)（2026-11-10 现行权威）。
> 方法：逐条取边界原文与契约条款对照；只判「是否同一事实被两处写成不同结论」，不评实现好坏。

## 1. 结论

**边界文档的职责/所有权原则仍然成立，交互机制与并发模型已被契约 v2 整体替换，存在 10 处直接冲突与 2 处机制缺口。** 该文档现在不能作为 client 与调度器的交互依据；在收口前必须按 v2 改写交互部分（或整章改为引用契约）。

分三层：

| 层 | 判定 |
|---|---|
| 定位、职责矩阵、数据所有权、决策归属、产物边界 | 成立，v2 未改动 |
| 交互框架（注册/心跳/租约/领取/绑定/清理/幂等/迟到结果/版本协商） | 被 v2 替换，`brief.md` L56/59/60 与 `boundary-design.md` §4.2/§4.5/§4.6/§5/§6/§7 的交互部分失效 |
| 并发与进程模型（一工作区一进程、fan-out 各自工作区、工作区单写） | 与 v2 §9 冲突；v2 允许同实例并发、放弃单实例单写者 |

## 2. 直接冲突

| ID | 边界预设 | 位置 | 契约 v2 | 冲突性质 |
|---|---|---|---|---|
| `BC-01` | 交互是「HTTP 租约 / 长轮询」，client 领取时获得租约 | brief L56；design §3 L87、§6 L231-232、§8.1 L309、术语 L391 | 只有 poll 长轮询，**没有租约**；判活由 poll 连接表达，重派由 `S-02` 决定（`executor-http-v2.md` L65、L73、L403、L405） | 机制删除 |
| `BC-02` | client 注册、心跳、上报身份；凭据可轮换 | design §4.8 L188、§6 L231、§7.2 L258；client-work CW-02 L66 | 无 `register`/`heartbeat`（L65）；只有 `Authorization: Bearer <token>`，token 绑定 `clientId`，无轮换机制 | 机制删除 + 覆盖缺口 |
| `BC-03` | client 建 session 后**回传 session id，调度器绑定到实例/节点** | brief L59；design §4.2 L110-112、§5 L210、术语 L386；client-work L29 | 无 `bindSession`（L65、L406）；`sessionId` 只是结果的**可选字段**（§4.2），调度器不建绑定 | 流程节点消失 |
| `BC-04` | client 建 session 后**凭 session id 向调度器换取技能清单** | brief L60/L74；design §4.3 L131、§8.1 L313；client-work L28 | `skillSet` 随 `TaskRequest` 下发（§4.1、L406），无需回取；「先建 session 再取技能」的机制不再存在 | 机制删除（安装顺序仍兼容：先装技能再 prompt） |
| `BC-05` | 至少一次投递 + **幂等处理**，client 必须能处理重复领取与重复上报 | design §4.6 L165、§6 L239；client-work CW-02 L68 | 明确删除 `claimRequestId`、结果去重与幂等键（L404、L409）；重复靠 `S-03` 未确认重发 + 首份为准 + client 自行跳过 in-flight | 保证降级 |
| `BC-06` | **不允许重复执行**：客户端完成标志是「断网与重复投递下不重复执行」 | client-work CW-02 L46 | at-least-once；`§1.1` 明确放弃 exactly-once，允许同一任务跑两次（代价 token） | 直接矛盾（验收口径） |
| `BC-07` | 迟到结果**只入审计**，不推进流程 | design §4.6 L172、§6 L240；client-work CW-07 L119 | `accepted=false`，client 丢弃本地副本，**不做迟到审计**（L54、L409） | 语义删除 |
| `BC-08` | 一个活跃工作区一个 DSH 进程；fan-out 分支**各自工作区/进程**；非 fan-out 每工作区同时只有一个 session；**工作区单写** | brief L58；design §2.2 原则 3、§4.1 L96-98、§4.7 L181-183、§8.1 L311 | 同一 `instanceId` **允许并发多任务**（fan-out 分支），只要求同 digest 与安装临界区（§9）；`§1.1` 明确放弃「单实例单写者」，接受偶发 last-write-wins（L55） | 结构冲突 |
| `BC-09` | 实例关闭/取消由调度器下发，client 执行清理 | design §6 L235、§7.2 L263；client-work L78 | `stop` / `cancelInstances` 保留（取消在跑任务）；但 **v2 没有实例清理指令**，工作区默认保留、按 `instanceId` 运维回收（L372、L410） | 部分删除 |
| `BC-10` | 协议版本**可协商**；不兼容时调度器拒绝派发 | design §6 L241、§8.3 L346 | `X-Executor-Protocol` 整数校验，不匹配即 `400` 退出；**不做协商、不做兼容窗口**（L72、L458） | 直接矛盾 |
| `BC-11` | 节点执行阶段含「会话已绑定」；client 有在线/忙碌/离线状态 | design §4.5 L151-156 | 只有任务列表 `queued → dispatched → done`；client 状态不建模，静默由 `clientSilentMs` 推断 | 框架替换 |
| `BC-12` | 容量与**健康**上报；client 按分支上报容量 | design §4.7 L182-183；§7.2 L258 | 容量只由 `capacity.free` 表达（L369）；无健康、无分支计数 | 部分替换 |

## 3. 契约未覆盖 / 机制缺口

| ID | 边界要求 | 契约 v2 状态 | 影响 |
|---|---|---|---|
| `BC-13` | 实例粘性：重派必须回到**同一 client**，离线等待/失败，不迁移 | v2 只保证「同一时刻派给一个 client」（§1 不变式 2、`S-02`），请求载荷里没有 `clientId`，**没有任何条款禁止重派到另一个 client** | 若调度器实现按「谁空闲派给谁」，本地 `workspacePath` 就会落到另一台机器；这是实现前必须补的契约约束 |
| `BC-14` | 实例不可用上报（client 无法拒绝派发到坏实例） | v2 无载体；只能靠 `failed(workspace)` 间接表达 | `2026-11-10-execution-semantics-review` 的 `SA-01` 在 v2 里并未真正解决，只是改写为「用结果错误码表达」 |

## 4. 仍然成立的部分（v2 未改动）

| 边界结论 | 契约 v2 对应 |
|---|---|
| 控制面/执行面分离；评审、分支、fan-out 由调度器决定 | `S-01`–`S-08` 只描述调度器职责，client 承诺 `C-01`–`C-09` 只做执行 |
| 状态单家：实例/节点状态权威在调度器，client 本地只是缓存/日志 | `finished[]`、`running[]` 是上报事实，判定仍在调度器（`S-03`/`S-08`） |
| 工作区与产物归 client，调度器不读；只回少量控制信息 | `C-08`、`workspacePath` 只校验不创建；`maxResultBytes` 截断 |
| 一个可执行节点一个 session、session 不复用 | `C-02` 一任务一 session（v2 未写成条款，client 实现与边界一致） |
| 超时上界由调度器声明、client 执行 | `timeoutMs` + `C-05` |
| client 只重试传输层，不重跑 | `C-04` |
| 契约权威在调度器侧；先改契约再改实现 | §13 与 `delivery.md` §9 |
| 技能包完整性校验、路径安全、脚本随包落地 | `P-03` §4.3、`C-03`（脚本本身 v2 未提，见 `BC-16`） |

## 5. 处置建议

1. **不逐条修补交互章节**。把 `boundary-design.md` §6 与 §4.1/§4.5/§4.6/§4.7 的交互段改为「机制以 `executor-http-v2` 为准」，只保留职责、所有权与决策归属；`brief.md`「已定框架」中交互方式/session 绑定/技能供给三行需改。
2. **`client-work.md` 的 `CW-02`（连接与租约）与 `CW-07` 的迟到结果/重复执行出口** 需按 v2 重写，否则会继续作为 client 排期依据。
3. **两个缺口进契约**：实例粘性（重派是否允许换 client）与实例不可用上报，建议并入 `plan/open-questions.md` 的 `OQ-12` 系列，作为 v2 修订项；否则调度器实现会各写一套。
4. 完成 1–2 后本工序可收口归档；在此之前保持 open，不作为现行设计依据。
