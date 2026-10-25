---
layer: history
module: global
status: frozen
updated: 2026-10-25
---

# 决策：拆出 `CMP-config`，配置使用 TOML + 环境变量

## 背景

`CMP-platform` 同时负责配置、数据库、迁移、时钟和健康检查；配置只读环境变量，端口默认 3000。本地 3000 被占用，需要在不改代码的情况下通过配置文件调整端口。

## 决策

1. 新增 `CMP-config`（L0，`src/core/config`），从 `CMP-platform` 拆出 `Config` 与 `loadConfig`。
2. 配置文件使用 TOML；优先级为：代码默认值 < `config/default.toml` < `config/local.toml` < `process.env`。
3. `.env` 不单独解析；Bun 启动时把 `.env` 加载到 `process.env`，`CMP-config` 读取 `process.env` 即可实现 `.env` 覆盖 TOML。
4. `config/default.toml` 入库，`config/local.toml` 不入库，`config/local.example.toml` 入库示例。
5. `DATABASE_URL` 继续只从 `.env` / 环境读取；TOML 只承载非密钥启动参数。
6. 保留 `HOST`、`PORT`、`DATABASE_URL`、`DEV_ACTOR`、`LOG_LEVEL` 既有环境变量名，不新增环境变量层。

## 被否决的方案

- **继续放在 `CMP-platform`**：改动最小，但配置与运行时基础设施两个变化轴混在一个组件，且不符合用户要求的独立配置组件。
- **使用 YAML**：技术上可行，Bun 内置 `Bun.YAML`；但 YAML 的缩进、隐式类型和锚点能力对启动配置是额外复杂度，TOML 更直接。
- **配置组件自己解析 `.env`**：重复 Bun 的加载逻辑，容易出现引号、转义、加载顺序不一致；生产环境通常没有 `.env`，还需要保留进程环境变量入口。
- **把 `.env` 整体搬进 TOML**：密钥会进入配置文件，存在误提交风险；部署环境仍需环境变量覆盖。

## 后果

- 组件数从 8 变为 9；`platform` 规格移除配置职责。
- `main.ts` 和数据库脚本改为 `await loadConfig()`；配置文件缺失时使用默认值，显式 `CONFIG_FILE` 缺失时启动失败。
- 本机用 `config/local.toml` 设置端口 3100；`.env` / 环境变量仍可覆盖。
- 若以后需要热更新、远程配置或密钥管理，另立工序，不在本组件内顺手扩展。

## 确认记录

- 2026-10-25：用户确认新增独立配置组件、接受 TOML，并接受 `.env` 经 `process.env` 覆盖 TOML。
