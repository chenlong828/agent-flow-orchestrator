---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# API Swagger 文档方案分析

> 本文只回答「现在有什么、为什么这样选、选了什么」。具体文件与步骤见 [`implementation-plan.md`](implementation-plan.md)。
> 结论：在 `CMP-http-gateway` 内增加文档子模块，托管 `/docs`、`/docs/*`、`/openapi.yaml`；Swagger UI 静态资源按 5.34.0 vendor；不新增组件、不新增 npm 依赖、不改业务 API。

## 1 现状盘点

### 1.1 契约

[`openapi.yaml`](../../design/components/http-gateway/openapi.yaml) 已覆盖 B1 的 29 个业务端点 + `/healthz`：

| 项 | 实测值 |
|---|---:|
| `openapi` | 3.0.3 |
| `paths` | 18 |
| operations | 30（29 业务 + health） |
| tags | 6（Harness、Tool、Skill、Expert、Reference、Health） |
| `components.parameters` | 7 |
| `components.schemas` | 48 |
| `components.responses` | 6 |
| `$ref` 引用 | 290 处，61 个去重目标；无悬空引用 |
| operationId | 30 个，无重复 |
| summary/description | 30 个 operation 均有 summary；98 处 description |
| examples | 5 处单值 `example`；几乎没有完整请求示例 |

结构上没有阻塞 Swagger UI 的问题：路径、operationId、tag、请求体、响应和错误 schema 都齐全。需要改的硬编码是：

```yaml
servers:
  - url: http://127.0.0.1:3000
```

服务实际可能用 `PORT=3100` 或其他端口；如果不改，Swagger UI 的 `Try it out` 会固定请求 3000，容易误判。

### 1.2 运行时

- 入口：[`src/main.ts`](../../../src/main.ts) 用 `Bun.serve({ fetch: app })` 启动；`app` 来自 `createHttpApp`。
- 路由：[`src/components/http-gateway/app.ts`](../../../src/components/http-gateway/app.ts) 是命令式 `if` 路由；只处理 `/healthz` 与 `/api/v1/*`，其他路径抛 `NotFoundError`。
- 没有静态文件目录、没有模板引擎、没有前端构建、没有 Swagger/OpenAPI 依赖。
- `HttpDeps` 目前只注入 catalog、四个写服务、health、actor；没有文档相关依赖。
- 组合根只负责创建依赖并注入，不承载业务规则；适合把文档路径配置放在这里。

### 1.3 前序边界

B1 的 [`brief.md`](../2026-10-24-db-backend-infra/brief.md) 明确写过“OpenAPI 只作为 REST 契约的机器可读导出，不做 Swagger UI 部署”。本次是用户新提出的补充，不改变 B1 的历史范围，也不把 B1 的结论改写成“当时已计划”。

同时，项目当前的“不提供 UI”指**产品 UI**；Swagger UI 是开发者文档工具，不进入 `agent-flow-ui`，不改变“只提供 HTTP API、无 CLI/库/产品 UI”的边界。这个区分必须写进 README 与组件规格，避免后续把 `/docs` 当成产品页面。

## 2 需求拆解

用户要的是“对 API 的 Swagger 说明方案”，可拆成四个能力：

| 能力 | 必要性 | 说明 |
|---|---|---|
| 可浏览的 API 文档页 | 必须 | Swagger UI 渲染 30 个 operation，按 tag 分组 |
| 机器可读契约 | 必须 | `/openapi.yaml` 供 UI、Postman、前端和测试读取 |
| 可试调 | 应当 | `Try it out` 对本地调试有价值；需相对 server 地址 |
| 离线可用 | 应当 | 本地/内网服务不应依赖 CDN 才能打开文档 |

不做代码优先生成：当前路由是命令式 Bun 代码，没有装饰器、路由框架或 schema 反射；要“从代码生成”就得重写网关或引入第二套 DSL，成本和漂移风险都高于直接消费已有 `openapi.yaml`。`spec.md` 仍是权威，OpenAPI 是它的机器可读导出。

## 3 方案比较

### 3.1 渲染器

| 方案 | 体积/依赖 | 试调 | 离线 | 结论 |
|---|---|---|---:|---|
| Swagger UI 5.34.0 | 3 个文件约 2.14 MB | 支持 | 是 | **推荐**：用户指定、生态成熟、与 OpenAPI 3.0 兼容 |
| RapiDoc 11 | 单文件约 537 KB | 支持 | 是 | 备选：更轻，但需要换渲染器与交互习惯，不是本次要求 |
| Redoc 3 | 单文件约 2.29 MB | 不支持（社区版） | 是 | 否决：缺少 Try it out |
| Swagger UI CDN | 0 本地文件 | 支持 | 否 | 否决：离线/内网不可用，版本不可复现 |
| 只给 `/openapi.yaml` | 0 | 外部工具 | 是 | 不满足“说明页”；可作为附属端点保留 |

