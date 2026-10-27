---
layer: history
module: global
status: frozen
updated: 2026-10-27
---

# API Swagger 文档实现结果

## 结论

已交付 Swagger UI 文档页与机器可读 OpenAPI 端点，业务 API、数据库、组件切分均未改变：

- `GET /docs`、`GET /docs/`：Swagger UI 页面。
- `GET /docs/swagger-ui.css`、`/docs/swagger-ui-bundle.js`、`/docs/swagger-ui-standalone-preset.js`、`/docs/favicon-32x32.png`：本地静态资源。
- `GET /openapi.yaml`：当前 OpenAPI 3.0.3 契约，`servers` 为 `/`。
- 文档是开发者工具，不是产品 UI；没有新增 `CMP-*` 组件、npm 依赖、表或迁移。

## 任务结果

| ID | 状态 | 结果 |
|---|---|---|
| `T-DOC-01` | completed | [`analysis.md`](analysis.md) 与 [`implementation-plan.md`](implementation-plan.md) |
| `T-DOC-02` | completed | `docs.ts`、网关委托、`index.ts` 导出、`main.ts` 注入 |
| `T-DOC-03` | completed | Swagger UI 5.34.0 资源、OpenAPI `servers`、规格与 README |
| `T-DOC-04` | completed | 文档/OpenAPI 测试、全量回归、手工冒烟与本文 |

## 实现内容

### 代码

- 新增 [`src/components/http-gateway/docs.ts`](../../../../src/components/http-gateway/docs.ts)：
  - 启动时读取组件内 `openapi.yaml`，并检查 4 个静态资源；缺失则启动失败。
  - 只接受 `GET`；固定白名单；未知 `/docs/*` 返回 `null`，由网关映射 404。
  - 文档响应带 `cache-control: no-cache` 与 `x-content-type-options: nosniff`。
- [`app.ts`](../../../../src/components/http-gateway/app.ts)：`HttpDeps` 增加可选 `docs`，在业务路由前委托；不注入时保持原 404。
- [`index.ts`](../../../../src/components/http-gateway/index.ts)：导出 `createApiDocs` 与 `ApiDocs`。
- [`main.ts`](../../../../src/main.ts)：用 `process.cwd()` 定位 spec/资源并注入；启动日志增加文档地址。

### 静态资源

`src/components/http-gateway/docs-assets/` 来自 `swagger-ui-dist@5.34.0`：

| 文件 | 字节 |
|---|---:|
| `swagger-ui.css` | 187,576 |
| `swagger-ui-bundle.js` | 1,684,244 |
| `swagger-ui-standalone-preset.js` | 267,767 |
| `favicon-32x32.png` | 628 |

总计约 2.14 MB。另带 `LICENSE`、`NOTICE`、`VERSION`（版本、来源、SHA-256）与 `README.md`；根 `.gitattributes` 标记为 vendored。没有 `package.json`/`bun.lock` 变更。

### 契约与文档

- [`openapi.yaml`](../../../../src/components/http-gateway/openapi.yaml)：`servers` 改为 `/`；说明 Swagger UI 是开发者文档。
- [`spec.md`](../../../design/components/http-gateway/spec.md)：新增 §4.3 文档端点，说明不计入业务端点、无鉴权/CORS、本地资源与白名单。
- [`README.md`](../../../../README.md)：新增“API 文档”入口、`Try it out` 会改数据、非产品 UI 的边界。
- [`architecture.md`](../../../design/architecture.md)、[`AGENTS.md`](../../../../AGENTS.md)、[`open-questions.md`](../../../plan/open-questions.md) 同步“产品 UI”边界。
- [`roadmap.md`](../../../plan/roadmap.md) 记录本工序完成。

### 测试

- 新增 [`docs.test.ts`](../../../../tests/components/http-gateway/docs.test.ts)：HTML、YAML、4 个资源、404、路径穿越、错误方法、网关委托、缺少资源 fail fast。
- 新增 [`openapi.test.ts`](../../../../tests/components/http-gateway/openapi.test.ts)：30 operations、18 paths、6 tags、61 个 components 目标、290 个 `$ref`、无悬空引用、`servers: /`、文档路径不进业务 `paths`。

## 验证

```text
bun test --max-concurrency=1
95 pass
0 fail
729 expect() calls
Ran 95 tests across 16 files.

bun run typecheck
# 通过
```

### 手工冒烟

`PORT=3100 bun run src/main.ts` 后：

| 检查 | 结果 |
|---|---|
| `GET /docs` | 200 `text/html; charset=utf-8`，包含本地资源与开发者文档提示 |
| `GET /openapi.yaml` | 200 `application/yaml; charset=utf-8`，`servers: /` |
| `GET /docs/swagger-ui.css` | 200，187,576 B |
| `GET /docs/swagger-ui-bundle.js` | 200，1,684,244 B |
| `GET /docs/swagger-ui-standalone-preset.js` | 200，267,767 B |
| `GET /docs/favicon-32x32.png` | 200，628 B |
| `GET /docs/nope` | 404 |
| `GET /api/v1/harnesses` | 200，业务端点未受影响 |
| Headless Chrome 打开 `/docs` | 页面渲染，Harness/Tool/Skill/Expert 分区与开发者文档提示可见 |

## 偏差与取舍

- Swagger UI 资源使用 vendor，而不是 `swagger-ui-dist` 依赖；避免约 12 MB 解包与 `@scarf/scarf` 安装统计，代价是仓库增加约 2.14 MB。
- 增加 `favicon-32x32.png`；这是页面图标的运行资源，不改变原计划结构。
- 页面增加“开发者 API 文档（非产品 UI）/ Try it out 会修改数据”的提示，满足边界与风险提示要求。
- 没有补 30 个 operation 的请求示例；现有 schema 可驱动 UI，示例完善不在本工序。
- 没有新增独立开关或鉴权；与现有 API 一样默认只监听本机，生产暴露前另行处理。
- `openapi.yaml` 已移入 `src/components/http-gateway/`；它仍没有生成脚本，属手工维护资产，生成器缺失仍是遗留风险。

## 结论落点

| 内容 | 位置 |
|---|---|
| 文档端点契约 | [`http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) §4.3 |
| 机器可读契约 | [`openapi.yaml`](../../../../src/components/http-gateway/openapi.yaml) |
| 文档实现 | [`docs.ts`](../../../../src/components/http-gateway/docs.ts) |
| 静态资源与版本 | [`docs-assets/`](../../../../src/components/http-gateway/docs-assets) |
| 自动化验证 | [`docs.test.ts`](../../../../tests/components/http-gateway/docs.test.ts)、[`openapi.test.ts`](../../../../tests/components/http-gateway/openapi.test.ts) |
| 使用入口 | [`README.md`](../../../../README.md) “API 文档” |
