---
layer: works
module: run
status: active
updated: 2026-11-17
procedure: 2026-11-17-run-file-browser
level: P1
---

# 工序：运行文件浏览（人工确认节点）

> 用户裁决（2026-11-17）：以 `confirm`（人工确认）为主、API 按 run 级设计；文件通道改为 **client session 为主的只读观测面直连**（见 [`2026-11-17-client-observability/proposal.md`](../2026-11-17-client-observability/proposal.md)）；poll 反向请求保留为 NAT/离线备选；v1 只做运行中实时只读，不做 confirm 快照、结束后归档浏览与下载。

## 1 背景

`confirm` 节点等待人工决策时，方案与代码都在 client 的 task-space/workspace 里；服务端只有 run 的路径字段，没有读取面。UI 节点详情目前明确写「输入与输出、工作区文件留痕：当前执行面未提供对应端点」，人工只能看节点最终消息，确认容易停留在凭消息判断。

约束来自 `REQ-0001` §4：服务端不直接访问 client 工作区；client 的控制仍只走出站 poll，只新增独立只读观测面；`CMP-run` 不直接向 client 发网络请求。运行结束后的 `P-05` 归档只在终态发生，覆盖不了 `confirm` 等待期。

设计提案见 [`design-proposal.md`](design-proposal.md)。**2026-11-17 方向调整**：传输层改为 client session 为主的观测面直连；本工序保留产品 API/DTO/UI/限制与验收，poll 反向请求作为备选。

## 2 范围

| 做 | 不做 |
|---|---|
| 需求卡 `REQ-0002`、工序 brief、设计提案、影响面与任务拆分 | 写实现代码、改组件规格、改 OpenAPI、加迁移 |
| run 级只读文件 API：列目录（含子目录）、读文本内容 | 写/编辑/上传/删除、终端、文件下载 |
| client 只读观测面直连 + `CMP-observability-client` 适配器 | poll 反向请求传输（保留为备选）、client 控制面 |
| task-space 与 workspace 两个根、路径越界防护；接受 client 2000 条 / 1 MiB 限制 | 运行结束后归档浏览、confirm 自动快照、二进制预览 |
| UI 侧「文件」Tab 的交互与渲染口径（Markdown / 代码高亮） | 本仓库代码改动；UI 代码由独立项目承接 |
| `SCN-0305` 场景草案与 `SCN-0303` 新增断言的测试计划 | `SCN-0305` 转 `verified`（实现后） |

## 3 验收标准

设计阶段（本工序当前阶段）：

1. `REQ-0002` accepted，影响场景与澄清记录完整。
2. 设计提案写清：通道取舍、产品 API、执行面契约、请求生命周期、限制、错误映射、安全边界、测试计划、发布顺序、回滚。
3. 影响面明确：`CMP-run`、`CMP-scheduler`、`CMP-http-gateway`、`executor-backend`、client、UI；**无新增表、无迁移**。
4. 与用户完成 P1 设计评审确认；确认前不改组件规格、不写实现代码。

实现阶段（设计冻结后，另起任务）：