体积数据来自 `swagger-ui-dist@5.34.0` 的实际文件：CSS 187,576 B、bundle 1,684,244 B、standalone preset 267,767 B、favicon 628 B。

### 3.2 静态资源交付

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| vendor 到仓库 | 离线、无安装脚本、无运行时路径依赖、版本可锁定 | 仓库增加约 2.1 MB minified 资源；升级需人工同步 | **推荐** |
| `swagger-ui-dist` npm 依赖 | 升级用包管理器，仓库不存资源 | 解包约 12 MB；带 `@scarf/scarf` 安装统计；从 `node_modules` 提供静态文件增加运行路径耦合 | 否决 |
| CDN | 零仓库体积 | 依赖外网、版本漂移、离线失败 | 否决 |
| 构建时复制到 `dist` | 仓库干净 | 项目没有构建步骤，启动方式就是 `bun run src/main.ts`；引入构建链超出本工序 | 否决 |

`swagger-ui-dist` 的 `@scarf/scarf` 是安装期统计依赖；Bun 的默认 trusted dependencies 包含它，普通 `bun install` 会执行其 postinstall。为一个文档页引入这类依赖不划算，vendor 更可控。

### 3.3 放置位置

| 方案 | 影响 | 结论 |
|---|---|---|
| `http-gateway/docs.ts` 子模块 | 复用唯一 HTTP 入口；不新增组件；文档与 API 一起测试 | **推荐** |
| 新增 `CMP-api-docs` 组件 | 独立生命周期、独立测试；但新增第 9 个组件，需要根路由分发，按 P1 走组件评审 | 暂不采用；若未来要多版本文档、独立鉴权或多份 spec，再提升为组件 |
| 单独文档服务器/端口 | 不碰 API 进程；但两个端口、部署与文档地址分裂 | 否决：当前只要一套本地文档 |

`http-gateway` 的主目标从“业务 API 翻译”扩展为“对外 HTTP 契约与开发者文档”；文档子模块与业务路由在文件层分开，避免把静态资源逻辑塞进 3000 行的 `app.ts`。这比新增组件更符合 KISS，也保留以后抽出的低成本接缝。

## 4 选定方案

### 4.1 路由与响应

| 方法 | 路径 | 响应 | Content-Type |
|---|---|---|---|
| GET | `/docs`、`/docs/` | Swagger UI HTML | `text/html; charset=utf-8` |
| GET | `/docs/swagger-ui.css` | 样式 | `text/css; charset=utf-8` |
| GET | `/docs/swagger-ui-bundle.js` | Swagger UI 主包 | `application/javascript; charset=utf-8` |
| GET | `/docs/swagger-ui-standalone-preset.js` | standalone preset | `application/javascript; charset=utf-8` |
| GET | `/docs/favicon-32x32.png` | 图标 | `image/png` |
| GET | `/openapi.yaml` | OpenAPI 3.0.3 | `application/yaml; charset=utf-8` |
| 其他方法 | 上述路径 | 404（与现有网关一致） | JSON 错误体 |
| GET | `/docs/<未知>` | 404 | JSON 错误体 |

- 文档端点不放进 `openapi.yaml` 的 `paths`；它们不是业务契约，避免把“文档”算进 29 个端点或让外部 UI 误消费。
- 静态资源按白名单解析，不接受任意文件名；`/docs/../...` 这类路径不进入文件系统。
- 文档 HTML 只引用本地 `/docs/*`，不引用 CDN；页面用 `/openapi.yaml` 初始化。
- 文档响应加 `x-content-type-options: nosniff`；缓存用 `no-cache`，避免升级资源后浏览器拿旧文件。

### 4.2 页面初始化

Swagger UI 使用 `SwaggerUIBundle` + `SwaggerUIStandalonePreset`，关键配置：

```js
SwaggerUIBundle({
  url: "/openapi.yaml",
  dom_id: "#swagger-ui",
  deepLinking: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  plugins: [SwaggerUIBundle.plugins.DownloadUrl],
  layout: "StandaloneLayout",
  tryItOutEnabled: true,
  displayRequestDuration: true,
  filter: true,
  persistAuthorization: false
});
```

`servers` 改为相对地址：

```yaml
servers:
  - url: /
    description: 当前文档所在服务；业务路径已包含 /api/v1，/healthz 不在版本内。
```

