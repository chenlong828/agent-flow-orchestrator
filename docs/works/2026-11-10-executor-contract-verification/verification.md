---
layer: works
module: global
status: active
updated: 2026-11-10
---

# 验证：executor-http-v2 接口一致性（调度器侧发起）

> 契约权威：本仓库 [`design/contracts/executor-http-v2.md`](../../design/contracts/executor-http-v2.md)（`protocolVersion = 2`）。
> 被验证实现：`agent-flow-client`（只读），提交 `e047e0a` + `4c8f8b0`。
> 验证脚本：[`harness/verify.ts`](harness/verify.ts)；完整输出：[`harness/run-output.txt`](harness/run-output.txt)。
> 复跑：`bun run docs/works/2026-11-10-executor-contract-verification/harness/verify.ts`。

## 1. 结论

**契约与 client 实现的接口主体一致，可以进入调度器侧实现。** 57 项断言 55 通过；2 项为 client 实现相对契约文本的偏离，均不阻塞联调，但会影响调度器的错误分流与失败重试。

| 项 | 结果 |
|---|---|
| 端点与头部（`P-01`/`P-02`/`P-03`、`X-Executor-Protocol: 2`、Bearer、`X-Request-Id`） | 一致 |
| 请求/响应字段形状（§4.1、§4.2、§5） | 一致（未知响应字段被忽略） |
| 首份结果为准、`accepted=false`、`404 task_not_found`、`finished[]` 对账 | 一致 |
| `stop` / `cancelInstances` 电平控制、退出码 | 一致 |
| 超时与 idle 看门狗、超长 prompt 拒绝、进程/技能包失败分类 | 一致（1 处错误码偏离） |
| 技能包下载、digest 短路、404、zip 安全 | 一致（1 处缺「不匹配重试一次」） |
| 契约副本（本仓库 vs client 仓库） | 仅 frontmatter 与状态说明不同，字段与语义无差异 |

2 项偏离：

| 编号 | 偏离 | 证据 | 影响 |
|---|---|---|---|
| `VD-01` | 总超时上报 `error.code = "timeout"`，契约 §4.2 约定值为 `prompt_timeout` | 验证 S4；`agent-flow-client/src/components/runtime/runtime.ts:113-114` | 调度器按 `code` 分流「任务太大」与「疑似卡死」（契约 §7 `Q2`）会漏判；`idle_timeout` 正常 |
| `VD-02` | 技能包摘要不匹配时不重试，直接 `failed(asset/checksum_mismatch)`；契约 §4.3 #2 要求「不匹配重试一次」 | 验证 S17；`agent-flow-client/src/components/assets/package-cache.ts:38-39` | 单次传输损坏即判任务失败，重试策略被上移到调度器 |

1 项契约未定义的风险：

| 编号 | 现象 | 证据 | 建议 |
|---|---|---|---|
| `VR-01` | client 首次请求技能包就带 `If-None-Match`（取自任务里的 `SkillPackage.etag`），调度器按 HTTP 语义回 `304` → client「304 但本地无缓存」直接 `failed(asset)` | 验证 S12；`agent-flow-client/src/components/gateway/gateway.ts:60-72`、`assets/package-cache.ts:36` | 二选一：契约写明「304 只在客户端已有本地副本时可回」，或 client 在无缓存时去掉条件头重试一次 |

## 2. 验证方法

1. **桩服务**：`harness/verify.ts` 按契约 §4 实现服务端三端点（含长轮询、首份结果为准、`accepted=false`、`304`、错误注入、未知字段），随机端口。
2. **真 client**：以 `bun src/cli.ts serve --config …` 启动 `agent-flow-client`，DSH 用其 `tests/fixtures/fake-acp.mjs` 替代（只验协议面，不验真实模型行为）。
3. **断言**：57 项 PASS/FAIL，全部基于实际 HTTP 请求体、响应体与退出码，不检查存在性。
4. **交叉证据**：`agent-flow-client` 自身测试套件 `bun test` = 106 pass / 0 fail（含 `v2-serve` 的 stop、cancel、`finished[]`、启动补报、401 退出等场景）。

> 说明：首次在本会话沙箱内跑 client 测试时 `UC-14 信号收口` 失败，原因是用例把默认 `DSH_HOME`/`state.root` 写到 client 仓库根，被会话沙箱拒绝；提权重跑后 106/106 通过。属环境问题，不是 client 缺陷。

## 3. 条款矩阵

### 3.1 端点

