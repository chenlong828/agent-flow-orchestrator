---
layer: works
module: run
status: frozen
updated: 2026-11-20
procedure: 2026-11-19-run-start-images
level: P1
---

# 设计提案：启动运行支持图片初始资料

> 状态：**P1 设计已冻结并实现（编排侧 2026-11-19）**。本文保留设计与取舍；实现结果见 [`result.md`](result.md)。client 侧已实现，UI 侧待按 [`ui-proposal.md`](ui-proposal.md) 立项。
>
> 一句话：**UI 粘贴图片并在本地暂存 → 点「发起运行」时逐张上传为暂存初始资料 → 启动请求引用 `inputId` → 编排把暂存资料绑定到 run → client 拉取图片写入 `<task-space>/inputs/` → 各节点用 `read_image` 查看。**
>
> **2026-11-19 用户裁决**：client 确认支持图片，必须补模型 `input` 声明；首期只支持图片。
>
> **2026-11-19 UI 实施修订**：上传时机由「粘贴即上传」改为「提交时上传」（点「发起运行」后逐张上传，全部成功再启动）；后端契约不变，服务端只认 `inputId`。见 [UI result](../../../../../agent-flow-ui/docs/history/works/2026-11-19-run-start-images/result.md)。
>
> **2026-11-19 client 已实现**：`T-CLI-IMG-01`–`07` 落地，`read_image` 实测通过；真实联调待编排侧 `EXE-06/07`。见 [client result](../../../../../agent-flow-client/docs/works/2026-11-19-run-start-inputs/result.md)。

## 0 结论

### 0.1 推荐链路

1. **UI**：发起运行弹窗支持 `paste` / 拖放/选择图片；提交前只在浏览器本地暂存（缩略图、校验、删除），不产生服务端状态。点「发起运行」后按列表顺序逐张上传到 `POST /api/v1/run-inputs`（multipart，单文件，并发 3），全部成功后把 `inputId` 列表放进原 `POST /api/v1/workflows/{id}/runs` JSON；上传或启动失败时回滚删除已上传项。
2. **编排**：`POST /run-inputs` 校验图片类型/体积/文件名，把字节写入 `archive.root/inputs/<inputId>`，元数据写 `run_input`（`state=staged`）；启动时把选中的暂存行在事务里绑定到 run（`state=bound`），prompt 增加 `[初始资料]` 块，列出文件名、类型、大小与 `<task-space>/inputs/` 绝对路径。
3. **client**：poll 时声明 `X-Executor-Capabilities: run-inputs`；拿到任务后按 `runId` 调新执行面端点列出并下载初始资料，校验 SHA-256，写入 `<task-space>/inputs/`，再建 session。
4. **模型**：首节点按 prompt 把清单写入 `intent.md` 的「初始资料」一节；需要看图时调用 `read_image` 读取对应绝对路径。后续节点共享同一个 task-space。
5. **旧 client**：启动带图片的 run 时，若 client 未声明能力，返回 `409 client_unsupported`，不建 run、不绑定暂存项（已上传的图仍在暂存区，升级 client 后可重试启动），避免「图片静默丢失、模型凭空猜测」。

### 0.2 三条硬结论

1. **task-space 只能由 client 写**。`REQ-0001` §4 明确「服务端不访问 client 工作区」，`task_space_path` 由服务端生成、目录由 client 创建（[`run/spec.md`](../../../design/components/run/spec.md) §2、[`executor-http-v3`](../../../design/contracts/executor-http-v3.md) §4.1 #4）。因此图片字节必须经 client 之手落到 task-space；编排服务端直接写 `workspacePath` 的方案在远端部署下不成立。
2. **图片不能进 prompt**。`maxPromptBytes` 是 1 MiB，`intent_markdown` 上限 256 KiB（[`run/spec.md`](../../../design/components/run/spec.md) §2），且 client 的 ACP prompt 只发 `{type:"text"}`（[`runtime.ts`](../../../../../agent-flow-client/src/components/runtime/runtime.ts) 第 138 行）。图片只能作为文件落在 task-space，再由模型用 `read_image` 按需读取。
3. **视觉能力是前置条件，用户已确认 client 支持**。client 的 ACP `initialize` 当前报 `promptCapabilities.image=false`（[`summary.protocol.jsonl`](../../../../../agent-flow-client/docs/history/works/2026-11-14-acp-progress-feedback/probe/summary.protocol.jsonl) 第 2 行）；client 的 pi-ai 模型条目只写了 `{ id, name }`，没有声明 `input: ["text","image"]`（[`profile.ts`](../../../../../agent-flow-client/src/components/runtime/profile.ts) 第 47 行）。`dsh-base` 已挂载 `attachment-local`，当前最可能的直接原因是**路由未声明图片输入**。本机同一模型 id 的会话已能读图（[`vision-probe.md`](probe/vision-probe.md)），项目技能 `swift-ui-probe` 也依赖 `read_image`。**按用户裁决：client 补 `input: ["text","image"]` 并实测 `read_image`，作为实施第一步。**

### 0.3 决策速览

| # | 决策 | 结论 | 理由摘要 |
|---|---|---|---|
| `D-01` | 上传形态 | **提交时上传（暂存 `run_input`，启动引用 `inputId`）** | UI 实施裁决；提交前零服务端状态，上传/启动失败回滚重传；暂存行不设 TTL，未删除的孤儿需运维清理 |
| `D-02` | 编排 → client 传输 | **client 主动拉取新执行面端点** | 不把 base64 塞进 poll/TaskRequest；可重试、可校验、可幂等 |
| `D-03` | 旧 client 处理 | **`X-Executor-Capabilities` 头 + 启动闸门** | 加法变更、与现有 `X-Observability-Url` 风格一致；不静默丢图；不升协议版本 |
| `D-04` | 模型如何看到图 | **prompt 列清单 + `read_image` 读文件** | ACP 当前不收图；文件对所有节点稳定可见；不复制字节进上下文 |
| `D-05` | 视觉能力 | **client 模型条目声明 `input: ["text","image"]` 并实测（已裁决）** | 本机同模型已能读图；项目既有技能已依赖 `read_image` |
| `D-06` | 运行详情预览 | **`GET /runs/{id}/inputs` + `/content`（已定，首期带）** | 用户可确认图片确实进入 task-space；BFF 现有二进制转发可复用 |
| `D-07` | 首期范围 | **只支持图片（PNG/JPEG/WebP/GIF）** | 校验、预览、模型读图路径都明确；PDF/文本等通用文件另立需求 |
| `D-08` | 上限 | **已定：≤8 张、单张 ≤8 MiB、合计 ≤20 MiB** | 单请求只传一张，BFF 25 MiB 足够；图片会被 DSH 归一化到像素预算 |
| `D-09` | 存储与保留 | `archive.root/inputs/<inputId>`；`staged` 不设 TTL，绑定前可删除；`bound` 随 run 保留 | 与现有 `FileStore`、归档根一致；绑定不搬字节；清理沿用 `OQ-27` |
| `D-10` | task-space 内位置 | **`<task-space>/inputs/`** | 与 `intent.md` 并列、语义明确；归档 tar 自动包含 |

## 1 现状与证据

### 1.1 启动链路（纯文本）

