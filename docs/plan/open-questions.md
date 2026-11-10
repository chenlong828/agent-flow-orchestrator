---
layer: plan
module: global
status: current
updated: 2026-11-10
---

# 开放问题

本表只收跨工序疑问；需求请建 `requirements/REQ-xxxx.md`。工序领取时在 `brief.md` 记编号；有结论后写去向（转 REQ / 落 `history/decisions/`），条目不删除。

当前无阻塞性开放问题；2026-10-29 技术债清理留下 6 项 hold，见下表 OQ-5～OQ-7、OQ-9～OQ-11（OQ-8 已于 2026-11-02 关闭）；OQ-12～OQ-19 为 2026-11-10 执行面契约 v2 接口验证转出；OQ-18、OQ-20 已于 2026-11-10 由调度层设计关闭，OQ-22 为该设计转出。OQ-1～OQ-4 已于 2026-10-25 关闭归档，条目保留供追溯，结论见 [项目边界与早期开放问题归档](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。

| # | 问题 | 结论 / 去向 |
|---|---|---|
| OQ-1 | **技术栈与运行形态**：编排服务用什么语言 / 运行时？执行器内嵌单进程，还是独立 worker / 容器池？ | 已关闭（2026-10-25）：技术栈为 Bun + PostgreSQL；运行形态与 ACP 执行模型不属于当前需求，未来按实际工序另立设计。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-2 | **与 `agent-flow-ui` 的关系**：它是本项目的需求来源与验收蓝本，还是仅同期演示？需求、术语、边界以哪一边为准？ | 已关闭（2026-10-25）：`agent-flow-ui` 是独立项目；本仓库不提供产品 UI、不以其为需求来源或验收前置，只按 REST 契约交互。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-3 | **对外形态与契约**：本项目以 HTTP API / CLI / 库三种形态中的哪些对外？UI 是否直接消费？契约版本由谁定义？ | 已关闭（2026-10-25）：只提供 HTTP API（`/api/v1` + `/healthz`），不提供 CLI、库或产品 UI；Swagger UI 仅作为开发者文档；契约由本仓库维护，UI 是否消费由独立项目决定。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-4 | **首个交付范围**：M4 的最小端到端链路选哪条业务流（工作流定义 → 装配 → 运行 → 观测）？ | 已关闭（2026-10-25）：B1 已完成；首个端到端流程等实际需求出现后另立 `REQ`/工序，不作为当前开放问题。见[归档记录](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。 |
| OQ-5 | **JSON 请求体上限**：是否设、设多少、超限返回 413 还是 400？ | 待定（2026-10-29 hold，T-DEBT-13）：等明确客户端约束与最大合法请求体后再定；本轮不预置数值。 |
| OQ-6 | **skill store**：是否补一个独立的 skill 读模型/store，还是继续由 catalog + 服务承担？ | 待定（2026-10-29 hold，T-DEBT-18）：等下次改 skill 写路径时评估，不单独为抽象而动。 |
| OQ-7 | **catalog N+1**：列表/引用投影是否需要在 B4 前批量化？ | 待定（2026-10-29 hold，T-DEBT-19）：等数据量或 B4 端点增长给出实际压力，再决定批量化或缓存。按资源拆分后，per-item 读分布在 `catalog/harness.ts`、`catalog/expert.ts`、`catalog/skill.ts`、`catalog/tool.ts`；保留按资源拆分，批量化另立任务。 |
| OQ-8 | **跨组件公共件**：`toIso`/`escapeLike`/分页是否抽到 `kernel` 或 `platform`？ | 已关闭（2026-11-02）：`toIso` / `escapeLike` / `ensureText` / `buildWhere` 已收敛到 `core/kernel`，expert/skill/workflow 的消费端改为直接引用 kernel；后续只允许在 kernel 定义这些纯函数。分页仍在 kernel。 |
| OQ-9 | **`SkillService`/`SkillDraftService` 是否拆分**：按读/写/文件/发布拆，还是保持现状？ | 待定（2026-10-29 hold，T-DEBT-21）：拆分需重排事务与文件写入顺序；等有明确改动需求再做。 |
| OQ-10 | **请求上下文与结构化日志**：字段、采样、请求 ID 传播范围如何定？ | 待定（2026-10-29 hold，T-DEBT-22）：属于可观测性工序，先定日志契约再实现。 |
| OQ-11 | **`RevisionConflictError` 竞态兜底**：是否需要在唯一约束冲突时重试或转 409？ | 待定（2026-10-29 hold，T-DEBT-23）：无法稳定复现；等有失败样本再加测试与兜底。 |
| OQ-12 | **`C-05` 终止范围与 §9 并发冲突**：超时要求 `SIGKILL` 进程组，但同实例允许多个 session 并发，杀组会连带终止兄弟任务；client 现按「该实例无其它 session 才杀进程组」实现。 | 待定（2026-11-10 契约验证 `VD-04`）：建议契约改为「只终止该 session，进程组在实例无会话或实例回收时统一回收」；属 P2 语义修订，改前拍板。 |
| OQ-13 | **`400` 的两种语义**：`X-Executor-Protocol` 不匹配（终止）与「未知请求字段/请求非法」（400）共用一个状态码，只靠错误信封 `code` 区分；client 现把任何 400 都当 `unsupported_protocol` 终止。 | 待定（`VD-05`）：建议契约 §3 明确 400 的错误码集合，或规定 400 只在协议不匹配时使用。 |
| OQ-14 | **`SkillPackage.downloadUrl` 的消费者**：契约允许相对路径或绝对 URL（含第三方签名 URL），client 完全忽略它，只按 `packageId` 走 `P-03`；调度器将来若用对象存储直链，client 不跟随。 | 待定（`VD-03`）：二选一——契约写明「client 只用 `P-03`，`downloadUrl` 仅作描述」，或 client 实现直取（需补「不向第三方 host 发 `Authorization`」）。 |
| OQ-15 | **总超时的 `error.code`**：契约 §4.2 约定 `prompt_timeout`，client 实报 `timeout`（`agent-flow-client/src/components/runtime/runtime.ts:112`），调度器按 `code` 分流会漏判「任务太大」。 | 待定（`VD-01`）：优先 client 侧修复为 `prompt_timeout`，不改契约。 |
| OQ-16 | **技能包摘要不匹配是否重试**：契约 §4.3 #2 要求「不匹配重试一次」，client 直接 `failed(asset/checksum_mismatch)`，GET 只发 1 次。 | 待定（`VD-02`）：client 补一次重试；或契约降级为「由调度器重派」。 |
| OQ-17 | **`If-None-Match` 与无缓存 304**：client 首次请求就带条件头，调度器按 HTTP 语义回 304 时 client 报「304 但本地无缓存」并 `failed(asset)`。 | 待定（`VR-01`）：契约写明 304 的前提，或 client 无缓存时去条件头重试一次。 |
| OQ-18 | **`RunningTask.lastEventAt`**：契约标为可选，client 未发送；`2026-11-10-execution-semantics-review` 的 `SH-04` 认为它对派发排序有价值。 | 已关闭（2026-11-10，调度层设计）：调度器不依赖它排序或判活，只作观测字段；client 不发送不影响派发。落点见 `design/components/scheduler/spec.md` §4.3。 |
| OQ-19 | **观测面 fail-open**：client 只读观测 HTTP 在非 loopback + 空 token 下仍启动（`raw_enabled` 默认 true），评审 `OB-01` 未采纳「拒绝启动」建议。 | 待定（`OB-01`）：属 client 侧安全项；建议改为启动期检查（非 loopback 且空 token → 退出 2）或强制 `raw_enabled=false`。 |
| OQ-20 | **实例粘性没有契约条款**：边界设计把「实例绑定 client、重派不换 client」当硬约束，但 v2 的 `poll` 载荷不含 `clientId`，`S-02` 只要求「同一时刻派给一个 client」，**未禁止重派到另一个 client**；若实现按空闲派发，本地 `workspacePath` 会落到别的机器。 | 已关闭（2026-11-10，用户裁决 + 调度层设计）：粘性作为调度器硬约束，实例首次派发绑定 `clientId`，重派只回同一 client；**不改 v2 契约**。落点：`design/components/instance/spec.md` §4.3、`design/components/scheduler/spec.md` §4.7。 |
| OQ-21 | **实例不可用无上报载体**：client 无法声明「这个实例别再派」，只能事后报 `failed(workspace)`；`2026-11-10-execution-semantics-review` 的 `SA-01` 在 v2 中并未真正解决。 | 待定（`BC-14`）：调度层设计已给调度器侧兜底——`failed(workspace)` 后实例转 `blocked`、同实例任务结算失败、不再派发（见 `design/components/instance/spec.md` §4.1）。契约仍无上报载体，是否补字段留待 P2 契约修订。 |
| OQ-22 | **任务启动入口归属**：实例登记（界面设置 `workspacePath`）与任务入队（fan-out 任务列表、prompt 组成）需要 HTTP 面与用例，但 `executor-http-v2` 只有执行面三端点，调度层设计只留了领域接缝（`InstanceService.enroll`、`SchedulerService.enqueue`）。 | 待定（2026-11-10 调度层设计转出）：由 B4 运行/任务启动工序确定端点、鉴权与界面契约；在定之前不新增对外端点。节点目录问题另由 `2026-11-10-harness-node-registry` 比较方案（`OQ-23`）。 |
| OQ-23 | **执行面 token 的权威来源**：token → `clientId` 放配置还是落库？产品端点当前无鉴权，本地写接口可直接读回/换绑凭据。 | 已关闭（2026-11-10，用户裁决）：token 落 Harness 表（`harness.client_token`，明文入库、详情可读回），登记/轮换/解绑走 `API-41`；配置不再持有凭据。接受「本机无鉴权即可读回凭据」的演示期风险，进生产前必须补管理面鉴权或改为哈希存储。落点见 [`2026-11-10-executor-client-token.md`](../history/decisions/2026-11-10-executor-client-token.md)。 |
