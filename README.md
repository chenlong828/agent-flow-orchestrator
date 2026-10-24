# AgentFlow · 编排服务（agent-flow-orchaster）

AgentFlow 研发智能体工作流编排服务的编排侧工程：目标是把「工作流定义 → 专家 / Skill / 工具装配 → 运行实例 → 效能数据」这条链路落成可运行、可验证的服务。

- 同族项目（关系待确认，见 [`docs/plan/open-questions.md`](docs/plan/open-questions.md) OQ-2）：[`../agent-flow-ui`](../agent-flow-ui) —— 同一「研发智能体工作流编排服务」的 UE 高保真原型
- 文档树：[`docs/`](docs/README.md)（五态分离，导航与阅读顺序见该页）
- 协作与门禁：[`AGENTS.md`](AGENTS.md)
- 技能：`.agents/skills/`（af-dev-skill v0.1，随仓库安装）

## 当前状态

控制面首批 **B1 资产注册中心**（Harness、工具、Skill、专家）已实现并通过验证：

- Bun 1.4.4 + PostgreSQL 18.4；模块化单体，8 个组件。
- 16 张业务表；4 个只向前迁移。
- 29 个 B1 业务端点 + `/healthz`，契约见 [`http-gateway/spec.md`](docs/design/components/http-gateway/spec.md) 与 [`openapi.yaml`](docs/design/components/http-gateway/openapi.yaml)。
- 演示种子：5 Harness / 10 工具 / 12 Skill / 8 专家，Skill 与工具装配边各 23 条。
- 实现结果与验证记录：[`result.md`](docs/works/2026-10-24-db-backend-infra/result.md)。

B2 Key/工作区、B3 工作流、B4 实例/看板、ACP 执行模型未实现；运行形态仍在 M2 设计，见 [`docs/plan/roadmap.md`](docs/plan/roadmap.md) 与 [`docs/plan/open-questions.md`](docs/plan/open-questions.md)。

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
# 端口被占用时可指定：PORT=3100 bun run dev
curl http://127.0.0.1:3000/healthz
```

验证：

```bash
bun test --max-concurrency=1   # 86 个测试
bun run typecheck              # tsc --noEmit
```

数据库连接默认 `postgres://postgres@127.0.0.1:54329/agentflow`；可用 `DATABASE_URL` 覆盖。`HOST`、`PORT`、`DEV_ACTOR`、`LOG_LEVEL` 见 [`platform/spec.md`](docs/design/components/platform/spec.md)。服务无登录/鉴权，只监听本机。

## 目录

```
.
├── AGENTS.md                 ← agent 协作规则、技能加载与门禁
├── .agents/skills/           ← 五个开发流程技能（项目级安装）
├── package.json              ← 运行、测试、迁移、种子脚本
├── tsconfig.json
├── db/migrations/            ← 0001～0004 只向前迁移
├── src/
│   ├── main.ts               ← 组合根与 Bun.serve
│   ├── core/kernel/          ← 错误、分页、ReferenceGuard、时钟/ID 端口
│   ├── core/platform/        ← 配置、DB/事务、迁移、健康检查
│   └── components/           ← harness / tool / skill / expert / catalog / http-gateway
├── scripts/                  ← PostgreSQL 启停、迁移、种子
├── tests/                    ← 组件、HTTP 契约、旅程、架构、种子测试
└── docs/                     ← 五态文档树
```

`.local/` 保存 Bun / PostgreSQL 二进制与数据，已被 gitignore，不入库。
