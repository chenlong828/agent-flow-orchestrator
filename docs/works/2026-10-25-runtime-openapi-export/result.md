---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# 运行时 OpenAPI 资产与说明丰富度：结果

## 结论

设计期的 `docs/design/components/http-gateway/openapi.yaml` 已删除；`CMP-http-gateway` 现在直接持有并托管 `src/components/http-gateway/openapi.yaml`，启动后仍通过 `/docs` 提供 Swagger UI、通过 `/openapi.yaml` 提供机器可读契约。业务端点、数据库和组件切分未改变。

原运行时文档的内容确实比设计文档单薄：审计发现 11/30 个 operation 缺少 `description`，48/48 个 schema 缺少 schema 说明，字段说明为 0。本次补齐后：

- 30/30 个 operation 均有非空 `summary` 与 `description`。
- 48/48 个 schema 均有 `description`。
- 核心 DTO 的 90 个字段均有中文说明（含 Harness、工具、Skill、专家及错误/引用页）。
- 资产约 68.9 KB，仍是手工维护文件，不依赖 `docs/` 是否存在。

## 实现内容

| 变更 | 落点 |
|---|---|
| OpenAPI 资产迁入组件 | [`src/components/http-gateway/openapi.yaml`](../../../src/components/http-gateway/openapi.yaml) |
| 默认从组件目录读取 OpenAPI | [`docs.ts`](../../../src/components/http-gateway/docs.ts)；`specFile` 变为可选，默认 `import.meta.dir/openapi.yaml` |
| 组合根去掉设计目录路径 | [`main.ts`](../../../src/main.ts) 只注入 `docs-assets` |
| 设计目录文件删除 | `docs/design/components/http-gateway/openapi.yaml` 已删除 |
| 契约与导航文档同步 | [`spec.md`](../../design/components/http-gateway/spec.md)、[`architecture.md`](../../design/architecture.md)、[`README.md`](../../../README.md)、[`docs/README.md`](../../README.md) |

## 验证结果

| 验证 | 命令 | 结果 |
|---|---|---|
| 文档端点与结构 | `./.local/bun/bun test tests/components/http-gateway/openapi.test.ts tests/components/http-gateway/docs.test.ts --max-concurrency=1` | 11 pass / 0 fail |
| 全量测试 | `./.local/bun/bun test --max-concurrency=1` | 186 pass / 0 fail，21 个文件，1826 个断言 |
| 类型检查 | `./.local/bun/bun run typecheck` | 通过，无输出 |
| 本机冒烟 | `PORT=3101 ./.local/bun/bun run src/main.ts` | `/healthz` 200 `{status:"ok",database:"up"}`；`/openapi.yaml` 30 ops 全部有说明、48 schemas 全部有说明；`/docs` 200 `text/html` 并引用 `/openapi.yaml` |

## 偏差与风险

- 没有引入 OpenAPI 生成器；资产由 `spec.md` 手工同步，后续契约变更仍需同步修改。原 `x-generated: true` 已移除，避免继续暗示存在自动生成流程。
- 没有新增 `/openapi.json`；保留既有 `/openapi.yaml` 路径，避免改变已经记录的开发者入口。
- `docs/works/2026-10-25-api-swagger/` 中关于旧路径的描述已改为组件内资产；该历史工序的结论不重写，仅同步失效链接与当前读取方式。

## 结论落点

| 内容 | 位置 |
|---|---|
| 运行时 OpenAPI | [`src/components/http-gateway/openapi.yaml`](../../../src/components/http-gateway/openapi.yaml) |
| 文档端点实现 | [`docs.ts`](../../../src/components/http-gateway/docs.ts) |
| 契约权威 | [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) |
| 自动化验证 | [`openapi.test.ts`](../../../tests/components/http-gateway/openapi.test.ts)、[`docs.test.ts`](../../../tests/components/http-gateway/docs.test.ts) |
