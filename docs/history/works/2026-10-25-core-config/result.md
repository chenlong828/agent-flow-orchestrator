---
layer: history
module: global
status: frozen
updated: 2026-10-27
---

# 结果：`CMP-config` 与 TOML 启动配置

## 结论

配置职责已从 `CMP-platform` 拆到独立 `CMP-config`。启动配置按以下顺序合并，并校验成扁平 `Config`：

```text
代码默认值 < config/default.toml < config/local.toml < process.env
```

`.env` 不单独解析；Bun 启动时已把它加载到 `process.env`。`DATABASE_URL` 仍只从 `.env` / 环境读取，不进入 TOML。

本机已用 `config/local.toml` 的 `[server] port = 3100` 启动，`/healthz` 返回 200；该文件已被 gitignore，不进入仓库。

## 交付物

| 落点 | 内容 |
|---|---|
| [`src/core/config/config.ts`](../../../../src/core/config/config.ts) | TOML 读取、`default`/`local` 合并、环境覆盖、`CONFIG_FILE`、字段校验 |
| [`src/core/config/errors.ts`](../../../../src/core/config/errors.ts) | `ConfigError` 与 `config_read_error` / `config_parse_error` / `config_validation_error` |
| [`src/core/config/index.ts`](../../../../src/core/config/index.ts) | `Config`、`LoadConfigOptions`、`LogLevel`、`loadConfig`、`ConfigError` |
| [`src/main.ts`](../../../../src/main.ts) / `scripts/*.ts` | 改为 `await loadConfig()`，平台不再导出配置 |
| [`config/default.toml`](../../../../config/default.toml) | 入库默认值：`127.0.0.1:3000`、actor `local`、log `info` |
| [`config/local.example.toml`](../../../../config/local.example.toml) | 本机 3100 端口示例 |
| [`config/spec.md`](../../../design/components/config/spec.md) | 组件契约、优先级、错误与验证 |
| [`architecture.md`](../../../design/architecture.md) | 组件数 8 → 9，依赖与数据所有权更新 |
| [`platform/spec.md`](../../../design/components/platform/spec.md) | 移除配置职责与 `Config` 契约 |
| [`README.md`](../../../../README.md) | 运行方式、优先级、目录与配置入口 |
| [`2026-10-25-config-component.md`](../../decisions/2026-10-25-config-component.md) | 结构决策与备选方案 |

## 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 配置单测 | `bun test tests/core/config.test.ts --max-concurrency=1` | 8 pass / 0 fail；覆盖默认值、default+local、env 覆盖、`CONFIG_FILE`、非法 TOML、未知键、非法端口/日志级别、空 HOST |
| 架构测试 | `bun test tests/architecture.test.ts --max-concurrency=1` | 6 pass / 0 fail；新增“config 只被组合根引用” |
| 类型检查 | `bun run typecheck` | pass |
| 全量测试 | `bun test --max-concurrency=1` | 184 pass / 0 fail / 1450 expect / 21 files（当前工作区；其中包含本工序之外的 API 契约补测） |
| 3100 启动 | 不设置 `PORT`，运行 `bun run src/main.ts` | 监听 `http://127.0.0.1:3100`；`GET /healthz` 返回 200 `{"status":"ok","database":"up"}` |
| 文件卫生 | `git diff --check` | 无空白错误 |

## 偏差与未纳入

- 默认端口仍是 3000；本机通过不入库的 `config/local.toml` 改为 3100。克隆仓库后需复制 `config/local.example.toml`。
- `CONFIG_FILE` 是显式单文件入口；设置后不再读 `default.toml` / `local.toml`，环境变量仍可覆盖。
- 不做热更新、远程配置、密钥管理、CLI 参数；这些超出本工序。
- 工作区存在本工序之外的 API 契约测试改动，未纳入本工序的 commit；全量计数包含它们。
- 未补 API“每端点 3 正 1 反”的剩余缺口；那是独立任务。

## 任务状态

`T-CONF-01` ～ `T-CONF-04` 均完成；工序可归档。提交绑定 `T-CONF-01..04`。
