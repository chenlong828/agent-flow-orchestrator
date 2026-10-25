---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# API Swagger 文档（分析 + 实施计划）

## 背景

- B1 已交付 29 个业务端点 + `/healthz`，契约权威在 [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)，机器可读导出在 [`openapi.yaml`](../../../src/components/http-gateway/openapi.yaml)。
- B1 当时明确“OpenAPI 只作为 REST 契约的机器可读导出，不做 Swagger UI 部署”；本次是后续补充，不修改 B1 的历史结论。
- 2026-10-25 用户要求增加 API 的 Swagger 说明方案，先把分析与计划做完，再决定是否实现。
- 项目边界不变：本仓库只提供 HTTP API，不提供产品 UI、CLI 或 SDK/库；Swagger UI 是**开发者文档工具**，不是 `agent-flow-ui` 的产品界面。

## 目标

1. 在现有 Bun 服务上提供可浏览、可试调的 API 文档页。
2. 提供机器可读的 OpenAPI 文件，供 Swagger UI、Postman、前端适配层或外部工具直接获取。
3. 保持 `spec.md` 为契约权威，不引入代码注解、框架或第二套契约来源。
4. 用自动化测试锁住文档端点、静态资源和 OpenAPI 结构；不改变 29 个业务端点与数据库。

## 范围

**做：**

- 新增 `GET /docs`（含 `/docs/`）Swagger UI 页面。
- 新增 `GET /openapi.yaml`，返回当前 OpenAPI 契约。
- 新增 `/docs/*` 的本地 Swagger UI 静态资源。
- 修正 OpenAPI `servers` 为相对地址，使 `Try it out` 跟随当前服务端口。
- 在 `http-gateway/spec.md`、`README.md` 记录文档入口与边界。
- 新增文档端点、静态资源、OpenAPI 结构的测试。

**不做：**

- 不做产品 UI、页面路由、登录态、前端构建；不改 `agent-flow-ui`。
- 不新增 `CMP-*` 组件；文档是 `http-gateway` 的子模块。
- 不新增 npm 运行时依赖；Swagger UI 静态资源按固定版本 vendor 入库。
- 不做代码注解 / 装饰器 / 代码优先生成 OpenAPI；现有 `spec.md` → `openapi.yaml` 流程不变。
- 不做鉴权、CORS、限流、生产访问控制；与现有 API 一样，默认只监听本机。
- 不重写 30 个 operation 的描述与示例；现有 spec 已能驱动 UI，示例完善另行评估。
- 不新增业务端点、表、迁移或 B2/B3/B4 内容。

## 改动级别与确认门

**P2**：新增外部文档端点、第三方静态资源和跨文件改动；不触碰组件切分、业务契约、核心 schema、数据所有权或热路径，因此不升 P1。

- 2026-10-25 用户确认执行；实现与验证见 [`result.md`](result.md)。
- 合并前：自动化测试 + `typecheck` + 本机 `/docs` 冒烟通过；用户最终确认。
- 若实现中发现需要新增组件、运行时依赖、鉴权或改变业务契约，停止并按更高一级重新确认。

## 已确认方案（2026-10-25）

1. **不新增组件**：在 `CMP-http-gateway` 内增加 `docs.ts` 子模块，由 `createHttpApp` 在业务路由前委托；文档与 API 共用唯一 HTTP 入口。
2. **静态资源 vendor**：把 Swagger UI 5.34.0 的 `swagger-ui.css`、`swagger-ui-bundle.js`、`swagger-ui-standalone-preset.js`、`favicon-32x32.png` 及许可证放入 `src/components/http-gateway/docs-assets/`，不引入 `swagger-ui-dist` 及其 `@scarf/scarf` 安装统计。
3. **路径**：`/docs`、`/docs/*`、`/openapi.yaml`；不放在 `/api/v1` 下，不计入 29 个业务端点。
4. **相对 server**：`openapi.yaml` 的 `servers` 改为 `/`，`Try it out` 使用当前页面所在 host/port，不再硬编码 3000。
5. **默认开启**：随服务启动；无独立开关、无鉴权；生产暴露前另行加访问控制（本次不做）。

详细比较与实现步骤见 [`analysis.md`](analysis.md) 与 [`implementation-plan.md`](implementation-plan.md)。

## 任务表

| ID | 类型 | 组件 | 状态 | 装载清单 | 产出 |
|---|---|---|---|---|---|
| `T-DOC-01` | design | `global` | completed | `http-gateway/spec.md`、`openapi.yaml`、`src/main.ts`、`app.ts` | [`analysis.md`](analysis.md)、[`implementation-plan.md`](implementation-plan.md) |
| `T-DOC-02` | change | `http-gateway` | completed | `implementation-plan` §3–§5 | `docs.ts`、路由委托、`index.ts` 导出、`main.ts` 注入 |
| `T-DOC-03` | change | `http-gateway` | completed | `implementation-plan` §6–§7 | vendor 静态资源、OpenAPI `servers`、`spec.md` 与 README |
| `T-DOC-04` | verify | `global` | completed | `implementation-plan` §8–§9 | 文档/静态资源/OpenAPI 测试、`result.md` |

追溯：本工序是无 `REQ`/`SCN` 的技术补充，按旁路处理；`brief.md` + `implementation-plan.md` 为锚点，commit 绑定 `T-DOC-*`。结果见 [`result.md`](result.md)。

## 验收标准

- `GET /docs` 与 `GET /docs/` 返回 200 `text/html`，页面引用本地 CSS/JS，并以 `/openapi.yaml` 初始化 Swagger UI。
- `GET /openapi.yaml` 返回 200，内容可被 `Bun.YAML` 解析；30 个 operation、6 个 tag、相对 `servers` 通过结构测试。
- `/docs/swagger-ui.css`、`/docs/swagger-ui-bundle.js`、`/docs/swagger-ui-standalone-preset.js` 返回 200 且 content-type 正确；未知 `/docs/*` 返回 404，不允许路径穿越。
- 现有 29 个业务端点与 `/healthz` 行为不变；B1 全量测试仍通过。
- `bun run typecheck` 通过；新增测试覆盖 HTML、YAML、静态资源、错误路径与 `Try it out` 的 server 地址依据。
- `README.md` 与 `http-gateway/spec.md` 能说明“Swagger UI 是开发者文档，不是产品 UI”，且不破坏“只提供 HTTP API、无 CLI/库/UI”的边界。
- 本机用非 3000 端口启动后，`/docs` 的 `Try it out` 请求发往同一端口。

## 不在本工序

- 不做 Swagger Editor、Redoc/Scalar 多套文档站；只保留一套 Swagger UI。
- 不做在线 Mock、鉴权、CORS、访问统计、文档版本切换。
- 不把 `openapi.yaml` 纳入业务 API 的 OpenAPI `paths`；文档端点不是业务契约。
- 不做 CI、部署编排或反向代理配置；这些是后续生产化事项。

## 关联

- 契约：[`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)、[`openapi.yaml`](../../../src/components/http-gateway/openapi.yaml)
- 架构：[`architecture.md`](../../design/architecture.md)
- 前序工序：[`2026-10-24-db-backend-infra/brief.md`](../2026-10-24-db-backend-infra/brief.md)
- B1 结果：[`result.md`](../2026-10-24-db-backend-infra/result.md)
