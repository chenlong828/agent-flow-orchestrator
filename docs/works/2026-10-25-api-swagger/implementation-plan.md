---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# API Swagger 文档实施计划

> 状态：已实施；结果见 [`result.md`](result.md)。本文件保留实施前的计划，不再作为待办清单。
> 决策依据见 [`analysis.md`](analysis.md)。改动级别 **P2**；实现前需要用户确认本计划。

## 1 固定决策

| 项 | 决策 |
|---|---|
| 组件 | 不新增 `CMP-*`；在 `CMP-http-gateway` 内增加 `docs.ts` 子模块 |
| 渲染器 | Swagger UI 5.34.0，官方 dist 静态文件 |
| 资源交付 | vendor 到 `src/components/http-gateway/docs-assets/`，不新增 npm 依赖 |
| 路径 | `GET /docs`、`GET /docs/`、`GET /docs/*`、`GET /openapi.yaml` |
| OpenAPI server | `servers: [{ url: "/" }]`，跟随当前 host/port |
| 默认状态 | 随服务启动；无鉴权、无 CORS、无独立开关 |
| 契约来源 | `spec.md` 仍是权威；`openapi.yaml` 是机器可读导出，不代码优先生成 |
| 业务影响 | 29 个业务端点、`/healthz`、DTO、错误码、数据库均不变 |

## 2 任务分解

| ID | 类型 | 内容 | 依赖 | 完成判据 |
|---|---|---|---|---|
| `T-DOC-01` | design | 现状、方案比较、选定方案 | 无 | [`analysis.md`](analysis.md) 与本文件 |
| `T-DOC-02` | change | `docs.ts` + 网关委托 + 组合根注入 | `T-DOC-01` | `/docs`、`/openapi.yaml`、资源路由可用 |
| `T-DOC-03` | change | vendor 资源、OpenAPI `servers`、README/spec 更新 | `T-DOC-02` | 资源齐全、文档边界写清 |
| `T-DOC-04` | verify | 文档/OpenAPI/回归测试，手工冒烟，`result.md` | `T-DOC-02..03` | 全量测试与 typecheck 通过 |

## 3 文件级改动

### 3.1 新增 `src/components/http-gateway/docs.ts`

职责：只做文档路由与静态资源读取，不接触领域服务、数据库或业务 DTO。

```ts
export type ApiDocs = {
  handle(request: Request, url: URL): Promise<Response | null>;
};

export async function createApiDocs(options: {
  specFile: string;
  assetsDirectory: string;
}): Promise<ApiDocs>;
```

实现要点：

- 启动时 `await Bun.file(specFile).text()` 读入 OpenAPI 文本；读取失败直接抛错，服务不启动。
- 启动时检查 4 个静态资源存在；缺失同样 fail fast，避免页面半可用。
- 只接受 `GET`；路径不匹配返回 `null`，由 `createHttpApp` 走现有 404。
- 固定白名单：
  - `swagger-ui.css` → `text/css; charset=utf-8`
  - `swagger-ui-bundle.js` → `application/javascript; charset=utf-8`
  - `swagger-ui-standalone-preset.js` → `application/javascript; charset=utf-8`
  - `favicon-32x32.png` → `image/png`
- `/docs` 与 `/docs/` 返回内联 HTML；HTML 只引用 `/docs/*`，不引用 CDN。
- `/openapi.yaml` 返回启动时读入的文本，`content-type: application/yaml; charset=utf-8`。
- 所有文档响应加 `cache-control: no-cache` 与 `x-content-type-options: nosniff`。
- 不拼接用户输入到文件路径；未知 `/docs/*` 一律不读文件。

### 3.2 修改 `src/components/http-gateway/app.ts`

- `HttpDeps` 增加可选字段：`docs?: ApiDocs`。
- 在 `route()` 最前面、`/healthz` 之前委托：
  - 有 `docs`：`const docsResponse = await docs.handle(request, url); if (docsResponse !== null) return docsResponse;`
  - 无 `docs`：保持现状，`/docs` 落到现有 404。