| 条款 | 契约要求 | 实现 / 验证 | 结论 |
|---|---|---|---|
| `P-01` 路径与方法 | `POST /api/v1/executor/poll` | `gateway.ts:40`、S1 | 符合 |
| `P-01` 请求 `capacity.free` | `maxConcurrent - running.length`，≥0 | `serve-context.ts:48`、S1/S14 | 符合 |
| `P-01` 请求 `running[]` | 必须含全部在跑任务；空也带 `[]` | `serve-context.ts:37-41`、S1/S3/S13 | 符合 |
| `P-01` 请求 `finished[]` | 已有结果未确认；空也带 `[]` | `serve-context.ts:42-46`、S2/S13 | 符合 |
| `P-01` `lastEventAt`（可选） | 最近一次 ACP 事件时间 | 未发送（`serve-context.ts:37-41`） | 未实现（可选，记录为 `VD-06`） |
| `P-01` 响应 `tasks[]` | ≤ `min(free, 10)`；服务端责任 | client 不设防，按收到即执行（S16 验证只依赖服务端） | 符合契约分工 |
| `P-01` 响应 `stop` | 电平信号；完成手上任务后退出 | `serve-loops.ts:44`、S1 | 符合（退出 0） |
| `P-01` 响应 `cancelInstances` | 中止实例任务，丢弃同批 `tasks` 中该实例条目 | `serve-loops.ts:41-47`、S6/S16 | 符合 |
| `P-01` 响应 `nextPollAfterMs` | 0 = 立即再拉 | `serve-loops.ts:22`（下限 10ms） | 符合（S15） |
| `P-02` 路径 | `POST /api/v1/executor/tasks/{taskId}/result` | `gateway.ts:47`、S1 | 符合 |
| `P-02` 请求字段 | §4.2/§5 全部字段 | `types.ts:37-49`、S1 | 符合 |
| `P-02` 首份为准 / `accepted=false` | 后续只回 false，client 丢弃 | `serve-loops.ts:108-117`、S2 | 符合 |
| `P-02` `404 task_not_found` | 丢弃不重试 | `gateway.ts:51-57` | 符合（client 单测覆盖） |
| `P-02` 结果先落盘 | 先 settled 再上报 | `executor.ts:167`、`serve.ts:39-42`、S13 | 符合 |
| `P-03` 路径/条件头 | `GET …/skill-packages/{packageId}`、`If-None-Match` | `gateway.ts:60-73`、S10 | 符合 |
| `P-03` 200/304/404 | 校验摘要；304 用缓存；404 不重试 | `package-cache.ts:23-45`、S10/S11/S12 | 部分符合（`VD-02`/`VR-01`） |
| `P-03` digest 短路 | 同 digest 不重复安装 | `assets.ts:58-62`、S10 | 符合 |

### 3.2 客户端承诺

| 条款 | 要求 | 证据 | 结论 |
|---|---|---|---|
| `C-01` | 先登记 in-flight 再 poll；`running`/`finished` 完整 | `serve-loops.ts:52-73`、S1/S13 | 符合 |
| `C-02` | 一任务一 session；`free` 如实 | `executor.ts:144`、S1/S14 | 符合 |
| `C-03` | 先装技能再 prompt；同 digest 短路；同容器安装临界区 | `executor.ts:148`、`assets.ts:47-56`、S10 | 符合 |
| `C-04` | 结果先落盘再上报；失败只重试传输；重启补报 | `executor.ts:167`、`serve-loops.ts:98-132`、`serve.ts:39-42`、S13 | 符合 |
| `C-05` | 超时终止：cancel → close → `SIGKILL` 进程组 | `runtime.ts:111-118`、`runtime.ts:135-141` | 部分符合（见 `VD-04`） |
| `C-06` | idle 看门狗默认关闭，可配置 | `config.ts:183-190`（默认 0）、S5 | 符合 |
| `C-07` | `stop` 优雅退出 0；`cancelInstances` 报 `cancelled`；二次信号强退 | `serve-context.ts:55-61`、S1/S6 | 符合 |
| `C-08` | 只传控制信息；超 `maxResultBytes` 截断 | `result.ts:43-57`、`executor.ts:50` | 符合（client 单测覆盖截断） |
| `C-09` | 启动清理残留进程组，不杀别的实例 | `serve.ts:35-38`、`runtime.ts:171-185` | 符合 |

### 3.3 常量与错误

