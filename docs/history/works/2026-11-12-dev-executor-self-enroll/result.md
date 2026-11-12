---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-12-dev-executor-self-enroll
---

# 结果：执行面身份旁路与节点自注册（开发期）

## 1 结论

编排侧已落地「`EXECUTOR_AUTH=off` + `X-Client-Id` 自报身份 + 首见自动登记节点」。开发期 client 只要在请求里带上稳定的 `clientId`，无需建 Harness 资产、无需 `API-41`、无需 token，就能被认出并参与派发；同一 `clientId` 只对应一行，重复注册不报错、不新增。客户端代码未改，改动以 [`client-proposal.md`](client-proposal.md) 交回 client 仓库。

## 2 验收结果

| 项 | 命令/方式 | 结果 |
|---|---|---|
| 类型检查 | `bun run typecheck` | 通过 |
| 全量测试 | `bun test --max-concurrency=1` | **384 pass / 0 fail**（含新增 11 例） |
| 新增用例 | `tests/components/http-gateway/executor-enroll.test.ts` | 6/6 通过（`TC-EXN-101`/`TC-EXN-102`） |
| 自注册契约 | `tests/components/harness/service.test.ts` 新增 5 例 | 通过（默认值、幂等、同名后缀、停用不复活、形状校验） |
| 配置开关 | `tests/core/config.test.ts` 新增 1 例 | 通过（默认 `off`、`on`、非法值） |
| 真实进程 | 重启 3100 → `curl -X POST /api/v1/executor/poll -H 'x-client-id: smoke-node-01'` | `200` + `tasks=[]`；Harness 列表出现该节点（`health=online`）；二次 poll 后 `total=1`；探针节点已用 `DELETE` 清掉（`204`） |
| 严格模式回退 | `EXECUTOR_AUTH` 缺省 `on` 的测试上下文 | 只带身份头 → `401 unauthorized`，不建行 |
| 文档门禁 | `bun run docs:check` | 通过（见 §3 的规格同步） |

## 3 结论落点

| 产物 | 落点 |
|---|---|
| 决策：默认关闭鉴权、身份头、自动登记、重复即复用 | [`2026-11-12-executor-auth-dev-bypass.md`](../../history/decisions/2026-11-12-executor-auth-dev-bypass.md) |
| 配置键与默认值 | [`config/spec.md`](../../design/components/config/spec.md) §3.1 |
| 身份解析顺序、`X-Client-Id`/`X-Client-Address`、401/400 映射 | [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) §5.5 |
| `ensureNode` 方法与默认值 | [`harness/spec.md`](../../design/components/harness/spec.md) §3.2、§3.4 |
| 契约增量（开发期头） | [`executor-http-v3.md`](../../design/contracts/executor-http-v3.md) §3 |
| 运行序与测试映射 | [`executor-node-registry/scenario.md`](../../design/scenarios/workflow-orchestration/execution-scheduling/executor-node-registry/scenario.md) §3、§5（`TC-EXN-101`/`TC-EXN-102`） |
| 风险 | [`risks.md`](../../plan/risks.md) `R-005`（默认无鉴权）、`R-006`（垃圾行累积） |
| 实现 | `src/core/config/executor-config.ts`、`src/core/config/config.ts`、`src/components/http-gateway/routes/executor.ts`、`src/components/http-gateway/app.ts`、`src/components/harness/service.ts`、`src/components/harness/store.ts`、`src/main.ts` |
| 客户端改动提案 | [`client-proposal.md`](client-proposal.md) |

## 4 裁决摘要

blocker 0 / decision now 3（已落决策记录与规格）/ hold 4（`H-01`–`H-02` 转风险与未决，`H-03` 交 client 仓库，`H-04` 属既有前置）。详见 [`review.md`](review.md)。

## 5 偏差与未覆盖

- **与用户原话的偏差**：用户要求「重复 id 用新来的代替老的」，实现为「同一 `clientId` 复用同一行、不覆盖 `enabled`/`address`」（`D-02`）。原因：旁路只带身份，没有可替换的机器级信息；覆盖人工维护字段会让「停用」失效。如需「客户端重连即复活」，改一行并重开决策。
- 客户端未改，端到端只在 curl 层面验证；client 仓库按 [`client-proposal.md`](client-proposal.md) 实施后才算真正打通。
- 未做：自动登记节点回收、地址刷新、enrollment 审批流（已被决策否决）。

## 6 收口（2026-11-12）

客户端已按 [`client-proposal.md`](client-proposal.md) 实现（client 仓库 `eec1485`：五个执行面端点统一带 `X-Client-Id` / `X-Client-Address`，新增 `[scheduler] client_id` 与 `allow_unauthenticated`，`doctor` 增加两项检查，用例 `TC-CLT-ENR-1`–`4`）。实测：节点以 `chenlong-mac-01` 自动登记、`health=online`，带技能包的 run 能正常派发执行。编排侧不再需要 `API-41` 人工登记即可接入新节点。

## 7 未决

- 自动登记节点的回收策略（`R-006`）。
- 生产部署清单中的 `EXECUTOR_AUTH=on` 需要写进上线检查项（当前只记在决策与风险表）。