这样无论服务跑在 3000、3100 还是反向代理后的域名，`Try it out` 都发往当前文档所在 host/port。

### 4.3 启动与失败

- `createApiDocs` 在启动时读取 `openapi.yaml` 到内存，并检查 4 个静态资源是否存在；缺失则启动失败，不带病提供半套文档。
- `createHttpApp` 新增可选 `docs?: ApiDocs`；无 docs 时 `/docs` 走现有 404，现有测试不受影响。
- `main.ts` 用 `process.cwd()` 拼 `docs/design/components/http-gateway/openapi.yaml` 与 `src/components/http-gateway/docs-assets/`，与迁移目录的相对约定一致。

## 5 风险与处理

| 风险 | 影响 | 处理 |
|---|---|---|
| vendor 资源体积 | 仓库增加约 2.1 MB | 记录版本、来源、SHA-256、许可证；只放运行所需文件；`.gitattributes` 标 vendored |
| 契约漂移 | `/docs` 展示的 spec 与实现不一致 | 本次不改业务契约；新增 OpenAPI 结构测试；后续契约变更仍按 `spec.md` 流程 |
| `x-generated: true` 但无生成脚本 | 手工同步可能遗漏 | 记录为既有风险，不在本次补生成器；测试锁 operation 数、refs、server |
| Try it out 可写/可删 | 本机演示数据被误改 | 与现有无鉴权 API 风险相同；页面说明“仅本地/受控环境”，文档不额外扩大数据权限 |
| 无鉴权 | 非受控网络暴露全部 API 文档 | 与 API 同风险；默认只监听 `127.0.0.1`；生产暴露前另加访问控制，本次不做 |
| 浏览器缓存旧资源 | 升级 Swagger UI 后仍用旧文件 | `cache-control: no-cache` |
| 路径穿越 | 读取任意文件 | 只允许 4 个固定文件名，其他一律 404 |
| 文档被误认为产品 UI | 违反项目边界 | README、`spec.md`、页面标题都写明“开发者 API 文档，不是产品 UI” |
| 端口硬编码 | Try it out 请求错端口 | `servers: /`，测试断言相对地址 |

## 6 影响面

**会改：**

- `src/components/http-gateway/docs.ts`（新增）
- `src/components/http-gateway/app.ts`（委托）
- `src/components/http-gateway/index.ts`（导出）
- `src/main.ts`（注入文档）
- `src/components/http-gateway/docs-assets/*`（vendor 资源与许可证）
- `docs/design/components/http-gateway/openapi.yaml`（`servers`、边界说明）
- `docs/design/components/http-gateway/spec.md`（文档端点与边界）
- `README.md`（入口与边界）
- `tests/components/http-gateway/docs.test.ts`、`tests/contracts/openapi.test.ts`（新增）
- `docs/works/2026-10-25-api-swagger/result.md`（收口时）

**不会改：**

- 29 个业务端点、`/healthz`、DTO、错误码、`If-Match` 语义。
- 领域组件、catalog、kernel、platform、数据库表与迁移。
- `package.json` 运行时依赖、`bun.lock`（vendor 方案）。
- `agent-flow-ui`、CORS、鉴权、CI/部署。

## 7 验收与验证

| 层 | 验证 |
|---|---|
| 文档组件 | 直接调用 `createApiDocs`，断言 `/docs`、YAML、4 个资源、404、路径穿越、方法限制 |
| 网关集成 | `createHttpApp({..., docs})` 下 `/docs` 200；无 docs 时仍 404；业务端点不变 |
| OpenAPI 结构 | `Bun.YAML.parse`；30 ops、18 paths、30 个唯一 operationId、6 tags、61 个 components 目标、无悬空 `$ref`、`servers[0].url === "/"` |
| 静态资源 | content-type、非空 body、版本文件/许可证存在 |
| 回归 | 现有 86 个测试 + 新增测试；`bun run typecheck` |
| 手工 | `PORT=3100 bun run dev`，`curl /docs`、`/openapi.yaml`；浏览器打开 `/docs`，确认 30 个 operation 可见，Try it out 发往 3100 |

## 8 结论

采用 **`http-gateway` 文档子模块 + vendor Swagger UI 5.34.0 + `/docs` / `/openapi.yaml` + 相对 server**。

理由：不新增组件、不新增 npm 依赖、不引入构建链；离线可用、版本可锁；复用现有契约和唯一 HTTP 入口。代价是仓库多约 2.1 MB 静态资源，换取的是可控、可复现和不受安装脚本影响的文档能力。
