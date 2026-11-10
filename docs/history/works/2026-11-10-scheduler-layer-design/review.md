---
layer: history
module: global
status: frozen
updated: 2026-11-11
procedure: 2026-11-10-scheduler-layer-design
---

# 评审：执行面调度层设计（P1，四档裁决）

> 对象：本工序全部设计产物（见 [`brief.md`](brief.md) §3）。
> 基线：[`executor-http-v2`](../../../design/contracts/executor-http-v2.md)（冻结，`protocolVersion = 2`）。
> 级别：P1（新增组件、公共契约面、数据所有权）。
> 裁决口径见 `arch-design-spec` 第 8 步；定级与裁决是两把尺子，不合并。

## 1 结论

**通过（2026-11-11 用户确认）。** 无 blocker；7 项 `Decision now` 已由用户逐项裁决，其中 `D-03`（失败重派）按用户判断改为「失败结果不自动重派」；设计可以冻结，实现工序另立。

确认记录见 §7。`D-03` 的改动已同步到 `scheduler/spec.md` §4.5、`config/spec.md` 与 `SCN-0202`。

## 2 Blocker

无。依据：契约 `S-01`–`S-08` 每条有唯一落点（`design/components/scheduler/spec.md` §4.2）；执行面新端点与错误码完整（`http-gateway` §4.3）；`docs:check` 通过（见 §5）；未修改契约正文、未改代码，不存在「发布后再修即 breaking」的未决项。

## 3 Decision now

| ID | 决策 | 选项与代价 | 推荐 / 当前设计 | 落点 |
|---|---|---|---|---|
| `D-01` | 组件切分：`CMP-scheduler` + `CMP-instance`，三端点并入 `CMP-http-gateway` | ① 3 组件（已选）；② 独立 `CMP-executor-gateway`（多一层装配与依赖，协议面与产品面共享错误信封，收益低）；③ 单 `CMP-scheduler` 全包（实例生命周期与任务状态机变化轴不同，会同步修改） | ①（用户已确认） | `architecture.md` §3、两份新规格 |
| `D-02` | `skillSet.digest` 规范化口径 + 同实例不同 digest 在入队时整批拒绝 | ① 入队拒绝（当前）；② 排队到实例空出（需要第二层队列与调度状态）；③ 同实例串行安装、允许不同 digest（违反 `S-06`） | ① | `scheduler/spec.md` §4.4 |
| `D-03` | 失败结果是否自动重派 | ① 按错误类别有限重试（原草案：3 次 / 5s 退避）；② 一律回队（会在「任务太大」与协议问题上无限重试）；③ **失败/超时结果直接结算、不重派**（用户选择）；未回报的 `S-02` 回队保留，上限 `taskMaxAttempts=3` | ③（2026-11-11 用户裁决）；代价是失败任务需上游新建任务重跑，换来最多 1×`timeoutMs` 的收敛时间与最省 token | `scheduler/spec.md` §4.5、`config/spec.md` §3.1 |
| `D-04` | 制品身份：`packageId=<skillId>.<revision>`，`digest=sha256(zip)`，`etag="sha256-<hex>"`；不保留历史包，旧 `packageId` 返回 404 | ① 当前（零保留，保存即失效）；② 历史包保留（需要 GC 与存储策略，`CMP-skill` 现状不支持，属范围扩展） | ①，把 ② 记 `scheduler/spec.md` §8 待定 | `skill/spec.md` §3.3、`kernel/spec.md` §3.6 |
| `D-05` | 同一 `clientId` 的 `poll` 单飞；长轮询挂起在 `CMP-scheduler`，网关只传 `holdMs` | ① 当前（不超卖、唤醒简单）；② 网关挂起（需要在网关侧订阅入队事件，传输层承载业务唤醒） | ① | `scheduler/spec.md` §3.2、`http-gateway` §4.3 |
| `D-06` | 5 张执行面场景停在 `status: draft`，正文按 `designed` 判据写齐 | ① 保持 `draft`，实现工序补 TC 与入口后转 `designed`（仓库 `docs:check` 要求 TC ID 已存在于 `tests/`）；② 本轮先写 20 个 `test(...)` 占位（跳过则 TC 不被识别，不跳过则测试必红，且属写实现代码） | ① | 场景卡 §5、`brief.md` §3 |
| `D-07` | 执行面凭据：`EXECUTOR_CLIENTS` 环境变量 JSON（`clientId → token`），不放 TOML/日志 | ① 当前（token 只在 `.env`，配置校验期失败）；② 数据库登记 client 与 token（需要管理面与轮换，超出本轮） | ① | `config/spec.md` §3.1–§3.2 |

`D-06` 说明：`docs:check` 的生成器把「测试方案齐」校验成「TC ID 已存在于 `tests/**/*.test.ts`」，因此纯设计工序无法把新场景标成 `designed`。这是门禁口径问题，不是场景内容缺失；若要改变口径，应另立工具工序，不在本轮顺手改。