| 常量 / 约定 | 契约 | 实现 | 结论 |
|---|---|---|---|
| `maxResultBytes` | 262144 | `executor.ts:50`（serve 传入同值） | 符合 |
| `maxPromptBytes` | 1048576 | `serve-loops.ts:6`、S7 | 符合 |
| `maxSkillPackageBytes` | 67108864 | `assets.ts:19` | 符合 |
| `maxTasksPerPoll` / `pollHoldMs` / `clientSilentMs` / `resultGraceMs` | 服务端常量 | 只在服务端生效 | 不适用（client 侧无实现） |
| `clientPollTimeoutMs` | 40000 | `gateway.ts:23` | 符合 |
| HTTP 错误码 | 400/401/404/413/500/503 | `errors.ts:34-41` | 符合 |
| `X-Executor-Protocol` 不匹配 | 400 → 停止退出 | `errors.ts:29-31`、S9（退出 3） | 符合 |
| 401 | 停止退出、非 0 | S8（退出 3） | 符合 |
| `status` / `error.class` 闭集 | 4 值 / 8 值 | `types.ts:14-24` | 符合 |
| 结果错误码约定 | `prompt_timeout` / `idle_timeout` | `runtime.ts:113-114` | 偏离（`VD-01`） |

## 4. 其他静态发现（未进断言，建议清理或记待办）

| 编号 | 发现 | 证据 | 级别 |
|---|---|---|---|
| `VD-03` | client 完全忽略 `SkillPackage.downloadUrl`，只按 `packageId` 走 `P-03`（`serve-compose.ts:59-70` 里用空串占位该字段）。若调度器以后用 `downloadUrl` 指向对象存储/签名 URL，client 不会跟随 | `package-source.ts:23-29`、`serve-compose.ts:59-70` | 需修订契约或 client |
| `VD-04` | `C-05` 要求超时后 `SIGKILL` 进程组，但 client 只在「该实例没有其它 session」时才杀进程组（`runtime.ts:135-141`）。`§9` 又允许同实例并发，两条条款互相矛盾；client 选择了保留并发、避免误杀 | `runtime.ts:132-141`、契约 `C-05` vs `§9` | 契约需修订 |
| `VD-05` | client 把所有 `400` 都归为 `unsupported_protocol` 并终止（`errors.ts:34-41` 先查信封、再按状态码兜底）。契约 §3 的「未知请求字段返回 400」没有专门码，未来严格服务端回 400 会让 client 直接退出 | `errors.ts:43-64` | 契约需明确 400 的两种语义 |
| `VD-06` | `RunningTask.lastEventAt` 未实现（`serve-context.ts:37-41`）。契约标为可选，但 `2026-11-10-execution-semantics-review` 的 `SH-04` 认为它对派发排序有价值 | 同上 | 后续增强 |
| `VD-07` | 声明 `sizeBytes` 与实际字节数未比对；只做 `sizeBytes > 64MiB` 预检 | `package-cache.ts:33` | 低 |
| `VD-08` | client 仍保留 v1 遗留：`executor/container-guard.ts` 无调用点、`ExitCode.runSuperseded` 无使用、`config.ts:205` 的 `PROTOCOL_VERSION = "2026-11-07.1"` 只写进未被消费的 `AppConfig.scheduler.protocolVersion` | 见左列 | 清理建议（client 侧） |

## 5. 未覆盖 / 不适用

| 项 | 原因 |
|---|---|
| 静默回队（`clientSilentMs`）、超时回队（`timeoutMs + resultGraceMs`）、`S-03` 未确认重发 | 调度器侧职责，本仓库尚无实现；只能用桩模拟，属未来调度器实现工序的验收 |
| 长轮询 30s 挂起、并发超卖防护 | 服务端行为；本次桩用 150ms 长轮询验证 client 的等待与 `nextPollAfterMs` |
| 1000 任务吞吐、真实 DSH/模型行为、进程组残留（`kill -0`） | 用 client 全套测试与 fake ACP 交叉覆盖；真实环境联调待调度器实现后做 |
| 第三方签名 URL（`downloadUrl` 跨 host、不发 `Authorization`） | client 不消费 `downloadUrl`（`VD-03`） |

## 6. 建议

**契约修订（调度器侧编辑，2 处）**

1. `C-05` 与 `§9` 统一：并发同实例时超时只终止该 session，进程组回收移到实例无会话或实例回收时；把这条写成契约，而不是留给实现猜（`VD-04`）。
2. `§3` 明确 `400` 的两种来源：`unsupported_protocol`（版本不匹配，终止）与其他 400（请求非法，可重试或按错误码处理），避免 client 一律终止（`VD-05`）。

**client 侧修复（后续工序，不在本仓库）**

1. 总超时报 `prompt_timeout`（`VD-01`）；
2. 摘要不匹配重试一次（`VD-02`）；
3. 无本地缓存时不带 `If-None-Match`，或 304 后去条件头重试（`VR-01`）；
4. 清理 v1 遗留（`VD-08`）。