- `errorResponse` 已经能兜住 `docs.handle` 抛出的异常；文档读取错误映射 500，不泄漏文件路径。
- 不改任何 `/api/v1/*` 分支、校验、DTO 或错误映射。

### 3.3 修改 `src/components/http-gateway/index.ts`

导出 `createApiDocs` 与 `ApiDocs` 类型，供 `main.ts` 和测试使用。

### 3.4 修改 `src/main.ts`

在创建 `app` 前构造文档：

```ts
const docs = await createApiDocs({
  specFile: join(process.cwd(), "docs", "design", "components", "http-gateway", "openapi.yaml"),
  assetsDirectory: join(process.cwd(), "src", "components", "http-gateway", "docs-assets"),
});
```

把 `docs` 注入 `createHttpApp`；启动日志追加：

```text
API 文档：http://<host>:<port>/docs
```

路径约定与迁移目录一致，使用 `process.cwd()`；从仓库根启动是现有运行方式。

### 3.5 新增 `src/components/http-gateway/docs-assets/`

从 `swagger-ui-dist@5.34.0` 取以下文件，按原样入库，不手改：

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `swagger-ui.css` | 187,576 | `c3cfe8248c4b0b89673600fb829924eafbac6de4bc4b2b06f5f5243483074d0a` |
| `swagger-ui-bundle.js` | 1,684,244 | `3f6abf70480db7e07914df4c98a77385f22ea585eaf457a3e6415ba0eae2d167` |
| `swagger-ui-standalone-preset.js` | 267,767 | `5243d492e14505e0cab87ac8b0195d0e615943e651743b2b698450a46eb470be` |
| `favicon-32x32.png` | 628 | `3ed612f41e050ca5e7000cad6f1cbe7e7da39f65fca99c02e99e6591056e5837` |

另放：

- `LICENSE`：Swagger UI 的 Apache-2.0 许可证原文。
- `NOTICE`：上游 NOTICE（若发行包提供）。
- `VERSION`：版本 5.34.0、来源 URL、取用日期、4 个文件的 SHA-256。
- `README.md`：说明这是 vendored 运行资源，不手改；升级时按同一来源替换并更新 `VERSION`。

仓库根增加 `.gitattributes`：

```gitattributes
src/components/http-gateway/docs-assets/** linguist-vendored
```

这样 GitHub 不把 Swagger UI 统计成项目源码；不影响 Bun 读取。

### 3.6 修改 `docs/design/components/http-gateway/openapi.yaml`

只做两处最小改动：

1. `info.description` 追加一句：Swagger UI 是开发者文档，不是产品 UI；文档页不参与业务契约。
2. `servers` 改为相对地址：

```yaml
servers:
  - url: /
    description: 当前文档所在服务；业务路径已包含 /api/v1，/healthz 不在版本内。
```

- 不在 `paths` 增加 `/docs` 或 `/openapi.yaml`；它们不是业务端点。
- 不改 29 个 operation、schema、错误码或示例。
- 该文件当前带 `x-generated: true` 但仓库没有生成脚本；本次按既有方式手工同步，并在 `result.md` 记为遗留风险，不补生成器。

### 3.7 修改 `docs/design/components/http-gateway/spec.md`

增加一节“开发者文档端点（非业务 API）”，写明：

- `/docs`、`/docs/*`、`/openapi.yaml` 的用途。
- 不计入 29 个业务端点，不参与 REST 版本。
- 无鉴权、无 CORS；与 API 一样默认只监听本机。
- Swagger UI 是开发者文档，不是产品 UI；`agent-flow-ui` 不依赖它。
- `openapi.yaml` 的 `servers` 为 `/`，`Try it out` 跟随当前 host/port。

主目标与依赖边界各补一句：文档子模块只读静态文件，不接触 store、数据库或领域服务。