## 4 Verified sound

| 区域 | 查了什么 / 怎么查 | 结果 |
|---|---|---|
| 契约职责落点 | 逐条对照 `S-01`–`S-08` 与 `scheduler/spec.md` §4.2；`P-01`–`P-03` 与 `http-gateway` §4.3 | 每条有唯一落点，无自相矛盾 |
| 客户端承诺边界 | 对照 `C-01`–`C-09`：调度器只消费 `running[]`/`finished[]` 与结果，不要求 client 新增字段 | 一致；`lastEventAt` 保持可选且不参与判定 |
| 版本闸门 | `X-Executor-Protocol` 整数精确匹配；§13 不做兼容窗口 | 与契约一致，错误码 `unsupported_protocol` 新增到 kernel 错误词汇 |
| 数据所有权 | `task`/`task_attempt` → scheduler；`instance` → instance；gateway 无表 | 无第二写入口；digest 不落 instance（由任务派生） |
| 依赖方向与扇出 | gateway 业务端口 7（catalog + 四类资产 + workflow + scheduler），另 kernel/platform 为共享契约与基础设施；scheduler 业务端口 1（instance） | 在 `≤8` 内；无环；无同层写调用 |
| 文档一致性 | `bun run docs:index`、`bun run docs:check`；场景 `docs` 锚点逐条存在（11 个场景）；18 份新增/修改文档的相对链接解析 | 通过（见 `result.md` §2 的命令输出） |
| 范围控制 | 检查是否改动契约正文、`openapi.yaml`、`src/`、`db/` | 均未改动；执行面端点与配置明确标注「未实现」 |
| 安全边界 | 搜索设计文本是否出现 token 明文 | 只出现变量名与占位符，无凭据 |

## 5 Hold（不阻塞，转待办）

| ID | 事项 | 去向 |
|---|---|---|
| `H-01` | 任务启动入口（实例登记 + 任务入队）的 HTTP 面与鉴权 | `OQ-22`，由 B4 运行/任务启动工序定 |
| `H-02` | 历史包保留与旧 `packageId` 可用性 | `scheduler/spec.md` §8、`skill/spec.md` §3.3 待定 |
| `H-03` | 只读状态端点（`executor-http-v2` §12.4）与 `inspect` 是否对外 | `scheduler/spec.md` §8 |
| `H-04` | 实例自动恢复（`blocked → active`）与跨 client 改派 | `instance/spec.md` §8、`OQ-21` |
| `H-05` | client 侧偏离（`OQ-15`–`OQ-17`）对重试分流的影响 | 保持开放，client 工序处理 |
| `H-06` | 工作组子任务：实现工序（建表、端点、测试、OpenAPI） | P1 确认后另立 |

## 6 冻结后禁止的变更（breaking change 审查）

以下改动在设计冻结后再做即为 breaking change，必须走新工序：

- 改 `packageId` 的构成或 `digest`/`etag` 的派生方式（会让在跑任务的快照失效）。
- 改 `skillSet.digest` 的规范化口径（会破坏 `S-06` 的同容器一致性判断与 client 的 digest 短路）。
- 改任务状态机的三值闭集或「首份结果为准」的接受语义。
- 改执行面错误码（`task_not_found`、`package_not_found`、`unsupported_protocol`）或状态码映射。
- 改实例粘性语义（只重派回原 client）。

## 7 确认记录（2026-11-11）

| 决策 | 用户选择 | 影响 |
|---|---|---|
| `D-01` 组件切分 | 3 组件（scheduler + instance，端点并入网关） | 已按此落规格，不改 |
| `D-02` 技能集冲突 | 入队即拒绝冲突批次 | 契约 `S-06` 天然成立；上游需按实例分组提交 |
| `D-03` 失败重派 | **不自动重派**（失败/超时直接结算） | 最省 token、收敛最快；失败任务由上游新建任务重跑；未回报仍按 `S-02` 回队，上限 3 |
| `D-04` 制品身份 | 不保留历史包，旧 `packageId` 返回 404 | 在跑任务遇技能升级失败一次；无 GC 与存储预算 |
| `D-05` 长轮询与单飞 | 挂起在 scheduler，同 client 单飞 | 单进程部署；多调度器实例不在范围 |
| `D-06` 场景状态 | 保持 `draft`，实现后转档 | 不改 `docs:check` 口径 |
| `D-07` 凭据来源 | 设计时为 `EXECUTOR_CLIENTS` 环境变量 | **已被同日裁决取代**：凭据落 `harness.client_token`（见 [`2026-11-10-executor-client-token`](../../decisions/2026-11-10-executor-client-token.md)），配置不再持有凭据 |
