---
layer: works
module: global
status: closed
updated: 2026-11-17
procedure: 2026-11-17-client-observability-verification
level: P2
---

# 工序：client 观测面 v1 契约验证

> 用户指令（2026-11-17）：client 侧观测接口已实现，先验证 `agent-flow-client/docs/design/contracts/client-observability-v1.md`；输出方案并按规则执行。
> 本工序只做验证，不改 client / orchestrator 代码，不修缺口；发现的问题进 result 与待办。

## 1 背景

client 已按 `client-observability-v1`（2026-11-17.1）实现只读观测面：`O-01`–`O-11`（health、attempt、日志/SSE、session、raw、文件、富事件 SSE）。它已与上一轮 orchestrator 设计提案分叉：恢复 attempt 端点、保留 preview、新增 `O-11`，文件仍按 2000 条 / 1 MiB / 2 MiB / 5s。

本工序以 **client 契约文件为唯一验收基准**，核对实现、测试与运行行为；不拿我们的提案当基准。

## 2 范围

| 做 | 不做 |
|---|---|
| 契约 vs 实现静态核对：端点、方法、字段、状态、错误、存储、权限、配置、限制 | 修改 client / orchestrator 代码 |
| 跑 client 相关测试与 typecheck | 修契约缺口、补测试（只记录建议） |
| 用 observer server 测试/独立 handler 做端点探测：状态码、JSON 形状、鉴权、SSE 首帧、文件路径 | 启动真实 `serve` + DSH 跑完整任务（成本高，另立联调） |
| 输出验证结果与缺口分级（blocker / decision / hold / verified） | 改 orchestrator 产品 API/适配器（另立 P1 实现工序） |
| 记录契约与用户口头决定的差异（attempt 范围、限制、auth 开关） | 把差异直接判成实现错误；先记录事实 |

## 3 验收标准

1. 每个 `O-01`–`O-11` 都有「契约条款 → 实现落点 → 测试/探测证据」映射。
2. `bun test`（至少 observer/store runs/workspace files）与 `bun run typecheck` 结果记录，失败项可定位。
3. 端点探测覆盖：正常 200、未注册 run 404、路径逃逸、鉴权开关、SSE 首帧、raw 缺失/未就绪、错误信封。
4. 缺口按四档分级：blocker（契约要求但实现错误/缺失）、decision（两种行为都说得通需拍板）、hold（不阻塞但应修）、verified（已核对无问题）。
5. 结论落到 `result.md`，不改代码；修复项转 client 仓库后续工序。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-VER-01` | verify | observer | 契约端点/字段/状态/错误 vs `src/components/observer/*` 静态核对 | 完成 |
| `T-VER-02` | verify | observer/store/workspace | 跑 `bun test` 相关用例与全量测试 | 完成 |
| `T-VER-03` | verify | client | 跑 `bun run typecheck` | 完成 |
| `T-VER-04` | verify | observer | handler/HTTP 探测：鉴权、SSE 首帧、404/410/415、错误信封 | 完成 |
| `T-VER-05` | verify | global | 缺口分级与 `result.md` | 完成 |

## 5 装载清单

- 契约：[`client-observability-v1.md`](../../../../agent-flow-client/docs/design/contracts/client-observability-v1.md)
- 实现：`agent-flow-client/src/components/observer/{server,types,attempt-store,recorder,rich-hub,mapper,archive}.ts`
- 存储/文件：`agent-flow-client/src/components/store/runs.ts`、`agent-flow-client/src/components/workspace/files.ts`
- 集成：`agent-flow-client/src/components/cli/{config,serve-compose,serve}.ts`、`src/components/gateway/{transport,wire}.ts`、`src/components/executor/{types,contract-types}.ts`
- 测试：`agent-flow-client/tests/components/observer/*`、`tests/components/store/runs.test.ts`、`tests/components/workspace/files.test.ts`
- 既有设计：`docs/works/2026-11-17-client-observability/proposal.md`（只作差异参考，不作验收基准）

## 6 待定 / 注意

- 契约仍保留文件 2000 条 / 1 MiB / 2 MiB / 5s；用户此前口头说「先不设限制」。本工序按契约验收，并把差异记为 decision，不按口头决定判实现错。
- 契约没有显式 `auth=on/off` 开关，只有 token 有无 + 非 loopback 拒绝；用户口头要求「有一个开关」。本工序记录差异，不改实现。
- 契约恢复了 attempt 端点与 `O-11` 富事件；orchestrator 侧提案仍是 session 为主 + 薄 attempt，需在实现工序对齐，不在本验证范围。