1. UI 的「发起运行」弹窗在 [`instances.js`](../../../../../agent-flow-ui/assets/js/pages/instances.js) 的 `onOk` 里组装 `{ harnessId, workspacePath, intentMarkdown, autoConfirm }`，经 [`run/data.js`](../../../../../agent-flow-ui/assets/js/run/data.js) 的 `start()` 调 `POST /api/v1/workflows/{id}/runs`。
2. 网关 [`routes/run.ts`](../../../../src/components/http-gateway/routes/run.ts) 的 `startRun` 只读 JSON（`RUN_START_FIELDS` 白名单：[`fields.ts`](../../../../src/components/http-gateway/fields.ts)），校验字段后调 `runService.start`。
3. [`commands.ts`](../../../../src/components/run/commands.ts) 的 `start`：校验工作流/图/专家/Harness/实例，生成 `taskSpacePath = <workspacePath>/task-spaces/<YYYYMMDD-HHmmss>`（[`validate.ts`](../../../../src/components/run/validate.ts) 第 37 行），单事务插入 `workflow_run` 与首节点，随后 `advance`。
4. [`prompt.ts`](../../../../src/components/run/prompt.ts) 组装纯文本 prompt：task-space 路径、写/读 `intent.md`、`[本次进入]`、专家块；首节点追加 `[启动诉求原文]`。
5. client 轮询取任务，`ensureTaskSpace` 只 `mkdir -p`（[`workspace.ts`](../../../../../agent-flow-client/src/components/workspace/workspace.ts) 第 94–106 行），然后 `session/new`、发 prompt；`intent.md` 由首节点模型按 prompt 写入。
6. 节点结算后继续下一个 seq 节点；run 结束时 client 把整个 task-space 打 tar.gz 上传归档（[`executor-http-v3`](../../../design/contracts/executor-http-v3.md) §4.5 / `P-05`）。

### 1.2 硬约束

- **服务端不访问 client 工作区**（[`REQ-0001`](../../../requirements/REQ-0001-workflow-run-orchestration.md) §4）。`CMP-run` 的禁止依赖还包括「发起对 client 的网络请求」（[`run/spec.md`](../../../design/components/run/spec.md) §5）。
- **task-space 路径由服务端生成、目录由 client 创建**，client 只校验路径在工作区内（`P-01` §4.1 #4）。
- **prompt 1 MiB 上限**，`intent.md` 256 KiB；prompt 是 opaque 文本，不能塞图片字节。
- **同一工作区同一时刻最多一个活跃 run**（`run_conflict`），所以初始资料天然按 run 隔离。
- **归档包含整个 task-space**，`inputs/` 自动进归档；`maxArchiveBytes=512 MiB`、`maxArchiveEntries=100000`（[`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) §4.3）。

### 1.3 DSH 的做法（参考，不照搬）

- 输入框粘贴/拖放图片后进入草稿附件栏；提交时浏览器把 Blob 上传到会话路由，Host 侧**校验并归一化**（8-bit sRGB/sRGBA、PNG/JPEG/WebP/GIF），再以 `ImageBlock` 引用发给模型（`@deepseek-ai/dsh-attachment`、`dsh-client-ui-attachment`、`dsh-client-file-upload` 的 README）。
- 非图片文件**逐字节保存**，消息里只记录文件名、大小、摘要和只读路径，模型需要时用文件工具读（同一 README）。
- DSH 的图片是「模型直接收到的图像内容块」，通用文件才是「路径 + 按需读取」。本项目当前 client 的 ACP 路由未声明图片输入（`image=false`）；即使补齐声明，图片内容块也只覆盖首轮 prompt，而初始资料需要被所有节点复用。**所以采用 DSH 的通用文件模式（路径），而不是 ImageBlock 模式**；将来若需要在首轮直接给图，可在不改变文件落点的前提下增强。

### 1.4 视觉能力现状（关键）

| 事实 | 证据 | 判定 |
|---|---|---|
| client 的 ACP `initialize` 报 `promptCapabilities.image=false` | [`summary.protocol.jsonl`](../../../../../agent-flow-client/docs/history/works/2026-11-14-acp-progress-feedback/probe/summary.protocol.jsonl) | 已确认 |
| client 的模型条目只有 `{ id, name }`，未声明 `input` | [`profile.ts`](../../../../../agent-flow-client/src/components/runtime/profile.ts) 第 47 行 | 已确认 |
| `read_image` 在「附件存储已挂载 + 路由声明图片输入」时才可执行 | `@deepseek-ai/dsh-tool-fs` README（`read_image` 一节） | 已确认 |
| 本机同一模型 id 的会话可读取 PNG 并描述内容 | [`vision-probe.md`](probe/vision-probe.md) | 已确认（本会话） |
| client 的 `hundsun-public` 路由是否与上述会话同一条、后端是否真支持图片 | 未实测 | **待验证** |
| `read_image` 是否出现在 `--profile acp` 会话的工具目录 | 未实测；`dsh-base` 挂载 `attachment-local` 与 `tool-fs`，预期在 | **待验证** |

补充：项目技能 `swift-ui-probe` 明确写「模型用 harness 的 `read_image` 直接读图判断」（[`SKILL.md`](../../../../scripts/seed-skills/swift-ui-probe/SKILL.md)）。如果 client 路由始终不声明图片输入，这个技能在真实运行里会失败；本功能顺带暴露并修复这条配置缺口。

### 1.5 可复用的原语

| 原语 | 现状 | 用途 |
|---|---|---|
| multipart | Skill 草稿上传已用 `request.formData()`（[`skill-drafts.ts`](../../../../src/components/http-gateway/routes/skill-drafts.ts)） | `POST /run-inputs` 的单文件 multipart 解析有先例 |
| `FileStore` | `put/get/head/list/delete/move` 端口（[`ports.ts`](../../../../src/core/kernel/ports.ts)） | 图片字节落 `archive.root` |
| 执行面鉴权 | `X-Executor-Protocol`、Bearer/`X-Client-Id`、`EXECUTOR_AUTH=off` 旁路 | 新执行面端点沿用 |
| 能力自报 | `X-Observability-Url` 已在 poll 头里做加法（[`executor-http-v3`](../../../design/contracts/executor-http-v3.md) §3） | `X-Executor-Capabilities` 沿用同一风格 |
| presence | `SchedulerService.presence(clientIds)` 返回 `lastPollAt/free/running`（[`scheduler/service.ts`](../../../../src/components/scheduler/service.ts)） | 启动时查 client 能力 |
| BFF | 已转发 `multipart/form-data`，默认 25 MiB、上传超时 120 s（[`bff/index.js`](../../../../../agent-flow-ui/bff/index.js)） | 逐张上传无需改超时/白名单 |
| UI 请求层 | `shared/http.js` 已支持 `FormData` body；上传进度需一个小的 XHR 封装 | 启动提交复用现有请求层，上传单独封装 |
| `runId` | `TaskRequest.runId?` 已落地（文件浏览工序） | client 可按 run 拉取初始资料，不必改任务信封 |

## 2 目标与非目标

**目标**：一次启动可以带 0–8 张图片；图片在 run 生命周期内稳定保存在 `<task-space>/inputs/`；prompt 与 `intent.md` 能让各节点发现这些图片；模型在路由支持图片时可读取；旧 client 不会被静默糊弄；失败有稳定错误码。

**非目标（本期）**：

- 不做断点续传、多图打包上传或上传队列持久化；每张图独立暂存，已上传但未绑定的暂存项不会自动过期，需 UI DELETE 或运维清理。
- 不做通用文件（PDF、docx、代码文件）上传；只做图片。
- 不做图片编辑、裁剪、旋转、OCR、缩略图服务；原图存储，展示由 UI 缩放。
- 不做运行结束后从归档浏览图片（沿用 `OQ-34` 的结论）。
- 不做管理面鉴权；产品端点仍无鉴权，生产前另立工序。
- 不做多模态模型切换的产品化（只把 client 配置与验证列为前置条件）。
- 不改 `confirm` / `review` 的判定语义；初始资料只是 task-space 里的文件。

## 3 总体方案

```text
agent-flow-ui              agent-flow-orchaster                 agent-flow-client
─────────────              ────────────────────                 ─────────────────
粘贴/拖放/选择图片
  │ 缩略图 + 本地校验（提交前零服务端状态）
  │
  ├─ 点「发起运行」→ 逐张 POST /run-inputs（并发 3）
  │     ├─ 校验图片（魔数/体积/文件名）
  │     ├─ 写 FileStore：inputs/<inputId>
  │     └─ 写 run_input（state=staged）
  │  返回 inputId；全部成功才继续
  │
  └─ POST /workflows/{id}/runs（JSON，inputs:[{inputId}…]）
        ├─ 校验暂存行：存在/未绑定/数量
        ├─ 事务绑定：state=bound、run_id、position、name 去重
        ├─ 建 run + 首节点 + prompt [初始资料]
        └─ 启动闸门：client 是否声明 run-inputs
                                   │
                                   │  poll（X-Executor-Capabilities: run-inputs）
                                   │◀──────────────────────────────
                                   │  task（含 runId）
                                   │──────────────────────────────▶
                                   │                                GET /executor/runs/{runId}/inputs
                                   │◀───────────────────────────────
                                   │                                GET .../inputs/{inputId}（逐张）
                                   │◀───────────────────────────────
                                   │                                写入 <task-space>/inputs/
                                   │                                session/new → prompt
                                   │                                read_image(<task-space>/inputs/…)
```

设计要点：

- **一份数据只有一个写入口**：编排写 `run_input` 与服务端副本；client 写 task-space 内的 `inputs/`；两者用 `inputId + sha256` 对齐，client 写入前校验摘要。
- **路径稳定**：`<task-space>/inputs/` 在整个 run 内不变，后续节点、回退重跑、`resumeNode` 都复用同一份文件。
- **幂等**：client 每次任务开始先列一次 run inputs；已存在且大小一致的文件跳过下载。重派、续跑、重启都不会重复写。
- **失败显式**：能力缺失在启动时拒绝；下载/校验失败让任务以 `asset` 类错误失败，不建 session、不让模型在缺少资料的情况下继续。

## 4 关键决策与备选

### `D-01` 上传形态（UI 实施裁决：提交时上传）

| 方案 | 做法 | 结论 |
|---|---|---|
| **A. 提交时上传（选定，UI 已实现）** | 点「发起运行」后 UI 按列表顺序逐张 `POST /run-inputs`（并发 3），全部成功后才提交启动 JSON；上传失败/启动失败回滚删除已上传项 | 提交前不产生服务端状态；本地可自由增删预览；失败重传；暂存不设 TTL |
| B. 粘贴即上传（旧提案） | 每张图粘贴时立即上传并保留暂存 | **被 UI 实施裁决取代**：后端契约相同，但 UI 在提交前不产生暂存项；旧提案保留作对照 |
| C. 启动请求 multipart | 图片随启动请求一次性上传 | **不采用**：契约已按独立暂存端点实现，且 multipart 不适合逐张进度/重试 |
| D. JSON 内 base64 | `images:[{name,dataBase64}]` | **否决**：33% 膨胀，20 MiB 原图变 ~27 MiB JSON，内存与解析都更差 |
| E. 服务端直接写工作区 | 按 `workspacePath` 写 | **否决**：违反 `REQ-0001` §4；远端部署不可用 |

**选 A** 的实现要点：

- 上传在**点「发起运行」时**触发，不在粘贴时触发；UI 先做本地校验（类型/单张/数量/合计），再逐张上传。
- 服务端 `POST /run-inputs` 仍逐张校验（魔数、单张 ≤8 MiB、文件名清洗），写 `inputs/<inputId>` 与 `run_input(state=staged)`；对上传时机不感知。
- 全部上传成功后才提交 `inputs:[{inputId}]`；绑定失败（未知/已绑定/超 8 张/合计超限）整体回滚，暂存行保持 `staged`。
- UI 在部分上传失败或启动失败时回滚：`DELETE` 已上传项，本地保留 File 供重试；服务端仍保留未删除的 staged 孤儿。
- **暂存不设 TTL**：`staged` 行与对象一直保留，直到被启动绑定或被 `DELETE /run-inputs/{inputId}` 删除。
- 弹窗关闭时 UI 对已上传但未绑定的项调 `DELETE`；失败则暂存项留存，需运维清理。

### `D-02` 编排 → client 的传输

| 方案 | 做法 | 结论 |
|---|---|---|
| **A. client 拉取执行面端点（推荐）** | poll 只给 `runId`（已有）；client 调 `EXE-06/07` 列表 + 下载 | 不放大 poll 载荷；可重试/校验/幂等；鉴权沿用执行面 |
| B. base64 塞进 `TaskRequest` | poll 响应里带图片字节 | **否决**：每次派发/重派都放大响应；20 MiB 进 JSON；调度器要持有字节 |
| C. prompt 里给 URL，模型自己 `curl` | 让模型执行下载 | **否决**：产品端点无鉴权、暴露图片；依赖模型执行顺序；远端网络/防火墙不可控 |
| D. 与 server 共享挂载 | server 写共享盘，client 直接读 | **否决**：只在同机成立，破坏「server 不访问工作区」边界 |

### `D-03` 旧 client 与能力协商

`X-Executor-Protocol` 是精确等于 `3` 的硬闸门（[`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) §4.3）；升 `4` 会让所有旧 client 的 poll 直接 400，影响面远大于本功能。

