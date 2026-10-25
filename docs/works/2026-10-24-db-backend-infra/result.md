---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# 控制面 B1 资产注册中心：结果

## 结论

B1 的 29 个业务端点与 `/healthz` 已按 [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) 实现，使用 Bun + PostgreSQL、模块化单体与 8 个组件边界。类型检查通过，80 个测试全部通过，真实 PostgreSQL 上的迁移、种子与 HTTP 冒烟已验证。

用户于 2026-10-24 直接要求“分步骤逐渐实现当前 spec 中的 API”，据此把 `T-B1-D05` 契约复核门视为通过；未等到另行书面确认才编码。

## 交付内容

| 层 | 内容 | 落点 |
|---|---|---|
| 共享契约 | 错误分类、分页、`ReferenceGuard`、时钟/ID 端口 | [`src/core/kernel/`](../../../src/core/kernel/) |
| 平台 | 配置、`Bun.sql` 连接与事务、迁移执行器、健康检查 | [`src/core/platform/`](../../../src/core/platform/) |
| 迁移 | 16 张业务表 + 4 条 Skill 分类参考数据 | [`db/migrations/`](../../../db/migrations/) |
| Harness | 聚合、标签、启停、7 个端点 | [`src/components/harness/`](../../../src/components/harness/) |
| 工具 | 聚合、参数整体替换、Harness 归属、6 个端点 | [`src/components/tool/`](../../../src/components/tool/) |
| Skill | 聚合、五章、分类、版本递增、8 个端点 | [`src/components/skill/`](../../../src/components/skill/) |
| 专家 | 聚合、五区、装配、8 个端点 | [`src/components/expert/`](../../../src/components/expert/) |
| 目录 | 只读组合视图 + `ReferenceGuard` 实现 | [`src/components/catalog/`](../../../src/components/catalog/) |
| HTTP 网关 | 路由、传输层校验、DTO 映射、错误映射 | [`src/components/http-gateway/`](../../../src/components/http-gateway/) |
| 组合根 | 创建依赖、执行迁移、`Bun.serve`、优雅关闭 | [`src/main.ts`](../../../src/main.ts) |
| 种子 | 5 Harness / 10 工具 / 12 Skill / 8 专家、23/23 条装配边 | [`scripts/seed.ts`](../../../scripts/seed.ts) |
| 测试 | 组件、HTTP 契约、旅程、架构、种子、kernel/platform | [`tests/`](../../../tests/) |

## 验证结果

| 验证 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `bun run typecheck` | 通过，无输出 |
| 全量测试 | `bun test --max-concurrency=1` | 86 pass / 0 fail，14 个文件，445 个断言 |
| 迁移首次执行 | `bun run scripts/db-migrate.ts` | `applied=4 skipped=0` |
| 迁移重复执行 | 同上 | `applied=0 skipped=4` |
| 种子写入 | `bun run db:seed` | 5/10/12/8，Skill 边 23、工具边 23 |
| 生效 API | `PORT=3100 bun run src/main.ts` | `/healthz` 200 `{status:"ok",database:"up"}`；四类资产 `total` 为 5/10/12/8 |
| 引用查询 | `GET /api/v1/harnesses/{build-01}/references` | 返回 `smoke_runner`、`trace_call_chain` 两条工具引用 |

测试覆盖：四类资产的创建、列表筛选/分页/排序、详情、全量更新、启停（工具无启停）、删除保护、引用查询、专家装配；HTTP 成功与 400/404/409/428/503 映射；全链路旅程；跨组件依赖与数据所有权架构检查；种子幂等；分页/配置/健康检查。

## 实现口径与偏差

1. **HTTP 契约**：基础路径 `/api/v1`，`/healthz` 在版本外；创建 201 + `Location`；更新/启停/装配 200 + 详情；删除 204；列表 `{items,total,limit,offset}`。
2. **并发**：`PUT`、`PATCH enabled`、`DELETE`、专家装配必须带 `If-Match: "<revision>"`；缺少 428，旧版本 409，`details.currentRevision` 为当前值。创建不要求 `If-Match`。
3. **错误 body**：`{error:{code,message,details?,requestId?}}`；`database_unavailable` 在 HTTP 层映射为 `service_unavailable` 503。删除冲突的 `details` 按 `spec.md` §3.3 使用 `{asset, references}`。
4. **请求校验**：未知请求体字段（含 `params`、`refs`、`sections`、装配 `items` 的元素字段）返回 400；未知查询参数忽略；路径 ID 与 `harnessId`、`skillId`、`toolId` 做 UUID 形状校验。
5. **专家 `refCount`**：按 `spec.md` §5.4 的“B1 固定 0”返回 0；`refs` 仍完整返回。`skillCount`/`toolCount` 由装配关系实时派生。
6. **种子数据**：取自 `../agent-flow-ui/assets/js/mock-data.js`，ID 由 legacy ID 稳定派生；重复执行覆盖同一批种子行。种子中的 Harness `health`、工具 `status`/`lastDebugAt` 是 UI 夹具的演示值，仅用于本地演示；通过 API 新建的对象仍固定 `health=unknown`、`status=unverified`、`lastDebugAt=null`。UI 夹具中专家 e7 引用了不存在的 `sk-smoke2`，种子映射到语义最接近的 `sk-replay`，以保持 12 个 Skill 且装配边仍为 23 条；该映射在 `scripts/seed.ts` 中有注释。
7. **新增类型检查**：加入 `typescript`、`@types/bun` 两个 devDependency 与 `bun run typecheck`，解决实施计划 §9 待定项 2；未引入运行时依赖。
8. **端口**：配置默认仍为 3000；本机 3000 已被 `agent-flow-ui` 原型服务占用，冒烟改用 `PORT=3100`，未改默认值。

## 未做与边界

- 无登录/鉴权、多租户、CORS、限流、审计查询、Swagger UI 部署。
- 不做 Harness 心跳、工具调试/标记可用、运行时状态推进；新 Harness 固定 `health=unknown`、新工具固定 `status=unverified`。
- 不实现 B2/B3/B4 的表、端点、工作流节点引用；专家 `refCount` 因此固定 0。
- 不改 `agent-flow-ui` 源码；种子只用于本地演示，不代表 UI 已接入真实 API。
- 未做生产容量、SLA、故障演练；PostgreSQL 仅本机开发实例。

## 结论落点

| 内容 | 落点 |
|---|---|
| REST 端点与 DTO | [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md)、[`openapi.yaml`](../../../src/components/http-gateway/openapi.yaml) |
| 组件边界与依赖 | [`architecture.md`](../../design/architecture.md) |
| 表结构与迁移 | [`db/migrations/`](../../../db/migrations/) |
| 实现入口 | [`src/main.ts`](../../../src/main.ts) |
| 验证入口 | [`tests/`](../../../tests/)；`bun test --max-concurrency=1`、`bun run typecheck` |
| 种子入口 | [`scripts/seed.ts`](../../../scripts/seed.ts)；`bun run db:seed` |
| 运行命令 | [`README.md`](../../../README.md) |
