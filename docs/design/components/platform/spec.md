---
layer: design
module: platform
status: current
component: CMP-platform
updated: 2026-10-25
---

# `CMP-platform` 组件规格

## 1 主目标

提供 B1 运行时基础设施：数据库连接与事务、迁移执行、ID/时钟实现、健康检查与测试库；不承载业务规则。

**不负责**：Harness/工具/Skill/专家的业务不变量、HTTP 路由、读模型拼装、启动配置加载（由 `CMP-config` 负责）。

## 2 拥有的数据

- `schema_migrations(version, checksum, applied_at)`：迁移版本记录。
- 迁移文件 `db/migrations/*.sql` 的读取与执行；不拥有业务表。

## 3 公共契约

```ts
type Db = {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
};

type Migrator = {
  up(): Promise<{ applied: string[]; skipped: string[] }>;
};

// Clock、IdGenerator 的类型定义在 CMP-kernel；platform 只提供实现。
type Health = { check(): Promise<{ status: "ok" | "degraded"; database: "up" | "down" }> };
```

- `Db` 只暴露参数化查询与事务；不暴露连接字符串、驱动类型或 SQL 构建器。
- 迁移执行使用 advisory lock；只向前，不提供 down。
- 失败语义：迁移失败回滚当前事务并抛 `MigrationError`；数据库不可用抛 `DatabaseUnavailableError`；健康检查返回 `status=degraded`，不伪造 200。

### 3.1 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 说明 |
|---|---|---|---|---|---|
| `Db.query` | 参数化查询多行 | `sql`, `params?` | `T[]` | `DatabaseUnavailableError` | 不暴露驱动类型 |
| `Db.one` | 参数化查询单行 | `sql`, `params?` | `T \| null` | `DatabaseUnavailableError` | 多行由调用方/约束保证 |
| `Db.transaction` | 事务边界 | `fn(tx)` | `T` | 原样抛出 `fn` 的错误 | 抛错回滚 |
| `Migrator.up` | 顺序执行迁移 | 无 | `{ applied, skipped }` | `MigrationError`、`DatabaseUnavailableError` | advisory lock；只向前 |
| `Health.check` | 健康检查 | 无 | `{ status, database }` | 无 | DB 断开返回 `degraded` |
| `Clock.now` | 当前时间 | 无 | `Date` | 无 | 实现 `kernel.Clock` |
| `IdGenerator.next` | 生成 UUIDv7 | 无 | `string` | 无 | 实现 `kernel.IdGenerator` |

`MigrationError` 是平台内部错误；`DatabaseUnavailableError` 来自 `kernel`。`Health.check` 不直接写 HTTP 响应。

## 4 依赖与边界

- 允许：Bun 内置 `Bun.sql`、Bun 运行时类型、PostgreSQL、`CMP-kernel` 的共享契约类型。
- 禁止：导入任何领域组件的 store/service；实现业务规则；直接拼 HTTP 响应；读取配置文件或进程环境。
- 启动配置由 `CMP-config` 产出，组合根注入数据库连接串；本组件不依赖 `CMP-config`。
- `ReferenceGuard` 端口是共享契约，不在本组件实现；由 `catalog` 实现，组合根注入。

## 5 验证

- 迁移：空库执行全部迁移；重复执行不重复应用；校验 checksum 不匹配时失败。
- 事务：提交后可见；抛错回滚；嵌套事务不被静默吞掉。
- `Bun.sql` 能力验证：参数化查询、事务、动态 SQL、唯一冲突错误映射；不足时停止并给选项。
- 健康检查：DB 可用时 `Health.check()` 返回 `ok`；断开时返回 `degraded`；`/healthz` 的状态码由 `http-gateway` 映射。
- 架构测试：平台之外不直接使用 `Bun.sql`。

## 6 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 4 KB。
- 单独验证命令：`bun test tests/components/platform`。
- 当前状态：`current`；平台命令已可执行，实施与验证的历史记录见 [`result.md`](../../../history/works/2026-10-24-db-backend-infra/result.md)（归档件，仅作追溯）。

## 7 B1 实现口径

- `Bun.sql` 的事务、动态 SQL 与错误映射已在 `T-B1-I02` 验证，实现继续使用 `Bun.sql`。
- 配置已拆到 `CMP-config`；本组件只接收 `databaseUrl`，不再导出 `Config` / `loadConfig`。
- 测试库按进程独立命名（`agentflow_test_<pid>`，可用 `TEST_DATABASE_URL` 覆盖），由测试基座自动创建并迁移；不单独提供销毁脚本。