| 方案 | 结论 |
|---|---|
| **A. poll 加可选 `X-Executor-Capabilities: run-inputs`（推荐）** | 旧服务端忽略未知头；新服务端把能力记到 presence；启动带图时查 presence，缺失 → `409 client_unsupported`。加法变更，不动协议版本 |
| B. 升 `X-Executor-Protocol: 4` | **否决**：全量旧 client 失效；部署顺序与回滚耦合进协议；本功能不需要 |
| C. 不做闸门 | **否决**：旧 client 会照常执行但从不下载，prompt 指向不存在的文件，模型只能猜 |

启动闸门的判定（`CMP-run.start`，仅当 `inputs.length > 0`）：

1. `harness.clientId` 查 `scheduler.presence([clientId])`；
2. 无 presence（服务重启后 client 还没 poll）或能力列表不含 `run-inputs` → `409 client_unsupported`，`details.capability="run-inputs"`、`details.reason="client_not_seen" | "capability_missing"`；
3. 通过后才把暂存行绑定到 run、建 run。

**启动失败（能力缺失、run 冲突、图非法等）不消耗暂存行**：它们保持 `staged`，用户升级 client 或处理冲突后可直接重试启动，不必重新上传；暂存项不会自动过期。

> 已知边界：client 在「启动通过」与「任务派发」之间被换回旧版本，属于极端情况；本期接受，不做派发时二次校验。若要求绝对严格，可在 `task` 表加 `inputs_required` 并在派发时复查，代价是一次 schema 变更。

### `D-04` 模型如何看到图

| 方案 | 结论 |
|---|---|
| **A. task-space 文件 + prompt 清单 + `read_image`（推荐）** | 文件对所有节点稳定；上下文按需消耗；与项目既有 `swift-ui-probe` 的读图方式一致 |
| B. 首轮 prompt 注入 ImageBlock | **本期不可行**：client ACP 当前 `image=false`；且要改 client 的 prompt 组装；后续可作为增强 |
| C. prompt 内 base64 / Markdown data URI | **否决**：1 MiB prompt 上限；模型不会可靠解码 |