5. `GET /api/v1/runs/{id}/files` 与 `GET /api/v1/runs/{id}/files/content` 可用；run 级、只读、上限生效。
6. client 观测面 `O-09`/`O-10` 与运行注册表；orchestrator 适配器能列目录、读文本；超时/离线/越界错误明确。
7. UI 节点弹层「文件」Tab 可列 task-space/workspace、预览 Markdown 与代码。
8. `SCN-0305` 3+1 通过；`SCN-0303` 新增断言通过；`bun run check` 全绿。
9. `bun run quality:report` 无新增违规；client 仓库同批交付契约副本与测试。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-RFB-01` | design | run | 现状盘点、通道对比、方案取舍 | 完成 |
| `T-RFB-02` | design | global | 需求卡 `REQ-0002`、工序 brief、影响场景 | 完成 |
| `T-RFB-03` | design | run | 设计提案：API、契约、限制、错误、测试、发布 | 完成 |
| `T-RFB-04` | design | global | P1 人工评审确认：产品 API/DTO/UI/限制是否接受（传输见 `T-COBS-03`） | 待确认 |
| `T-RFB-05` | design | run | 建 `SCN-0305`（draft）与 `SCN-0303` 新增断言；补 `docs:index` | 待设计冻结 |
| `T-RFB-06` | change | run | 产品读方法 `listFiles`/`readFile` + `runIdForTask`；文件请求代理取消，观测面适配器由 `T-COBS-07` 承接 | 待确认 |
| `T-RFB-07` | change | http-gateway | 2 个产品端点、poll URL 头、`runId` 富化、OpenAPI/DTO、测试 | 待确认 |
| `T-RFB-08` | change | client（跨项目） | client 观测面 `O-09`/`O-10`、运行注册表、鉴权/发现、测试（由 `T-COBS-06` 承接） | 待确认 |
| `T-RFB-09` | change | UI（跨项目） | 节点弹层「文件」Tab、目录树、Markdown/代码渲染、只读 | 待确认 |
| `T-RFB-10` | verify | run/http-gateway/client | `SCN-0305` 3+1、`SCN-0303` 新增断言、真实 client 联调 | 待确认 |

## 5 装载清单

- 现行契约：[`docs/design/components/run/spec.md`](../../design/components/run/spec.md)、[`docs/design/components/http-gateway/spec.md`](../../design/components/http-gateway/spec.md)、[`docs/design/contracts/executor-http-v3.md`](../../design/contracts/executor-http-v3.md)
- 编排侧入口：[`src/components/run/service.ts`](../../../src/components/run/service.ts)、[`src/components/scheduler/service.ts`](../../../src/components/scheduler/service.ts)、[`src/components/http-gateway/routes/run.ts`](../../../src/components/http-gateway/routes/run.ts)、[`src/executor-backend.ts`](../../../src/executor-backend.ts)
- client 入口：`agent-flow-client/src/components/cli/serve-loops.ts`、`agent-flow-client/src/components/workspace/workspace.ts`、`agent-flow-client/src/components/gateway/gateway.ts`
- UI 入口：`agent-flow-ui/assets/js/pages/instance-detail.js`、`agent-flow-ui/assets/js/run/data.js`
- 参考：[`docs/history/decisions/2026-11-11-workflow-run-orchestration.md`](../../history/decisions/2026-11-11-workflow-run-orchestration.md)、[`docs/design/components/run/spec.md`](../../design/components/run/spec.md) §4.7
- 方向调整：[`2026-11-17-client-observability/proposal.md`](../2026-11-17-client-observability/proposal.md)

## 6 待定

| 项 | 为什么不阻塞 v1 | 去向 |
|---|---|---|
| 运行结束后从归档浏览 task-space | confirm 等待期是主场景；终态归档仍保留，可二期加解包/索引 | `OQ-34` |
| 进入 `confirm` 时自动快照 | 审核期间 client 通常在线；快照增加上传、存储与保留策略 | `OQ-35` |
| 文件下载 / 二进制预览 | v1 目标是 markdown 与代码审阅 | 本工序后续评估 |
| 鉴权与敏感文件策略 | 当前服务仅监听本机、无鉴权是既有基线 | `OQ-36` |
| client 观测面直连（已选） | 需要观测服务、地址发现、调度器→client 鉴权与 runId→路径映射；client 观测面尚未实现 | 由 [`2026-11-17-client-observability`](../2026-11-17-client-observability/brief.md) 承接；本工序只保留产品/UI |
| poll 反向请求（备选） | NAT 后 client 不可达时观测面直连不可用 | 设计提案 §5 保留；需要时再启用 |

## 7 影响场景

- `SCN-0303` 人工确认与运行控制：新增「文件浏览」断言。
- `SCN-0305` 运行文件浏览（待新建）：R1 列 task-space、R2 读 Markdown、R3 读代码并返回语言、N1 路径越界/超时。
