---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# 运行时 OpenAPI 资产与说明丰富度

## 背景

- 用户要求去掉 `docs/design/components/http-gateway/openapi.yaml` 这份设计期 Swagger 文档，改由 `CMP-http-gateway` 在运行时直接对外提供。
- 原实现虽然由 HTTP 组件读取该文件，但文件位于 `docs/design/`，且内容并不完整：30 个 operation 中 11 个没有 `description`，48 个 schema 全部没有 schema 级说明，字段级说明也为零。
- 因此本次同时完成两件事：把 OpenAPI 资产移入组件，并补齐方法介绍与字段注释，保证运行时 Swagger UI 不会比设计文档更单薄。

## 目标

1. `CMP-http-gateway` 直接持有并托管 OpenAPI 资产，启动后仍提供 `GET /docs` 与 `GET /openapi.yaml`。
2. 30 个 operation 全部有 `summary` 与 `description`；48 个 schema 全部有说明；核心 DTO 字段全部有字段说明。
3. 删除设计目录中的 OpenAPI 文件与失效链接，保留 `spec.md` 作为唯一契约权威。

## 范围

**做：**

- 把 OpenAPI 资产放到 `src/components/http-gateway/openapi.yaml`，由 `docs.ts` 默认从组件目录读取。
- `main.ts` 不再拼 `docs/design/.../openapi.yaml` 路径。
- 为 operation、schema 与 Harness/工具/Skill/专家核心 DTO 字段补中文说明。
- 更新 OpenAPI 结构测试、文档端点测试与相关文档链接。

**不做：**

- 不改 29 个业务端点、`/healthz`、数据库、迁移或组件切分。
- 不新增鉴权、CORS、Swagger Editor/Redoc、在线 Mock 或产品 UI。
- 不引入代码注解、装饰器或 OpenAPI 生成框架；本资产仍是手工维护。

## 改动级别与确认门

**P2**：涉及运行时文档资产、接口文档端点与多处文档链接；不改业务契约与数据所有权。

- 用户已直接要求“去掉这个设计的 swagger 文档”；本次按该请求执行。
- 合并前验证：`bun test tests/components/http-gateway`、`bun run typecheck`、本机 `/docs` 与 `/openapi.yaml` 冒烟。

## 任务表

| ID | 类型 | 组件 | 状态 | 产出 |
|---|---|---|---|---|
| `T-OPENAPI-01` | change | `CMP-http-gateway` | completed | 组件内 OpenAPI 资产、`docs.ts` 默认读取、`main.ts` 去设计路径 |
| `T-OPENAPI-02` | change | `CMP-http-gateway` | completed | operation/schema/DTO 字段说明 |
| `T-OPENAPI-03` | verify | `global` | completed | 文档结构与文档端点测试、全量测试、类型检查、本机冒烟 |

## 验收标准

- `docs/design/components/http-gateway/openapi.yaml` 不存在；运行时 OpenAPI 来自 `src/components/http-gateway/openapi.yaml`。
- `GET /openapi.yaml` 返回 200，可解析，`servers` 为相对地址 `/`。
- 30 个 operation 的 `summary` 与 `description` 均非空；48 个 schema 均有 `description`；核心 DTO 字段均有说明。
- `GET /docs` 返回 Swagger UI，引用本地资源并以 `/openapi.yaml` 初始化。
- 全量测试与 `bun run typecheck` 通过。