### `D-05` 视觉能力（前置条件）

- client 的 pi-ai 模型条目改为：

  ```ts
  models: [{ id: model.model, name: model.model, input: ["text", "image"] }]
  ```

  该字段在 `PiAiModelProfile` 上叫 `input`（候选 `PiAiModality[]`；路由级还有 `defaultInput`，见 `@deepseek-ai/dsh-llm-pi-ai` 的配置目录）。
- 用一条真实任务跑 `read_image(<task-space>/inputs/…)`，确认模型能描述图片；同时确认 ACP `initialize` 的 `promptCapabilities.image` 变为 `true`（可选）。
- 若后端实际不支持图片，`read_image` 会在 provider 处失败；此时应停止本功能，或改用支持视觉的模型路由，而不是把图片当摆设。

### `D-06` 运行详情预览

- 新增 `GET /runs/{id}/inputs`（元数据）与 `GET /runs/{id}/inputs/{inputId}/content`（二进制）。UI 在运行详情展示「初始资料」缩略图，证明文件确实进入了 run。
- UI BFF 的 `forwardJson` 已经按响应头转发二进制（复制 `content-type`/`content-disposition`，缓冲后发送），路径在 `/api/v1/` 白名单内，**不需要新增流式白名单**；单张 ≤8 MiB，缓冲可接受。
- 如果首期想缩小范围，可以只做元数据列表、不做缩略图；但「用户能确认图片进了 task-space」是这项功能信任感的一部分，建议一起做。

### `D-07` 首期范围

只做图片。通用文件会引入「文本按行读 / 二进制拒绝 / 压缩包 / 病毒扫描」等分叉，且与 `read_image` 的消费方式不同；等图片链路稳定后另立需求。

### `D-08` 上限

| 项 | 值 | 理由 |
|---|---|---|
| 文件数 | 8 | 覆盖常见截图/设计稿批次；prompt 清单不会过长 |
| 单张 | 8 MiB | 常规 PNG 截图/照片足够；DSH 会按像素预算归一化 |
| 合计 | 20 MiB | 单请求只传一张（≤8 MiB），BFF 25 MiB 上限足够；合计在绑定时校验 |
| 类型 | PNG / JPEG / WebP / GIF | 与 `dsh-attachment`/`read_image` 支持范围一致；**不接受 SVG**（XSS 风险） |

常量放 `[run]` 配置（`max_input_files`、`max_input_file_bytes`、`max_input_bytes`），不写成散落魔法数；默认值与上表一致。

### `D-09` 存储与保留

- 服务端副本：`<archive.root>/inputs/<inputId>`（无扩展名，类型在 `run_input.media_type`）。暂存与已绑定共用一个 key 空间，绑定只改库里的 `run_id/state`，不搬文件，避免「移动成功、事务失败」的二段不一致。
- 未绑定（`staged`）的行不设过期：由 UI `DELETE` 或运维清理；已绑定（`bound`）的随 run 保留。
- 归档包里已包含 `<task-space>/inputs/`，服务端副本是「下载源 + 详情预览源」；run 结束后是否删除，沿用 `OQ-27` 的保留期结论，本期不新增清理策略。删除副本不影响归档内的文件。
- `run_input.store_key` 唯一；`run_id` 外键 `on delete cascade`（当前没有删除 run 的端点，保留级联语义）。

### `D-10` task-space 内位置

`<task-space>/inputs/<sanitized-name>`。`intent.md` 已在 task-space 根；`inputs/` 不与其他产物混放，归档/浏览/清理都容易识别。模型清单里写绝对路径，避免相对路径歧义。

## 5 契约草案

### 5.1 产品面

#### 5.1.1 暂存上传与删除

| ID | 方法 | 路径 | 用途 | 成功 |
|---|---|---|---|---|
| `API-57` | POST | `/api/v1/run-inputs` | 上传单张图片为暂存初始资料 | 201 `RunInputStaged` |
| `API-58` | DELETE | `/api/v1/run-inputs/{inputId}` | 取消/删除尚未绑定的暂存项 | 204 |

`POST /run-inputs`：

- `Content-Type: multipart/form-data`，字段 `file`（单个图片文件，必填）；不接收路径、不接收 `runId`。
- 上传即校验：魔数 ∈ PNG/JPEG/WebP/GIF、单张 ≤8 MiB、文件名清洗；通过后写 `archive.root/inputs/<inputId>` 与 `run_input(state=staged)`。
- 响应 201：

```json
{
  "inputId": "0193f0aa-...",
  "name": "01-界面截图.png",
  "mediaType": "image/png",
  "sizeBytes": 123456,
  "sha256": "…64 位…",
  "createdAt": "2026-11-19T09:00:00.000Z"
}
```

- 错误：`415 unsupported_media_type`（不是 multipart）；`400 validation_error`（类型/魔数/文件名非法）；`413 payload_too_large`（`details.limit=run_input_file_bytes`）；存储或数据库失败 `500`/`503`。
- 每张图一个请求，UI 可并发 1–3 个；顺序由 UI 本地列表维护，服务端在绑定时按启动请求的数组顺序赋 `position`。

`DELETE /run-inputs/{inputId}`：

- 仅允许 `state=staged`；成功 204，同时删对象与行。
- 已绑定 → `409 invalid_state`；不存在 → `404 input_not_found`。
- 幂等语义：重复删除已不存在的暂存项返回 404，UI 对 404 视作已清理，不报错。

#### 5.1.2 启动请求引用暂存项（`API-42`）

`POST /api/v1/workflows/{id}/runs` 仍为 `application/json`，新增可选字段：

```json
{
  "harnessId": "…",
  "workspacePath": "/abs/workspace",
  "intentMarkdown": "# …",
  "autoConfirm": false,
  "inputs": [{ "inputId": "0193f0aa-…" }, { "inputId": "0193f0ab-…" }]
}
```

- `inputs` 缺省/空数组 = 不带图片，行为与现状完全一致。
- 数量 ≤8；`inputId` 不得重复；每个必须是 `staged`、属于当前服务端的行。
- 启动事务内按数组顺序绑定：`state=bound`、`run_id`、`position=1..N`、`bound_at=now`；同一 run 内重名按 `-2`/`-3` 去重后写最终 `name`。
- 任一 `inputId` 未知/已绑定 → `400 validation_error`（`details.field=inputs[i]`，`reason=unknown_input|already_bound|too_many`），事务回滚，**所有暂存行保持 staged**。
- 启动成功后响应不变：`201 { runId }` + `Location`；暂存行已绑定，UI 不再持有删除权。
- 能力检查（`D-03`）在绑定前：`409 client_unsupported` 时同样保留 staged 行。

#### 5.1.3 查询已绑定初始资料

| ID | 方法 | 路径 | 成功 | 说明 |
|---|---|---|---|---|
| `API-55` | GET | `/api/v1/runs/{id}/inputs` | 200 `{ items: RunInputView[] }` | 运行详情/确认页展示用；无图片返回 `[]` |
| `API-56` | GET | `/api/v1/runs/{id}/inputs/{inputId}/content` | 200 二进制 | `Content-Type` 为校验后的类型；`Content-Disposition: inline`；`X-Checksum-Sha256`；`Cache-Control: no-store`；`X-Content-Type-Options: nosniff` |

`RunInputView`：

