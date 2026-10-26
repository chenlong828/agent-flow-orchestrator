# AgentFlow · 编排服务（agent-flow-orchaster）

AgentFlow 研发智能体工作流编排服务的编排侧工程：目标是把「工作流定义 → 专家 / Skill / 工具装配 → 运行实例 → 效能数据」这条链路落成可运行、可验证的服务。

- 对外形态：只提供 HTTP API（`/api/v1` + `/healthz`），不提供 CLI、SDK/库或产品 UI；Swagger UI 仅作为开发者文档。
- UI 是独立项目（不在本仓库内）：[`../agent-flow-ui`](../agent-flow-ui)；跨项目只按 REST 契约交互，本仓库不包含、不启动、不修改 UI。
- 文档树：[`docs/`](docs/README.md)（五态分离，导航与阅读顺序见该页）
- 协作与门禁：[`AGENTS.md`](AGENTS.md)
- 技能：`.agents/skills/`（af-dev-skill v0.1，随仓库安装）

## 当前状态

控制面首批 **B1 资产注册中心**（Harness、工具、Skill、专家）已实现并通过验证：

- Bun 1.4.4 + PostgreSQL 18.4；模块化单体，9 个组件（新增 `CMP-config`）。
- 15 张业务表；5 个只向前迁移。
- 31 个 B1 业务端点 + `/healthz`，契约见 [`http-gateway/spec.md`](docs/design/components/http-gateway/spec.md)；运行时 `/openapi.yaml` 与 Swagger UI `/docs` 由 HTTP 组件直接提供。
- Skill 契约 v2：`summary` 与 `triggers` 合并为 `description`（1–400 字），新增 `GET /skills/{id}/document` 输出 markdown 全文；见 [`result.md`](docs/works/2026-10-26-skill-contract-v2/result.md)。
- 开发者 API 文档：`/docs`（Swagger UI）与 `/openapi.yaml`，Swagger UI 资源已 vendor 到仓库，可离线使用。
- 演示种子：5 Harness / 10 工具 / 12 Skill / 8 专家，Skill 与工具装配边各 23 条。
- 实现结果与验证记录：[`result.md`](docs/works/2026-10-24-db-backend-infra/result.md)。

B2 Key/工作区、B3 工作流、B4 实例/看板、ACP 执行模型未实现；后续运行形态按实际需求另立工序，见 [`docs/plan/roadmap.md`](docs/plan/roadmap.md)。早期开放问题已关闭，当前无开放问题，见 [`docs/plan/open-questions.md`](docs/plan/open-questions.md)。

## 运行

项目内 Bun 不在全局 PATH 时，先加入当前 shell：

```bash
export PATH="$PWD/.local/bun:$PATH"
```

启动本地 PostgreSQL、执行迁移与种子：

```bash
bun run db:start
bun run db:migrate
bun run db:seed
```

启动 API（默认 `127.0.0.1:3000`）：

```bash
bun run dev
curl http://127.0.0.1:3000/healthz
```

本机端口被占用时，复制示例配置并修改端口：

```bash
cp config/local.example.toml config/local.toml
# 示例已写入 [server] port = 3100
bun run dev
curl http://127.0.0.1:3100/healthz
```

`config/local.toml` 已被 gitignore；也可以临时用 `PORT=3100 bun run dev` 覆盖。

## API 文档

启动服务后打开：

- Swagger UI：`http://127.0.0.1:<port>/docs`（默认 3000；由 `config/local.toml` 或 `PORT` 决定）
- OpenAPI 文件：`http://127.0.0.1:<port>/openapi.yaml`

这是开发者 API 文档，不是产品 UI；不改变本仓库只提供 HTTP API 的边界。`Try it out` 会真实调用本地 API，更新/删除/装配操作会修改数据库数据。

验证：

```bash
bun test --max-concurrency=1   # 199 个测试
bun run typecheck              # tsc --noEmit
```

配置优先级：代码默认值 < `config/default.toml` < `config/local.toml` < `process.env`（Bun 会自动把 `.env` 加载到 `process.env`）。`DATABASE_URL` 只从 `.env`/环境读取，不写入 TOML。`HOST`、`PORT`、`DEV_ACTOR`、`LOG_LEVEL` 与 `CONFIG_FILE` 见 [`config/spec.md`](docs/design/components/config/spec.md)。数据库连接默认 `postgres://postgres@127.0.0.1:54329/agentflow`。服务无登录/鉴权，只监听本机。

## 目录

```
.
├── AGENTS.md                 ← agent 协作规则、技能加载与门禁
├── .agents/skills/           ← 五个开发流程技能（项目级安装）
├── package.json              ← 运行、测试、迁移、种子脚本
├── tsconfig.json
├── config/                   ← default.toml、local.example.toml；local.toml 不入库
├── db/migrations/            ← 0001～0004 只向前迁移
├── src/
│   ├── main.ts               ← 组合根与 Bun.serve
│   ├── core/kernel/          ← 错误、分页、ReferenceGuard、时钟/ID 端口
│   ├── core/config/          ← TOML + 环境变量合并与校验
│   ├── core/platform/        ← DB/事务、迁移、健康检查
│   └── components/           ← harness / tool / skill / expert / catalog / http-gateway
├── scripts/                  ← PostgreSQL 启停、迁移、种子
├── tests/                    ← 组件、HTTP 契约、旅程、架构、种子测试
└── docs/                     ← 五态文档树
```

`.local/` 保存 Bun / PostgreSQL 二进制与数据，已被 gitignore，不入库。