### 3.8 修改 `README.md`

在“运行”之后增加“API 文档”：

- 启动后打开 `http://127.0.0.1:<port>/docs`。
- 机器可读文件：`/openapi.yaml`。
- 明确“开发者文档，不是产品 UI；不改变只提供 HTTP API 的边界”。
- 说明 `Try it out` 会真实读写本地 API，删除/更新操作会改数据。

## 4 HTTP 行为矩阵

| 请求 | 状态 | 响应 |
|---|---:|---|
| `GET /docs` | 200 | HTML，引用 `/docs/swagger-ui.css`、`/docs/swagger-ui-bundle.js`、`/docs/swagger-ui-standalone-preset.js` |
| `GET /docs/` | 200 | 同上 |
| `GET /openapi.yaml` | 200 | OpenAPI 文本 |
| `GET /docs/swagger-ui.css` | 200 | CSS |
| `GET /docs/swagger-ui-bundle.js` | 200 | JS |
| `GET /docs/swagger-ui-standalone-preset.js` | 200 | JS |
| `GET /docs/favicon-32x32.png` | 200 | PNG |
| `GET /docs/unknown` | 404 | 现有 JSON `not_found` |
| `POST /docs` | 404 | 现有 JSON `not_found` |
| `GET /docs/../openapi.yaml` | 200 或 404 | URL 规范化后是 `/openapi.yaml` 则正常返回；不得读出 `docs-assets` 之外的文件 |
| `GET /api/v1/harnesses` | 200/原有 | 行为不变 |

> 404/405 的选择：现有网关对错误方法统一 404，本次沿用，不单独引入 405。

## 5 页面配置

HTML 结构：

- `<div id="swagger-ui"></div>`
- 本地 CSS/JS 三个 `<script>`/`<link>`
- 初始化 `SwaggerUIBundle`：
  - `url: "/openapi.yaml"`
  - `deepLinking: true`
  - `presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset]`
  - `plugins: [SwaggerUIBundle.plugins.DownloadUrl]`
  - `layout: "StandaloneLayout"`
  - `tryItOutEnabled: true`
  - `displayRequestDuration: true`
  - `filter: true`
  - `persistAuthorization: false`
- 页面标题：`AgentFlow B1 API 文档`
- 页头说明：开发者文档，不是产品 UI；操作会真实修改本地数据。

不做：

- 自定义主题、品牌化、登录框。
- 多语言、Mock server、离线示例下载。
- 文档页的 `X-Request-Id` 回显；文档不是业务 API。

## 6 实施顺序

1. **`T-DOC-02` 路由骨架**
   - 新增 `docs.ts`，先用临时/空资源目录跑通 `/docs` 与 `/openapi.yaml`。
   - 接 `app.ts` 委托与 `index.ts` 导出。
   - 保持 `docs` 可选；现有测试应全部继续通过。
2. **`T-DOC-03` 资源与契约**
   - 下载并校验 4 个资源、许可证、VERSION。
   - 加 HTML/静态白名单。
   - 改 `openapi.yaml` 的 server 与说明。
   - 改 `spec.md`、`README.md`、`.gitattributes`。
3. **`T-DOC-04` 测试与冒烟**
   - 新增组件测试、OpenAPI 测试、网关集成测试。
   - 跑全量测试与 typecheck。
   - 用非 3000 端口启动，curl + 浏览器检查。
   - 写 `result.md`，更新测试数量与验证记录。

## 7 测试计划

### 7.1 `tests/components/http-gateway/docs.test.ts`