```ts
type RunInputView = {
  inputId: string;        // UUIDv7
  name: string;           // 已清洗/去重的 task-space 文件名
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  sizeBytes: number;
  sha256: string;         // 64 位小写十六进制
  createdAt: string;      // ISO
};
```

### 5.2 执行面

#### 5.2.1 能力声明

- `EXE-01` poll 请求新增可选头：`X-Executor-Capabilities: run-inputs`（逗号分隔，token 规则 `[a-z0-9-]+`，≤200 字符；未知 token 忽略）。
- 服务端按 client 记到 presence；`ClientPresenceView` 增加 `capabilities: string[]`（无声明为 `[]`）。旧服务端忽略该头；旧 client 不发该头。
- `run-inputs` 是本期的唯一能力 token；将来若需要「通用文件」再加 `run-files`，语义独立。

#### 5.2.2 拉取初始资料

| ID | 方法 | 路径 | 成功 | 说明 |
|---|---|---|---|---|
| `EXE-06` | GET | `/api/v1/executor/runs/{runId}/inputs` | 200 `{ items: ExecutorRunInputRef[] }` | 只返回属于该 `clientId` 的 run；无图片 `[]` |
| `EXE-07` | GET | `/api/v1/executor/runs/{runId}/inputs/{inputId}` | 200 二进制 | 同 `API-56` 的头；`404 input_not_found` 表示不存在或不属于该 run |

```ts
type ExecutorRunInputRef = RunInputView & {
  /** 相对 executor base（`/api/v1/executor`）的路径：`/runs/{runId}/inputs/{inputId}`。 */
  downloadPath: string;
};
```

- 鉴权同 `EXE-01`–`EXE-05`：Bearer 或 `X-Client-Id`；run 不属于该 client → `404 run_not_found`。
- `EXE-06` 的 404 语义必须区分：**run 不存在/不属于该 client** → `404 run_not_found`；**未知路由（旧服务端）** → `404 not_found`。client 只把后者当「无初始资料」继续；前者会让任务失败。
- `downloadPath` 必须精确为 `/runs/{runId}/inputs/{inputId}`（相对 executor base）；client 会校验路径里的 runId/inputId 与列表一致。
- `X-Executor-Protocol` 仍要求 `3`；两个端点都是加法，不升版本。
- 旧 client 不会调用；新 client 在 `runId` 缺失或端点 404（旧服务端）时按「无初始资料」继续，不阻塞普通 run。

#### 5.2.3 `TaskRequest` 不变，但 client 写入职责扩展

`TaskRequest.runId?` 已存在（文件浏览工序）；初始资料按 `runId` 拉取，不需要新增任务字段。这样调度器不需要理解「图片」，任务表也不需要新列。

需要同步修订 [`executor-http-v3`](../../../design/contracts/executor-http-v3.md) §4.1 #4 的表述：「client 只创建目录、不写目录内容」改为「client 只创建目录，并写入本 run 通过 `EXE-06/07` 声明的初始资料；`intent.md` 等其他内容仍由节点模型写」。这是本方案唯一改变 client 既有职责的点。

### 5.3 领域契约（`CMP-run`）

```ts
type StageRunInput = {
  name: string;           // 客户端原始文件名；服务端清洗
  mediaType?: string;     // 客户端声明；服务端以魔数为准
  bytes: Uint8Array;
};

type RunInputRef = { inputId: string };

type StartRun = {
  // ...现有字段
  inputs?: RunInputRef[];      // 0–8；缺省/空数组等价于没有；顺序即 position
};

type RunInputView = { /* 见 5.1.3 */ };
type RunInputStaged = RunInputView;

type RunService = {
  // ...现有方法
  /** API-57：校验并落盘一张暂存图片；返回 inputId。 */
  stageInput(input: StageRunInput): Promise<RunInputStaged>;

  /** API-58：删除尚未绑定的暂存项；已绑定抛 InvalidStateError。 */
  deleteStagedInput(inputId: string): Promise<void>;

  /** API-55/56：只读已绑定到该 run 的初始资料。 */
  listInputs(runId: string): Promise<RunInputView[]>;
  readInput(runId: string, inputId: string): Promise<{
    stream: ReadableStream<Uint8Array>;
    sizeBytes: number;
    mediaType: RunInputView["mediaType"];
    sha256: string;
    name: string;
  }>;

  /** 执行面：校验 run 属于该 client 后再读。 */
  listExecutorInputs(clientId: string, runId: string): Promise<ExecutorRunInputRef[]>;
  readExecutorInput(clientId: string, runId: string, inputId: string): Promise<{
    stream: ReadableStream<Uint8Array>;
    sizeBytes: number;
    mediaType: RunInputView["mediaType"];
    sha256: string;
    name: string;
  }>;
};
```

不变式：

- **暂存阶段**：`stageInput` 先校验类型/体积/文件名，再写对象与 `run_input(state=staged)`；行插入失败要删除已写对象。返回的 `inputId` 是后续启动的唯一凭据。
- **绑定阶段**：`start.inputs` 的每一项都必须是 `staged`、未被其他 run 绑定；全部校验通过才在同一事务里改成 `state=bound`、写 `run_id/position/bound_at`。任一失败整体回滚，**所有暂存行保持 staged**。
- **不搬字节**：绑定只改库，`store_key` 始终是 `inputs/<inputId>`；避免「移动成功、事务失败」的二段不一致。
- `inputs.length > 0` 时，`start` 必须先通过 client 能力检查（`D-03`）；失败不绑行、不建 run。
- 每个 input 的 `sha256` 与存储字节一致；`size_bytes` 与对象长度一致；对象缺失/损坏按 `500` 处理，不返回半份字节。
- 同一 run 内 `name` 唯一、`position` 从 1 递增且唯一，均只在 `state=bound` 上成立（部分唯一索引）。
- 读取（产品/执行面）只允许 `state=bound` 且属于该 run 的 input；`staged` 不能通过 run 端点读，跨 run 的 `inputId` 一律 404。
- `staged` 行没有过期时间；只能被 `deleteStagedInput` 或运维清理删除。

依赖变化：`CMP-run` 的允许依赖增加 `CMP-scheduler.presence`（当前 [`run/spec.md`](../../../design/components/run/spec.md) §5 只列 `enqueue`/`cancelInstances`/`inspect`）。这是只读调用，但属于组件契约变更，需在 P1 评审时一起确认。

### 5.4 数据库

新增迁移 `0014_run_input.sql`（编号按当前最新 `0013` 顺延）：

```sql
create table run_input (
  id uuid primary key,
  run_id uuid references workflow_run (id) on delete cascade,
  position integer check (position is null or position between 1 and 100),
  name text not null check (char_length(name) between 1 and 200),
  media_type text not null check (media_type in ('image/png','image/jpeg','image/webp','image/gif')),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  store_key text not null unique,
  state text not null check (state in ('staged','bound')),
  created_at timestamptz not null default now(),
  bound_at timestamptz,
  check (
    (state = 'staged' and run_id is null and position is null and bound_at is null)
    or
    (state = 'bound' and run_id is not null and position is not null and bound_at is not null)
  )
);

create unique index run_input_run_name on run_input (run_id, name) where state = 'bound';
create unique index run_input_run_position on run_input (run_id, position) where state = 'bound';
create index run_input_staged_idx on run_input (created_at) where state = 'staged';
```

