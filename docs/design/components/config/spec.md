---
layer: design
module: config
status: current
component: CMP-config
updated: 2026-10-25
---

# `CMP-config` 组件规格

## 1 主目标

把 TOML 配置文件与进程环境合并、校验，产出启动用的类型化 `Config`；不承载业务规则，不负责数据库、HTTP、日志或热更新。

**不负责**：数据库连接、迁移、HTTP 路由、业务组件、密钥管理、远程配置、配置热更新、CLI 参数。

**边界**：`CMP-config` 是 L0 技术组件；`core` 只是物理目录容器，不是组件。`.env` 由 Bun 在进程启动时加载到 `process.env`，本组件不重复解析 `.env`。

## 2 拥有的数据

- 无持久化数据；只在内存中持有一次启动的有效配置。
- 不拥有数据库表、缓存或运行时可变状态。

## 3 公共契约

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export type Config = {
  host: string;                 // 默认 127.0.0.1
  port: number;                 // 默认 3000
  databaseUrl: string;          // 默认本地 PostgreSQL；可由 DATABASE_URL 覆盖
  actor: string;                // 默认 local；可由 DEV_ACTOR 覆盖
  logLevel: LogLevel;           // 默认 info；可由 LOG_LEVEL 覆盖
};

export type LoadConfigOptions = {
  env?: Record<string, string | undefined>; // 默认 process.env
  configDir?: string;                        // 默认 process.cwd()/config
};

export type ConfigErrorCode =
  | "config_read_error"
  | "config_parse_error"
  | "config_validation_error";

export class ConfigError extends Error {
  code: ConfigErrorCode;
  source: string;       // 文件路径，或 env/default
  field?: string;       // 如 server.port、PORT
}

export function loadConfig(options?: LoadConfigOptions): Promise<Config>;
```

- `loadConfig` 是异步函数；入口和脚本使用 `await`。
- `Config` 字段保持扁平，调用方不需要知道文件分节结构。
- 错误不经过 HTTP 映射；启动失败直接抛出 `ConfigError`。

### 3.1 配置来源与优先级

```text
代码默认值
  < config/default.toml
  < config/local.toml
  < process.env（包含 Bun 从 .env 加载的值）
```

- 环境变量键：`HOST`、`PORT`、`DATABASE_URL`、`DEV_ACTOR`、`LOG_LEVEL`。
- 空字符串视为未设置，沿用现有行为。
- 已存在的 shell 环境变量优先于 `.env`；这是 Bun 的加载语义。
- `CONFIG_FILE`：可选环境变量，指定单个 TOML 文件；设置后不再读 `default.toml` / `local.toml`，环境变量仍可覆盖。
- `configDir`：测试注入用；运行时默认 `process.cwd()/config`。

### 3.2 TOML 结构

```toml
[server]
host = "127.0.0.1"
port = 3000

[app]
actor = "local"

[log]
level = "info"
```

- 只允许 `server`、`app`、`log` 三个顶层分节；未知分节/键报错。
- `server.host`、`app.actor`、`log.level` 为字符串；`server.port` 为 1–65535 的整数。
- `local.toml` 可以是部分文件，只覆盖需要改变的值。
- 文件不存在：`default.toml` / `local.toml` 缺失时使用现有默认值；`CONFIG_FILE` 指定的文件缺失时启动失败。
- TOML 只承载非密钥启动参数；`DATABASE_URL` 不从 TOML 读取。

## 4 依赖与边界

- 允许：Bun 内置 `Bun.TOML`、Bun 文件 API、Node 路径工具。
- 禁止：数据库、`Bun.sql`、HTTP 类型、业务组件、日志实现、环境变量读取散落到其他组件。
- 只有组合根 `src/main.ts` 和独立数据库脚本入口调用 `loadConfig`；领域组件、`catalog`、`http-gateway` 不依赖本组件。
- `platform` 不再导出 `Config` / `loadConfig`，也不再承担配置职责。

## 5 验证

- 默认值：无配置文件、无环境变量时返回默认 `Config`。
- 文件覆盖：`default.toml` 覆盖默认值；`local.toml` 只覆盖 port 时其他字段保留。
- 环境覆盖：`PORT`、`HOST`、`DATABASE_URL`、`DEV_ACTOR`、`LOG_LEVEL` 覆盖文件。
- 文件入口：`CONFIG_FILE` 指定单文件；缺失时报 `config_read_error`。
- 校验：非法 TOML、未知键、空白 host、非法 port、非法 log level 均报 `ConfigError`，并带字段。
- 进程冒烟：`config/local.toml` 设 3100，启动后 `/healthz` 返回 200。
- 架构测试：除入口/脚本/测试基座外，组件不得导入 `core/config`。

## 6 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 3 KB。
- 单独验证命令：`bun test tests/core/config.test.ts`。
- 当前状态：`current`；实施与验证的历史记录见 [`result.md`](../../../history/works/2026-10-25-core-config/result.md)（归档件，仅作追溯）。

## 7 B1 实现口径

- 端口默认保持 3000；本机通过 `config/local.toml` 的 `[server] port = 3100` 覆盖。
- `CMP-platform` 继续拥有 `schema_migrations`、数据库连接、迁移、ID/时钟和健康检查。
- `.env` 不进入 TOML，也不由本组件解析。