- `/docs`、`/docs/`：200、`text/html`、包含 `SwaggerUIBundle`、包含 `/openapi.yaml`、包含 3 个本地资源路径。
- `/openapi.yaml`：200、`application/yaml`、可被 `Bun.YAML.parse`。
- 4 个静态资源：200、正确的 content-type、body 非空；CSS 包含 `.swagger-ui` 或等价标记；bundle 包含 `SwaggerUIBundle`。
- 未知 `/docs/unknown`：404；`POST /docs`：404。
- 路径穿越尝试：不返回文档目录外的内容。
- 网关集成：`createHttpApp({...ctx, docs})` 下 `/docs` 200；未注入 `docs` 的 `ctx.app` 仍 404；`/healthz` 与一个业务端点不受影响。

### 7.2 `tests/components/http-gateway/openapi.test.ts`

- `Bun.YAML.parse` 成功；`openapi === "3.0.3"`。
- 18 个 paths、30 个 operations；operationId 唯一。
- 6 个 tags；每个 operation 的 tag 都在顶层 tags 中。
- 61 个 `components` 目标（7 parameters + 48 schemas + 6 responses）；290 处 `$ref` 全部可解析，无悬空。
- `servers[0].url === "/"`；`paths` 不含 `/docs`、`/openapi.yaml`。
- 29 个业务 operation + health 的计数断言（按 tag 或 `x-api-id`）。

### 7.3 回归

- 现有 86 个测试全部通过。
- `bun run typecheck` 通过。
- 架构测试：`http-gateway` 仍不导入 store/Db；`docs.ts` 只用 `Bun.file`/`node:path`，不触碰数据库。

### 7.4 手工冒烟

```bash
export PATH="$PWD/.local/bun:$PATH"
PORT=3100 bun run dev
```

另开终端：

```bash
curl -fsS http://127.0.0.1:3100/docs | grep -E 'SwaggerUIBundle|/openapi.yaml'
curl -fsS http://127.0.0.1:3100/openapi.yaml | head
curl -fsSI http://127.0.0.1:3100/docs/swagger-ui.css
curl -fsS http://127.0.0.1:3100/api/v1/harnesses | head
```

浏览器打开 `http://127.0.0.1:3100/docs`，确认：

- 6 个 tag、30 个 operation 可见。
- 页面资源不请求外网。
- `Try it out` 的请求发往 3100，不是 3000。
- 文档页能正常显示中文说明。

## 8 验收命令

```bash
.local/bun/bun test --max-concurrency=1
.local/bun/bun run typecheck
git diff --check
```

目标结果：

- 所有测试通过，测试数在现有 86 基础上增加文档与 OpenAPI 用例。
- typecheck 无错误。
- `git diff --check` 无空白错误。
- `git status` 只包含本工序文件；不误带 `.local/`、日志或数据库数据。

## 9 回滚

- 代码回滚：删除 `docs.ts`、`docs-assets/`，移除 `app.ts` 委托与 `main.ts` 注入；业务代码本来未改。
- 契约回滚：把 `openapi.yaml` 的 `servers` 恢复为 `http://127.0.0.1:3000`，移除 `info.description` 的文档句。
- 数据回滚：无数据库变更，不需要迁移回滚。
- 文档回滚：删除本工序目录或按流程归档；不改 B1 的历史文档。

## 10 提交

- `docs(T-DOC-01)`：分析计划，已单独提交。
- 实现提交：`feat(T-DOC-02..04): 增加 Swagger UI 与 OpenAPI 文档端点`，包含代码、静态资源、契约/README、测试与 `result.md`；这三项属于同一个交付，不拆成“先功能后测试”的中间状态。

## 11 已确认的决策

2026-10-25 用户确认执行，实际落地与验证见 [`result.md`](result.md)：

- 接受 vendor 约 2.14 MB 静态资源，不引入 `swagger-ui-dist` 依赖。
- 接受“不新增组件”，文档作为 `http-gateway` 子模块。
- 接受 `/docs` 默认随服务开启、无独立开关；生产访问控制不在本次范围。

若以后改为新增 `CMP-api-docs` 组件、引入 npm 依赖或增加 `DOCS_ENABLED` 开关，需要重新定级并调整计划。