- 数据所有者：`CMP-run`（唯一写入口）。
- `store_key` 形如 `inputs/<inputId>`，由服务端拼接，不接受调用方路径；暂存与绑定共用。
- `staged` 无过期字段；未删除的暂存项会一直保留，孤儿由运维清理。
- 不新增 `workflow_run` 列；run 详情是否带 `inputs` 由 `API-55` 单独读，避免把大对象元数据塞进列表/详情。

### 5.5 prompt

`composeNodePrompt` 在 `[输出要求]` 之后、`[本次进入]` 之前插入（仅当 `inputs.length > 0`）：

```text
[初始资料] 本次启动带 2 个图片文件，位于 <task-space>/inputs/：
- 01-界面截图.png（image/png，123456 字节）
- 02-报错.jpg（image/jpeg，78901 字节）
需要查看时用 read_image 读取上面的绝对路径；同一张图只读一次，不要凭文件名猜测内容。
```

- **首节点**在块的末尾追加一句：`把这份清单写入 intent.md 的「初始资料」一节。`
- **所有节点**都带这段清单，避免后续节点只依赖模型是否记得写 `intent.md`；清单是本次 run 的常量，长度可控（≤8 行）。
- 没有图片时完全不出现该块，现有 prompt 与测试不变。
- 不写图片字节、不写 base64、不写「请让用户确认」之类的额外语义；资料怎么用由节点技能决定。

### 5.6 client 行为

```text
收到 task
  ├─ ensureTaskSpace(workspacePath, taskSpacePath)         # 已有
  ├─ if (task.runId && 支持 run-inputs)
  │    ├─ GET /executor/runs/{runId}/inputs
  │    ├─ for each item:
  │    │    ├─ 目标路径 = <task-space>/inputs/<name>；已在且 size 相同 → 跳过
  │    │    ├─ GET downloadPath（重试 3 次，退避 500ms/1s/2s）
  │    │    ├─ 校验 size 与 sha256；不符 → failed(asset/input_checksum_mismatch)
  │    │    └─ 写 <name>.part → rename 到 <name>（同目录原子改名）
  │    └─ 任一张失败 → failed(asset/input_fetch_failed)，不建 session
  ├─ session/new
  └─ prompt
```

