---
layer: works
module: global
status: active
updated: 2026-11-12
procedure: 2026-11-12-dev-executor-self-enroll
---

# 提案：client 以 `X-Client-Id` 自报身份（交 client 仓库实施）

> 对应编排侧决策：[`2026-11-12-executor-auth-dev-bypass`](../../history/decisions/2026-11-12-executor-auth-dev-bypass.md)。编排侧已实现并有测试；本文件是 client 仓库的改动清单，本仓库不修改 client 代码。
> 目标：开发期 client 一行配置启动即被调度器认出并登记为节点，不需要建 Harness 资产、不需要 `API-41`、不需要 token。

## 1 契约增量（执行面，开发期）

| 头 | 必填 | 格式 | 语义 |
|---|---|---|---|
| `X-Client-Id` | 建议总是带 | 1–64 个字符，不含空白与控制字符 | 客户端声明的节点身份，必须**跨重启稳定** |
| `X-Client-Address` | 可选 | 1–200 字符 | 仅供展示的接入地址；缺省服务端记为 `auto` |

服务端行为（`EXECUTOR_AUTH=off`，当前默认）：

1. 能命中的 `Bearer` 优先；没有或未知时取 `X-Client-Id`；两者都没有 → `401 unauthorized`。
2. `clientId` 对应的节点不存在 → 自动建一行（`name=clientId`、`kind=container`、`enabled=true`、`concurrencyMax=4`、`queuePolicy=fifo`）。
3. 已存在 → 原样复用，不新建、不覆盖 `enabled`/`address`、不报 `409`。
4. `X-Client-Id` 形状非法 → `400 validation_error`（`details.field=clientId`）。

服务端 `EXECUTOR_AUTH=on` 时以上全部失效，只认 `Bearer`；客户端两种模式可以共存（有 token 就带 Bearer，没有就带身份头）。

## 2 客户端改动清单

### 2.1 配置：新增 `[scheduler] client_id`

```toml
[scheduler]
url = "http://127.0.0.1:3100"
# token 可继续留空（开发期）；留空时用 client_id 自报身份
client_id = "chenlong-mac-01"
```

- 取值优先级建议：`AF_CLIENT_ID` 环境变量 > `[scheduler].client_id` > `hostname()`。
- 校验：1–64 字符、无空白/控制字符；非法按配置错误退出 2（与现有配置校验同一风格）。
- **必须稳定**：不要用 PID、时间戳、随机串。重装或换机才换值；换来的是新节点行，旧行不会自动回收。

### 2.2 请求头：执行面五个端点统一附带

`CMP-gateway` 的公共头层加两项（`X-Client-Id` 总是带；`X-Client-Address` 可选，建议填 `<hostname>:<port>` 或本机可达地址）：

| 端点 | 是否必须带 |
|---|---|
| `POST /executor/poll` | 是 |
| `POST /executor/tasks/{taskId}/result` | 是 |
| `POST /executor/tasks/{taskId}/session-log` | 是 |
| `GET /executor/skill-packages/{packageId}` | 是 |
| `POST /executor/runs/{runId}/archive` | 是 |

理由：每个端点都单独鉴权（服务端逐请求解析身份），只给 `poll` 带会导致结果上报 `401`。

### 2.3 配置校验：允许「非 loopback + 无 token」

现状（`src/components/cli/config.ts:233`）在非 loopback 且无 token 时直接退出 2（`scheduler_token_missing`）。开发期需要放宽为：有 `client_id` 即可通过；只有 `url`、`client_id` 都没有时才拒绝。生产回补时恢复严格。建议做法：新增一个开关（例如 `[scheduler] allow_unauthenticated = true`，默认 `false`），而不是直接删掉校验——这样回补时不用改代码。

### 2.4 `doctor`：多两项检查

| 检查项 | 内容 |
|---|---|
| `scheduler.client_id` | 生效值与来源（env / config / hostname），非法值报 fail |
| `scheduler.identity` | 无 token 时提示「当前以 `X-Client-Id` 自报身份（开发期），服务端 `EXECUTOR_AUTH=on` 时会返回 401」 |

## 3 验收（可用 curl 先行验证，不等客户端改完）

```bash
# 1) 自报身份 + 空批
curl -s -X POST http://127.0.0.1:3100/api/v1/executor/poll \
  -H 'x-executor-protocol: 3' \
  -H 'x-client-id: chenlong-mac-01' \
  -H 'x-client-address: 10.0.4.13:7801' \
  -H 'content-type: application/json' \
  -d '{"capacity":{"free":2},"running":[],"finished":[]}'
# 期望：200，tasks=[]；Harness 列表新增一行，clientId=chenlong-mac-01

# 2) 幂等：再发一次，列表 total 不变

# 3) 反例：不带任何身份头 → 401 unauthorized
```

| ID | 断言 |
|---|---|
| `TC-CLT-ENR-1` | 有 `client_id`、无 token：`poll` 返回 `200`，服务端节点行 `clientId` 等于配置值 |
| `TC-CLT-ENR-2` | 结果上报、会话日志、制品下载同样带 `X-Client-Id`：在同一 run 内均不返回 `401` |
| `TC-CLT-ENR-3` | `client_id` 为空/超长/含空格 → 配置期退出 2，错误码与现有配置错误风格一致 |
| `TC-CLT-ENR-4` | 有 token 时仍带 `Bearer`（两种模式共存，优先 Bearer） |

## 4 不做的事

- 不新增注册端点、不做心跳、不由服务端发放 token——`executor-http-v3` 仍然没有 `register`。
- 客户端不持久化服务端回写的任何身份：`clientId` 与 token 的权威仍在服务端（`harness.client_id` / `client_token`）。
- 副作用的容忍度：拼错 `clientId` 会在服务端产生一行垃圾节点，开发期接受；`EXECUTOR_AUTH=on` 后该路径完全关闭。

## 5 回补路径

`EXECUTOR_AUTH=on` 后，客户端继续用 `Bearer`；`X-Client-Id` 头会被忽略，可保留不删（成本为零），也可在切换到严格模式时一并移除。
