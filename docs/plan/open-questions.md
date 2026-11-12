---
layer: plan
module: global
status: current
updated: 2026-11-12
---

# 开放问题

本表只收跨工序疑问；需求请建 `requirements/REQ-xxxx.md`。工序领取时在 `brief.md` 记编号；有结论后写去向（转 REQ / 落 `history/decisions/`），条目不删除。

当前无阻塞性开放问题（OQ-29 为 2026-11-12 联调发现的待定项）；2026-10-29 技术债清理留下 6 项 hold，见下表 OQ-5～OQ-7、OQ-9～OQ-11（OQ-8 已于 2026-11-02 关闭）；OQ-12～OQ-19 为 2026-11-10 执行面契约 v2 接口验证转出；OQ-18、OQ-20 已于 2026-11-10 由调度层设计关闭；OQ-22、OQ-24、OQ-25 已于 2026-11-11 由运行编排设计（`REQ-0001`）关闭，并转出 OQ-26～OQ-28。OQ-1～OQ-4 已于 2026-10-25 关闭归档，条目保留供追溯，结论见 [项目边界与早期开放问题归档](../history/decisions/2026-10-25-project-boundary-and-open-questions.md)。

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
| OQ-17 | **`If-None-Match` 与无缓存 304**：client 首次请求就带条件头，调度器按 HTTP 语义回 304 时 client 报「304 但本地无缓存」并 `failed(asset)`。 | 已关闭（2026-11-12）：client 已按提案改为「缓存未命中时清空 `etag` 再下载」，补了对应用例；客户端 `tests/components/assets` 12/12 通过，真实运行不再出现 `download_failed`。服务端 `P-03` 未改。见 [`2026-11-12-client-skill-package-304`](../history/works/2026-11-12-client-skill-package-304/result.md)。 |
| OQ-18 | **`RunningTask.lastEventAt`**：契约标为可选，client 未发送；`2026-11-10-execution-semantics-review` 的 `SH-04` 认为它对派发排序有价值。 | 已关闭（2026-11-10，调度层设计）：调度器不依赖它排序或判活，只作观测字段；client 不发送不影响派发。落点见 `design/components/scheduler/spec.md` §4.3。 |
| OQ-19 | **观测面 fail-open**：client 只读观测 HTTP 在非 loopback + 空 token 下仍启动（`raw_enabled` 默认 true），评审 `OB-01` 未采纳「拒绝启动」建议。 | 待定（`OB-01`）：属 client 侧安全项；建议改为启动期检查（非 loopback 且空 token → 退出 2）或强制 `raw_enabled=false`。 |
| OQ-20 | **实例粘性没有契约条款**：边界设计把「实例绑定 client、重派不换 client」当硬约束，但 v2 的 `poll` 载荷不含 `clientId`，`S-02` 只要求「同一时刻派给一个 client」，**未禁止重派到另一个 client**；若实现按空闲派发，本地 `workspacePath` 会落到别的机器。 | 已关闭（2026-11-10，用户裁决 + 调度层设计）：粘性作为调度器硬约束，实例首次派发绑定 `clientId`，重派只回同一 client；**不改 v2 契约**。落点：`design/components/instance/spec.md` §4.3、`design/components/scheduler/spec.md` §4.7。 |
| OQ-21 | **实例不可用无上报载体**：client 无法声明「这个实例别再派」，只能事后报 `failed(workspace)`；`2026-11-10-execution-semantics-review` 的 `SA-01` 在 v2 中并未真正解决。 | 部分关闭（2026-11-12）：调度器侧兜底（`blocked`）已删除，失败直接暴露在节点上、失败即终态不自动重派，不再需要「别再派」的跨 run 态；契约仍无上报载体，若将来出现「自动重排到同实例」的需求再补字段。 |
| OQ-22 | **任务启动入口归属**：实例登记（界面设置 `workspacePath`）与任务入队（fan-out 任务列表、prompt 组成）需要 HTTP 面与用例，但 `executor-http-v2` 只有执行面三端点，调度层设计只留了领域接缝（`InstanceService.enroll`、`SchedulerService.enqueue`）。 | 已关闭（2026-11-11，`REQ-0001`）：启动入口定为 `POST /api/v1/workflows/{id}/runs`，请求带 `harnessId`/`workspacePath`/`intent`/`autoConfirm`，服务端自动登记 instance；任务由 `CMP-run` 推进时入队。见 [`design-proposal.md`](../history/works/2026-11-11-workflow-run-orchestration/design-proposal.md) §6.2。 |
| OQ-23 | **执行面 token 的权威来源**：token → `clientId` 放配置还是落库？产品端点当前无鉴权，本地写接口可直接读回/换绑凭据。 | 已关闭（2026-11-10，用户裁决）：token 落 Harness 表（`harness.client_token`，明文入库、详情可读回），登记/轮换/解绑走 `API-41`；配置不再持有凭据。接受「本机无鉴权即可读回凭据」的演示期风险，进生产前必须补管理面鉴权或改为哈希存储。落点见 [`2026-11-10-executor-client-token.md`](../history/decisions/2026-11-10-executor-client-token.md)。 |
| OQ-24 | **联调期的任务注入通道**：执行面三端点落实现后，`SchedulerService.enqueue` 之外没有把任务放进队列的入口（`OQ-22` 未定正式端点）；联调需要一个可重复、可清理的注入方式。 | 已关闭（2026-11-11，`REQ-0001`）：联调改用 run 启动端点（`POST /workflows/{id}/runs`）驱动真实链路；`docs/history/works/2026-11-11-executor-joint-debug/tools/jd.ts` 保留作排障脚本，不再作为主要注入通道。 |
| OQ-25 | **`stop` 没有外部触发面**：`requestStop` 只作用于调度器进程内的 presence，HTTP 面与运维入口都没有；联调时无法让真实 client 收到 `stop`，只能靠自动测试。 | 已关闭（2026-11-11，`REQ-0001`）：运行级入口由 `POST /api/v1/runs/{id}/cancel` 提供，经 `scheduler.cancelInstances` 电平生效；client 进程优雅停机仍由信号（SIGTERM）处理，不再需要 HTTP 面。 |
| OQ-26 | **fan-out 的并发与技能集**：同一工作区已确认同一时刻只跑一个活跃 run，普通节点不会再撞 `S-06`；fan-out 在同一个 run 内展开多个任务，专家由 `fanout` 节点统一给出、共用同一 digest，但展开的大批任务与 client `maxConcurrent` 如何错峰、单条任务换专家是否允许仍未定。 | 部分关闭（2026-11-11）：并发 run 冲突已由「同工作区单活跃 run」消除；剩余部分（fan-out 批次与 client 并发上限、单任务换专家）留第二期工序开工前定。部分失败策略已定：单条任务失败不中断，全部跑完再汇总。 |
| OQ-27 | **session-log 与归档的容量、保留期**：单节点日志可能上百 MB，归档包含整个 task-space；当前只定单次上传上限（64 MiB / 512 MiB），没有保留期、清理与配额策略。 | 待定（2026-11-11 运行编排设计转出）：等真实日志体积与归档频率数据出现后再定；在此之前超过上限的节点直接失败并报明确错误码。 |
| OQ-28 | **节点失败后的原地重试**：当前节点失败即 run 失败，运维只能重开一个 run（新 runId、新 task-space），代价是整个流程重跑。是否需要「从失败节点原地重试、复用 task-space」？ | 待定（2026-11-11 运行编排设计转出）：第一期按「失败即终态」实现；若运维反馈重跑成本高，再评估在 run 内加 `retry` 动作（只对当前节点，`visit` 不递增）。 |
| OQ-29 | **取消后未被 client 认领的 dispatched 任务会占住实例容量**：run 取消后调度器对 `dispatched` 任务只打 `cancel_requested_at` 电平；若 client 重启丢掉了本地 in-flight，下一次 poll 仍会重发该任务，但 client 按「`cancelInstances` 中的实例丢弃 `tasks`」直接跳过、不回报，任务永远停在 `dispatched`，同实例的新任务因容量被占用而无法派发（联调实测：cancelled run 的 n1 任务阻塞同工作区下一次启动约 30 分钟直到 `S-02` 超时）。 | 待定（2026-11-12 T-RUN-09 联调发现）：二选一——client 对「实例已取消但任务未在本地运行」回报 `cancelled`，或调度器在 `cancel_requested_at` 超过阈值后自行结算 `cancelled`。当前联调用「库内手工结算」绕过；下一次动 client 或调度器取消语义时定。 |
| OQ-30 | **删除 Harness 与运行记录的冲突**：`workflow_run.harness_id` 是 `ON DELETE RESTRICT`，只要该节点跑过任何一次运行，Harness 就永久不可删除（开发期实测：遗留节点被 12 条终态 run 挡住）；引用检查（`API-07`）只列工具，不列运行，错误里的 `references` 为空。 | 待定（2026-11-12 联调发现）：三选一——保留 `RESTRICT` 并在删除错误里回带 run 列表；`harness_id` 改 `ON DELETE SET NULL` + 冗余节点名快照；给运行记录加保留期/清理入口。当前开发期用「解绑」而非删除绕过。 |
| OQ-31 | **技能包内 `SKILL.md` 的 `name` 格式**：编排侧按技能展示名生成 frontmatter（现有数据是中文），执行端要求 kebab-case，安装即 `invalid_skill_format`。 | 已关闭（2026-11-12，用户裁决方案 A）：`skill` 增 `slug`（kebab-case，展示名仍用 `name`），包内 frontmatter 与下载文件名改用 `slug`；`0006` 迁移回填 `skill-<尾8>`，存量两条重打包为可读名。真实运行通过。见 [`2026-11-12-skill-slug`](../works/2026-11-12-skill-slug/result.md)。 |
| OQ-32 | **实例 `blocked` 后同工作区静默排队**：执行失败的 run 会把实例置 `blocked`；再次用同一 `workspacePath` 启动会复用该实例，任务永远 `queued`、界面无任何提示；`unblock` 只有领域方法。 | 已关闭（2026-11-12，用户裁决）：**删除 `blocked` 状态**，实例只有 `active`/`retired`；`failed(workspace)` 只结算同实例排队任务，不再摘除实例。迁移 `0007` 把存量恢复为 `active`；实测同工作区重跑正常派发。见 [`2026-11-12-drop-instance-blocked`](../works/2026-11-12-drop-instance-blocked/result.md)。 |
| OQ-33 | **多技能包的安装目录互相覆盖**：客户端把每个包解到同一个 staging 根（`assets.ts` 的 `for (const pkg of skillSet.packages) materializePackage(pkg, staging)`），编排侧 zip 根只有 `SKILL.md`；单包时最终树是平铺 `<skills>/SKILL.md`（DSH 能读到，实测会话日志含技能名），多包时后一个覆盖前一个，且摘要校验只覆盖单包、发现不了。 | 待定（2026-11-12 验证时发现，客户端侧）：二选一——客户端按 `<slug>/` 为每个包建子目录；或编排侧把包结构改成 `<slug>/SKILL.md`（契约变更）。当前每个 run 只带 1 个技能包，问题未触发。 |