- 文件名二次校验：拒绝 `/`、`\`、`..`、NUL、控制字符、绝对路径；只允许落在 `<task-space>/inputs/` 下（`realpath` 后再判一次，符号链接不能越界）。
- 目录权限沿用 `ensureTaskSpace` 的 `0700`；写入失败按 `asset` 类失败上报。
- 列表端点 404（旧服务端）或 `task.runId` 缺失：视为没有初始资料，继续执行；这是向后兼容路径，不报错。
- 失败码建议：`input_fetch_failed`（网络/5xx/超时）、`input_checksum_mismatch`（摘要/长度不符）、`input_path_invalid`（文件名/越界）。三者都映射到现有 `error.class = "asset"`。

## 6 校验、限制与安全

| 检查 | 位置 | 失败 |
|---|---|---|
| 上传：`Content-Type` 必须是 multipart | `POST /run-inputs` 网关 | `415 unsupported_media_type` |
| 上传：字段只允许 `file` | 网关 | `400 validation_error` |
| 上传：`content-length` 预拒（防无界内存） | 网关 | `413 payload_too_large`（`run_input_file_bytes`） |
| 上传：单张 ≤8 MiB | `CMP-run.stageInput` | `413 payload_too_large` |
| 上传：魔数 ∈ PNG/JPEG/WebP/GIF，且与声明类型一致 | `CMP-run.stageInput` | `400`，`reason=unsupported_media_type` |
| 上传：文件名清洗（去路径分隔符/控制字符/NUL，去首尾点与空格，**不得以点开头**，Windows 保留名加前缀，长度 ≤120，空名回退 `image-<n>.<ext>`） | `CMP-run.stageInput` | 自动修正，不报错 |
| 上传：扩展名与魔数一致（缺失或不符时补/改） | `CMP-run.stageInput` | 自动修正 |
| 启动：`inputs` ≤8、ID 不重复、全部 `staged` | `CMP-run.start` | `400 validation_error`（`details.field=inputs[i]`） |
| 启动：合计 ≤20 MiB | `CMP-run.start` | `413 payload_too_large`（`run_input_bytes`） |
| 启动：同一 run 内重名追加 `-2`/`-3` | `CMP-run.start` | 自动修正 |
| 绑定：`state=bound`、`run_id`、`position`、`bound_at` 一致 | 数据库 check | `500`（实现缺陷） |
| 删除：只允许 `staged` | `CMP-run.deleteStagedInput` | `409 invalid_state` |
| 跨 run / 跨 client 读取 | `CMP-run` | `404 input_not_found` / `run_not_found` |
| 响应头 `nosniff`、`inline`、`no-store`、`X-Checksum-Sha256` | 网关 | — |

安全说明：

- **不接受 SVG**：即使命名为 `.png`，魔数不符也会拒绝，避免脚本/外链风险。
- **不剥离 EXIF**：截图可能带位置/设备信息；本期不做，若成为顾虑可在写入前做一次元数据清理（需要图像库依赖，另评估）。
- **像素上限本期不做**：服务端只校验字节数；DSH 的 `read_image` 会按 `requestImagePixelBudget`（默认 4 MP）归一化，但解码超大图仍可能占用客户端内存。若安全评审要求，补一个纯 TypeScript 的宽高解析（PNG/JPEG/WebP/GIF）并在服务端拒绝 >50 MP 的源图。
- **暂存项无归属**：产品端点无鉴权，任何人拿到 `inputId` 都可尝试绑定；`inputId` 是 UUIDv7，不易枚举，但这不是访问控制。生产前补鉴权（`OQ-36`/`R-005`），并把「暂存项归属」纳入鉴权设计。
- **暂存配额**：每张 8 MiB、启动最多 8 张，但未对「全局未绑定暂存总量」设上限；无鉴权部署下可被刷盘。首期接受，风险登记在 §10；生产前按 actor/IP 加配额。
- **执行面端点**只对绑定 client 开放；不要把它挂到产品 BFF 白名单之外。
- 图片内容可能包含指令性文字（提示注入）；这是多模态的通用风险，本期只提示「不要凭文件名猜测内容」，不做内容审核。

## 7 失败路径

| 情形 | 结果 |
|---|---|
| 上传时类型/体积/文件名非法 | `400`/`413`，不建 `run_input` 行、不留对象 |
| 上传时对象写入成功、行插入失败 | 删除对象；返回 500；不留半份 |
| 上传后网络断开、UI 未拿到 `inputId` | 行保留为 `staged`；UI 重试会新建一项，旧项成为孤儿，需运维清理 |
| 启动时某个 `inputId` 未知/已绑定/重复 | `400 validation_error`，事务回滚，**所有暂存行保持 staged**，不建 run |
| 启动时合计体积超限 | `413 payload_too_large`，暂存行保持 staged，不建 run |
| 启动时 client 未声明 `run-inputs` | `409 client_unsupported`，暂存行保持 staged，不建 run |
| 同工作区已有活跃 run | `409 run_conflict`，暂存行保持 staged，不建 run |
| 绑定事务失败 | 回滚绑定，暂存行保持 staged；返回原错误（外键/冲突映射同现状） |
| 绑定时服务端崩溃 | 事务保证要么全 bound、要么全 staged；不会出现半绑定 |
| 暂存项长期未绑定 | 不自动清理；需 UI DELETE 或运维清理，否则占用存储 |
| 删除已绑定项 | `409 invalid_state`；UI 不应再显示删除按钮 |
| client 拉列表 5xx/超时 | 任务 `failed(asset/input_fetch_failed)`，不建 session；run 失败在当前节点 |
| 下载摘要不符 | `failed(asset/input_checksum_mismatch)`；不重试到死，最多 3 次网络重试 |
| 任务被重派/续跑 | 已存在的文件按大小跳过；缺的补下；幂等 |
| 旧 client（无能力） | 启动即拒绝；不存在「执行到一半才发现」的路径 |
| 服务端重启后 client 尚未 poll | 带图启动返回 `409 client_unsupported`（`reason=client_not_seen`）；client 上线后重试即可 |
| run 归档 | `inputs/` 随 task-space 进 tar；归档失败不影响 run 终态（现状） |

## 8 落点与任务拆分

### 8.1 本仓库（`agent-flow-orchaster`）

| 落点 | 改动 |
|---|---|
| `db/migrations/0014_run_input.sql` | 新表 + 部分唯一索引（§5.4） |
| `src/core/config/run-config.ts`、`config/default.toml` | `[run]` 的 `max_input_files`、`max_input_file_bytes`、`max_input_bytes` |
| `src/core/kernel/errors-run.ts`、`errors.ts` | `ClientUnsupportedError`（409）、`InputNotFoundError`（404）、`PayloadTooLargeError` 新增 limit 口径 |
| `src/components/scheduler/{presence,poll,types}.ts` | presence 记 `capabilities`；poll 读头；`ClientPresenceView.capabilities` |
| `src/components/run/{types,commands,store,store-types,prompt,service,index}.ts` | `stageInput`/`deleteStagedInput`、`start.inputs` 绑定、`run_input` 读写、prompt 块、`list/read` 方法 |
| `src/components/run/commands.ts` | 启动顺序：现有校验 → 能力检查 → 绑定暂存行 → 建 run |
| `src/components/http-gateway/routes/run-inputs.ts`（新） | `API-57`/`API-58`，multipart 单文件解析 |
| `src/components/http-gateway/routes/{run,executor}.ts` | `start` 读 `inputs`；`API-55/56`；`EXE-06/07` |
| `src/components/http-gateway/{fields,openapi.yaml}` | `RUN_START_FIELDS` 增 `inputs`；新端点 schema；`client_unsupported` |
| `docs/design/components/{run,http-gateway}/spec.md`、`docs/design/contracts/executor-http-v3.md`、`SCN-0301`/新场景 | 契约与场景同步 |
| `tests/components/run/*`、`tests/components/http-gateway/run-*.test.ts` | §9 矩阵 |

### 8.2 `agent-flow-client`

| 落点 | 改动 |
|---|---|
| `src/components/runtime/profile.ts` | 模型条目加 `input: ["text","image"]`（已裁决，先实测） |
| `src/components/gateway/{transport,wire,gateway}.ts` | poll 带 `X-Executor-Capabilities`；`EXE-06/07` 客户端方法 |
| `src/components/executor/{executor,ports,types}.ts` | 任务开始前拉取/落盘；失败码与 `asset` 分类 |
| `src/components/workspace/workspace.ts` | 受控写入 `inputs/`（路径校验、原子改名） |
| `tests/components/{executor,workspace,gateway}/*` | 拉取、幂等、校验失败、路径越界 |

### 8.3 `agent-flow-ui`

> 详细任务、状态机与验收见 [`ui-proposal.md`](ui-proposal.md)。本节只列落点。

| 落点 | 改动 |
|---|---|
| `assets/js/pages/instances.js` | 发起弹窗：`paste`/`dragover`/`drop` 监听（捕获阶段，阻止编辑器插入 base64）、缩略图栏、进度、重试、删除、提交时只传 `inputId` |
| `assets/js/run/input-upload.js`（新） | 单图上传队列：XHR 进度、AbortController、失败重试、`ready/failed/uploading` 状态 |
| `assets/js/run/data.js` | `uploadInput(file, {onProgress, signal})`、`deleteInput(inputId)`、`start()` 增加 `inputs` 字段 |
| `assets/js/pages/instance-detail.js` 或对应视图 | 运行详情「初始资料」区：`GET /runs/{id}/inputs` + `<img src=...>`；可选灯箱 |
| `assets/css` 或组件样式 | 64px 缩略图、进度条、重试/删除按钮、空态 |
| `bff/index.js` | 预计不改：multipart 已转发、25 MiB/120 s 足够；上传进度是浏览器→BFF 的进度，BFF→编排仍是缓冲转发 |
| `tests/…` | 上传状态机、删除、提交 payload、关闭清理、详情渲染 |

### 8.4 实施顺序

1. **前置验证**（client）：补模型 `input` 声明，跑一次真实 `read_image`；不通过就停。
2. **编排**：迁移 + `stageInput`/绑定 + 网关上传/删除 + prompt + 测试（无 client 参与也能测）。
3. **client**：能力头 + 拉取/落盘 + 测试。
4. **UI**：提交时上传 + 进度/重试/删除 + 详情预览（UI 已实现，见 [result](../../../../../agent-flow-ui/docs/history/works/2026-11-19-run-start-images/result.md)）。
5. **端到端**：真实截图粘贴 → 上传 → 启动 → 检查 task-space 文件 → 首节点 `read_image` 描述 → 归档包含 `inputs/`。

## 9 测试与验收

### 9.1 场景

- 新建 `SCN-0307`「运行初始资料（图片）」：3 正例 + 1 反例。
  - R1：粘贴 2 张 PNG → 两次上传各返回 `inputId`；启动引用两项 → `run_input` 2 行 `bound`、store 2 个对象、prompt 含清单；client 任务后 `<task-space>/inputs/` 有 2 个文件；首节点能 `read_image`。
  - R2：不带图片启动 → 行为与现状完全一致（prompt 无 `[初始资料]`）。
  - R3：暂存后删除其中一张再启动 → 被删项 404/不参与绑定；另一项正常绑定；重复文件名的两张图绑定时得到 `x.png`/`x-2.png`。
  - N1：旧 client（无 `run-inputs`）带图启动 → `409 client_unsupported`，不建 run、暂存行保持 staged。
  - 补充反例（矩阵覆盖，不单独占场景位）：未知 `inputId` → 400 且回滚；`DELETE` 已绑定点 → 409。
- 更新 `SCN-0301` 第 4/5 步：带图启动时 prompt 与 client 写入 `inputs/` 的断言。
- `REQ`：[`REQ-0003`](../../../requirements/REQ-0003-run-start-image-inputs.md) 已建（2026-11-19），记录三项裁决；设计冻结后进入实现工序。

### 9.2 测试矩阵

| 层 | 用例 |
|---|---|
| 网关 | `POST /run-inputs` 单张成功/非图片/超限/非 multipart；`DELETE` staged/bound/未知；启动 `inputs` 0/1/8/9 张、重复 ID、已绑定；`client_unsupported`；`API-55/56` 头与 404 |
| 领域 | 上传魔数/文件名清洗（CJK、空格、`..`、Windows 保留名、超长）；staged→bound 同事务；失败回滚保持 staged；合计体积；DELETE/运维清理；对象/行补偿；`list/read` 跨 run 404 |
| prompt | 无图不变；有图块顺序、字节上限；首节点额外 `intent.md` 指令 |
| 执行面 | `EXE-06/07` 鉴权、跨 client 404、`X-Checksum-Sha256`、旧协议 400 |
| client | 拉取/落盘、幂等重派、摘要不符、路径越界、列表 404 兼容、能力头 |
| UI | 粘贴/拖放本地暂存、提交时上传、进度、失败回滚/重试、关闭清理、启动只传 `inputId`、详情缩略图 |
| 视觉 | `read_image` 真实读图（人工/探针）；ACP `image=true`（可选） |
| 端到端 | 真实粘贴 + 上传 + 启动 + client + 模型；归档 tar 含 `inputs/` |

### 9.3 命令（实现阶段，在仓库根执行）

```sh
# 本仓库
bun test tests/components/run tests/components/http-gateway/run-*.test.ts
bun run quality:report

# client
cd ../agent-flow-client && bun test

# UI
cd ../agent-flow-ui && npm test
```

## 10 风险与待验证

| # | 风险/未知 | 影响 | 处置 |
|---|---|---|---|
| `R-IMG-01` | client 的 `hundsun-public` 路由实际不支持图片（用户已确认支持，但仍需端到端验证） | 功能核心价值不成立 | 实施前用 `read_image` 实测；不通过则停或换路由 |
| `R-IMG-02` | `read_image` 不在 `--profile acp` 工具目录 | 模型无法读图 | client 侧会话实测；必要时调整 profile 挂载 |
| `R-IMG-03` | 单张 8 MiB 在 BFF 内存缓冲 + 服务端解析，峰值内存偏高 | 低配机器抖动 | 单请求只传一张；BFF 25 MiB 上限足够；后续可改流式上传 |
| `R-IMG-04` | 图片 token 消耗不可控（8 张 × 4 MP） | 单节点上下文膨胀 | prompt 要求按需读、同一张只读一次；必要时把上限降到 4 张 |
| `R-IMG-05` | Windows client 文件名非法/路径分隔符 | 写入失败 | 服务端按 Windows 规则清洗；client 二次校验 |
| `R-IMG-06` | 服务端副本与归档重复存储 | 存储增长 | `bound` 随 run 保留；`OQ-27` 统一清理；归档已含 `inputs/` |
| `R-IMG-07` | 产品端点无鉴权，图片可能含敏感信息 | 信息暴露 | 生产前补鉴权（`OQ-36`）；本期与 run 详情同边界 |
| `R-IMG-08` | 启动窗口内 client 能力变化 | 极端情况下图片未落盘 | 本期接受；需要绝对严格时加派发时二次校验 |
| `R-IMG-09` | 暂存行与对象非同一事务，崩溃/写失败留下孤儿 | 存储泄漏 | 行插入失败补偿删除对象；无 TTL，孤儿由运维清理 |
| `R-IMG-10` | 暂存项无归属、无全局配额，可被刷盘 | 磁盘耗尽 | 首期只靠单张/单次上限；生产前按 actor/IP 加配额与鉴权 |
| `R-IMG-11` | BFF 缓冲转发，上传进度到 100% 后仍要等服务端响应 | 进度条短暂“卡住” | UI 区分「上传中/处理中」；不承诺逐字节端到端进度 |
| `R-IMG-12` | 暂存不设 TTL，长期未绑定的孤儿会累积 | 磁盘占用 | 用户关闭弹窗时 DELETE；运维按 `staged` 行/对象做人工清理；后续可加手动清理端点或策略 |
| `R-IMG-13` | 启动成功但响应丢失，重试时 `inputId` 已绑定 | 用户看到 `already_bound`，困惑 | UI 提示「图片已被某次运行使用，请到运行列表确认」；启动接口暂不做幂等键（沿用现状） |

## 11 裁决记录与待定

### 11.1 已裁决（2026-11-19）

| # | 问题 | 结论 |
|---|---|---|
| `Q-IMG-01` | client 是否支持图片 | **支持**；必须补 pi-ai 模型条目的 `input: ["text","image"]`，并用真实 `read_image` 复验 |
| `Q-IMG-02` | 上传形态 | **提交时上传**：点「发起运行」后逐张 `POST /run-inputs`，全部成功再启动；后端契约不变。2026-11-19 UI 实施修订，取代旧「粘贴即上传」 |
| `Q-IMG-03` | 首期范围 | **只支持图片**（PNG/JPEG/WebP/GIF），不做 PDF/文本等通用文件 |
| `Q-IMG-04` | 首期上限 | **8 张 / 单张 8 MiB / 合计 20 MiB** |
| `Q-IMG-05` | 运行详情预览 | **要**：`API-55/56` + UI 缩略图 |
| `Q-IMG-06` | 跨项目分工 | 本仓库出编排契约与实现；UI 已在 `agent-flow-ui` 实现（提交时上传）；client 已在其仓库实现 |
| `Q-IMG-07` | 暂存 TTL | **不设 TTL**；`staged` 一直保留到绑定或 DELETE，孤儿由运维清理 |

### 11.2 待定

无。设计已冻结（2026-11-19）；实现按 `T-IMG-08` 推进。

## 12 证据索引

| 事实 | 文件 |
|---|---|
| task-space 生成与不变量 | [`run/spec.md`](../../../design/components/run/spec.md) §2、[`validate.ts`](../../../../src/components/run/validate.ts) |
| 启动链路与 prompt | [`commands.ts`](../../../../src/components/run/commands.ts)、[`prompt.ts`](../../../../src/components/run/prompt.ts)、[`SCN-0301`](../../../design/scenarios/workflow-orchestration/workflow-execution/run-start-and-node-advance/scenario.md) |
| 执行面 task-space 规则 | [`executor-http-v3.md`](../../../design/contracts/executor-http-v3.md) §4.1 #4 |
| 服务端不访问工作区 | [`REQ-0001`](../../../requirements/REQ-0001-workflow-run-orchestration.md) §4 |
| 网关 multipart 先例 | [`skill-drafts.ts`](../../../../src/components/http-gateway/routes/skill-drafts.ts) |
| 执行面版本/能力头先例 | [`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) §4.3、[`executor-http-v3.md`](../../../design/contracts/executor-http-v3.md) §3 |
| presence 读 | [`scheduler/service.ts`](../../../../src/components/scheduler/service.ts)、[`presence.ts`](../../../../src/components/scheduler/presence.ts) |
| client 只 mkdir task-space | [`workspace.ts`](../../../../../agent-flow-client/src/components/workspace/workspace.ts) 第 94–106 行 |
| client prompt 只发文本 | [`runtime.ts`](../../../../../agent-flow-client/src/components/runtime/runtime.ts) 第 138 行 |
| client 模型条目无 `input` | [`profile.ts`](../../../../../agent-flow-client/src/components/runtime/profile.ts) 第 47 行 |
| ACP 图片能力为 false | [`summary.protocol.jsonl`](../../../../../agent-flow-client/docs/history/works/2026-11-14-acp-progress-feedback/probe/summary.protocol.jsonl) 第 2 行 |
| 本机读图实测 | [`vision-probe.md`](probe/vision-probe.md) |
| 项目技能依赖读图 | [`swift-ui-probe/SKILL.md`](../../../../scripts/seed-skills/swift-ui-probe/SKILL.md) |
| UI 发起弹窗 | [`instances.js`](../../../../../agent-flow-ui/assets/js/pages/instances.js) |
| UI 请求层支持 FormData/XHR | [`shared/http.js`](../../../../../agent-flow-ui/assets/js/shared/http.js) |
| BFF multipart/25 MiB | [`bff/index.js`](../../../../../agent-flow-ui/bff/index.js) |
| DSH 附件机制 | `@deepseek-ai/dsh-attachment`、`dsh-client-ui-attachment`、`dsh-client-file-upload`、`dsh-tool-fs`、`dsh-llm-pi-ai` 的 README（Desktop `app.asar` 内） |
