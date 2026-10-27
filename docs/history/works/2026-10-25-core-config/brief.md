---
layer: history
module: global
status: frozen
updated: 2026-10-27
---

# 核出配置组件并支持 TOML 启动配置

## 背景与问题

本地 `localhost:3000` 已被其他进程占用；当前 `CMP-platform` 内的 `loadConfig` 只读环境变量，默认端口 3000，无法通过仓库内的配置文件调整启动端口。

用户确认：

- 新增独立配置组件 `CMP-config`，从 `CMP-platform` 拆出配置职责。
- 配置文件使用 TOML；`.env` 仍由 Bun 加载到 `process.env`，不重复解析。
- 启动配置优先级：代码默认值 < `config/default.toml` < `config/local.toml` < `process.env`。
- `DATABASE_URL` 继续从 `.env` / 环境读取，不进入入库的 TOML。

## 目标

- 新增 `CMP-config`（L0），负责 TOML 读取、合并、类型校验和 `Config` 输出。
- 用 `config/local.toml` 把本机端口设为 3100，解决 3000 被占用。
- `main.ts` 与数据库脚本只通过 `Config` 获取启动参数，不散落读取 `process.env`。
- 保留现有 `HOST`、`PORT`、`DATABASE_URL`、`DEV_ACTOR`、`LOG_LEVEL` 环境变量语义。

## 非目标

- 不做热更新、远程配置中心、密钥管理、CLI 参数。
- 不改变 REST API、DTO、数据库表、业务组件。
- 不补 API 契约的“每端点 3 正 1 反”缺口；那是独立任务。

## 已确认设计（P1）

```text
CMP-config
  输入：config/default.toml、config/local.toml、process.env（含 Bun 加载的 .env）
  输出：Config { host, port, databaseUrl, actor, logLevel }
```

- 文件格式：TOML，使用 Bun 内置 `Bun.TOML.parse`，不新增依赖。
- `config/default.toml` 入库；`config/local.toml` 不入库，只写本机覆盖；`config/local.example.toml` 入库示例。
- `CONFIG_FILE` 可选：设置后只读该文件，环境变量仍可覆盖。
- `databaseUrl` 只从 `DATABASE_URL` / 默认值获取；TOML 只承载非密钥启动参数。
- 非法 TOML、缺显式文件、未知键、非法端口 / 日志级别抛 `ConfigError`，启动失败。
- `core` 仍是目录容器，不是组件；组件数从 8 变为 9。

## 改动级别与确认门

**P1**：新增组件、移动配置职责、修改架构边界。

- 2026-10-25 用户确认“拆出单独组件 OK”，并确认接受 TOML 与 `.env` 经 `process.env` 覆盖的语义。
- 编码前先落本 brief、[`config/spec.md`](../../../design/components/config/spec.md) 与[决策记录](../../decisions/2026-10-25-config-component.md)。
- 完成后更新架构、平台规格、README 与 `result.md`。

## 任务表

| ID | 类型 | 组件 | 状态 | 装载清单 | 产出 |
|---|---|---|---|---|---|
| `T-CONF-01` | design | `global` | completed | 架构、platform、kernel | 本 brief、config 规格、决策记录 |
| `T-CONF-02` | change | `config` | completed | `src/core/platform/config.ts`、`src/main.ts`、脚本 | 新组件、main/脚本接入 |
| `T-CONF-03` | change | `config` | completed | 配置样例、README、架构/平台规格 | TOML 文件、文档同步 |
| `T-CONF-04` | verify | `global` | completed | config 测试、全量测试 | 单测、typecheck、3100 冒烟、result |

## 验收标准

- `loadConfig` 无文件时返回默认值；`config/local.toml` 只覆盖 port 时其他字段保留。
- `config/default.toml` / `local.toml` 的非法 TOML、未知键、非法端口、非法日志级别均抛 `ConfigError`。
- `PORT=...` / `.env` 中的环境变量覆盖 TOML；`CONFIG_FILE` 可指定单文件。
- 启动时不设置 `PORT`，读取 `config/local.toml` 后监听 3100，`/healthz` 返回 200。
- 全量测试、typecheck 通过；业务 API 与数据库结构无变化。
- 架构文档组件数为 9，platform 不再声明配置职责。

追溯：本工序无 `REQ`/`SCN`，属于用户直接要求的技术补充，按旁路处理；commit 绑定 `T-CONF-*`。
