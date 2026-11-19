---
layer: works
module: run
status: active
updated: 2026-11-19
procedure: 2026-11-19-run-start-images
---

# 工序说明：启动运行支持图片初始资料（调研）

## 1 本轮范围

**做**：调研「发起运行」时通过 UI 粘贴一张或多张图片，图片最终落到该 run 的 task-space（`<workspace>/task-spaces/<时间>/inputs/`）作为初始资料」的端到端实现路径。覆盖三端：

- `agent-flow-orchaster`：启动 API、`CMP-run` 数据与 prompt、执行面契约、OpenAPI；
- `agent-flow-client`：能力声明、初始资料拉取与落盘、模型图片能力配置；
- `agent-flow-ui`：发起运行弹窗的粘贴/拖放、逐张上传与附件栏、启动引用 `inputId`、运行详情预览。

**不做**：

- 不改任何代码、不建迁移、不改 OpenAPI、组件规格、场景卡或 `plan/`；
- 不决定产品是否切换到视觉模型，只把这条前置条件写清楚；
- 不在本仓库修改 UI（独立项目），只给契约与交接清单。

**需要你定**：见 [`proposal.md`](proposal.md) §11，核心是模型视觉能力、上传形态、首期范围与上限。2026-11-19 已裁决前两项与范围，详见 §6。

## 2 背景

当前启动链路是纯文本：UI 的「发起运行」弹窗提交 `harnessId` / `workspacePath` / `intentMarkdown` / `autoConfirm`（[`instances.js`](../../../../agent-flow-ui/assets/js/pages/instances.js)），`CMP-run.start` 冻结图快照并组装首节点 prompt（[`commands.ts`](../../../src/components/run/commands.ts)、[`prompt.ts`](../../../src/components/run/prompt.ts)），client 收到任务后只 `mkdir -p` 出 task-space（[`workspace.ts`](../../../../agent-flow-client/src/components/workspace/workspace.ts)），`intent.md` 由首节点模型按 prompt 写入。

用户希望像 DSH 输入框一样粘贴图片，图片作为本次运行的初始资料保存在 task-space 里，供各节点模型查看。关键约束：编排服务端不访问 client 工作区（`REQ-0001` §4），task-space 只能由 client 写；执行面 prompt 是纯文本（client 只发 `{type:"text"}`，[`runtime.ts`](../../../../agent-flow-client/src/components/runtime/runtime.ts)）。

## 3 验收标准

- 能回答「图片从 UI 到 task-space 的完整链路、每段谁负责、契约是什么、旧 client 如何不静默丢图」；
- 每个关键选择至少给一个被否决方案与理由；
- 能落到具体文件、表、端点、prompt 文本与测试断言；
- 明确区分「已验证」「待验证」「未纳入本期」。

## 4 任务表

| ID | 类型 | 组件 | 状态 | 产出 |
|---|---|---|---|---|
| `T-IMG-01` | research | run / client / ui | 完成 | 现状盘点与证据（本文件 §2、proposal §2） |
| `T-IMG-02` | design | run / client / ui | 完成 | 方案、契约草案、落点与测试（proposal） |
| `T-IMG-03` | review | — | 完成（2026-11-19） | 用户裁决：client 支持并补模型 `input`；只支持图片；UI 实施时把上传时机改为提交时上传 |
| `T-IMG-04` | design | ui | 完成 | 给 `agent-flow-ui` 的交互提案：[`ui-proposal.md`](ui-proposal.md) |
| `T-IMG-05` | intake | — | 完成（2026-11-19） | 建 [`REQ-0003`](../../requirements/REQ-0003-run-start-image-inputs.md)；后续做 P1 设计冻结与实现工序拆分 |
| `T-IMG-06` | design | client | 完成 | 给 `agent-flow-client` 的实现提案：[`client-proposal.md`](client-proposal.md) |
| `T-IMG-07` | verify | client | 完成（2026-11-19） | client 已实现并经 285 项测试/读图探针验证；见 [client result](../../../../agent-flow-client/docs/works/2026-11-19-run-start-inputs/result.md) |
| `T-IMG-08` | change | run / gateway | 完成（2026-11-19） | 编排侧 `EXE-06/07`、暂存上传/绑定、prompt 清单、`run_input` 与测试；451 测试通过 |
| `T-IMG-09` | verify | run / client / ui | 待定 | 真实 client + UI 的端到端联调（上传→启动→client 落盘→read_image→归档） |

## 5 已读

- 运行编排：[`run/spec.md`](../../design/components/run/spec.md)、[`executor-http-v3.md`](../../design/contracts/executor-http-v3.md)、[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)、[`SCN-0301`](../../design/scenarios/workflow-orchestration/workflow-execution/run-start-and-node-advance/scenario.md)、[`REQ-0001`](../../requirements/REQ-0001-workflow-run-orchestration.md)。
- 编排实现：`src/components/run/{commands,prompt,validate}.ts`、`src/components/http-gateway/routes/run.ts`、`src/components/scheduler/{poll,presence}.ts`。
- client：`src/components/{executor,runtime,gateway,workspace}/`；ACP 能力探针 `docs/history/works/2026-11-14-acp-progress-feedback/probe/summary.protocol.jsonl`。
- UI：`assets/js/pages/instances.js`、`assets/js/run/data.js`、`assets/js/shared/http.js`、`bff/index.js`。
- DSH 参考实现：`@deepseek-ai/dsh-attachment`、`dsh-client-ui-attachment`、`dsh-client-file-upload`、`dsh-tool-fs`、`dsh-llm-pi-ai` 的 README（Desktop `app.asar` 内）。

## 6 用户裁决（2026-11-19）

| 问题 | 结论 |
|---|---|
| client 是否支持图片 | **支持**；必须补 pi-ai 模型条目的 `input: ["text","image"]`，并用真实 `read_image` 复验 |
| 上传形态 | **提交时上传**：点「发起运行」后逐张 `POST /run-inputs`，全部成功再启动；服务端仍只认 `inputId`。UI 2026-11-19 实施修订，取代旧「粘贴即上传」 |
| 首期范围 | **只支持图片**（PNG/JPEG/WebP/GIF），不做 PDF/文本等通用文件 |
| UI 提案/实现 | 本仓库出 [`ui-proposal.md`](ui-proposal.md)；UI 已实现（提交时上传），见 [UI result](../../../../agent-flow-ui/docs/history/works/2026-11-19-run-start-images/result.md) |
| client 提案 | 由本仓库出 [`client-proposal.md`](client-proposal.md)，client 项目按其立项实现 |

设计冻结（2026-11-19）：上限 8 张 / 单张 8 MiB / 合计 20 MiB；运行详情带缩略图；暂存**不设 TTL**。见 [`proposal.md`](proposal.md) §11。
