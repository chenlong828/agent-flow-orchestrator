---
layer: design
module: platform
status: current
component: CMP-platform
updated: 2026-10-29
---

# `CMP-platform` 组件规格

## 1 主目标

提供 B1 运行时基础设施：数据库连接与事务、迁移执行、ID/时钟实现、健康检查、测试库，以及 Skill 包/草稿的文件存储适配；不承载业务规则。

**不负责**：Harness/工具/Skill/专家的业务不变量、HTTP 路由、读模型拼装、包结构校验、启动配置加载（由 `CMP-config` 负责）。

## 2 拥有的数据

- `schema_migrations(version, checksum, applied_at)`：迁移版本记录。
- 迁移文件 `db/migrations/*.sql` 的读取与执行；不拥有业务表。
- 文件存储根（由组合根注入路径）：只做字节读写与目录操作，不解释包结构、不拥有业务键语义。

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

// Clock、IdGenerator、FileStore 的类型定义在 CMP-kernel；platform 只提供实现。
type Health = { check(): Promise<{ status: "ok" | "degraded"; database: "up" | "down" }> };

type FileStoreFactory = {
  create(root: string): FileStore;
};

class StorageError extends Error {
  operation: string;
  key?: string;
}
```

- `Db` 只暴露参数化查询与事务；不暴露连接字符串、驱动类型或 SQL 构建器。
- 迁移执行使用 advisory lock；只向前，不提供 down。
- 失败语义：迁移失败回滚当前事务并抛 `MigrationError`；数据库不可用抛 `DatabaseUnavailableError`；存储失败抛 `StorageError`；健康检查返回 `status=degraded`，不伪造 200。
- `FileStore` 只接受相对键；根路径由组合根从 `Config.skillStorageRoot` 注入，本组件不读配置。

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
| `FileStoreFactory.create` | 创建根目录绑定的存储适配器 | `root` | `FileStore` | `StorageError` | 根目录不存在时创建 |
| `FileStore.put` | 原子写入/覆盖 | `key`、`data` | `void` | `StorageError` | 同根临时文件 → fsync → rename → fsync 目录 |
| `FileStore.get` | 读取流 | `key` | `ReadableStream<Uint8Array>` | `StorageError` | 不存在抛错 |
| `FileStore.head` | 查文件元数据 | `key` | `FileStat \| null` | `StorageError` | 不存在返回 null |
| `FileStore.list` | 列目录/前缀 | `prefix` | `FileStat[]` | `StorageError` | 只返回文件，不返回目录；按 key 排序 |
| `FileStore.delete` | 删除文件/空目录 | `key` | `void` | `StorageError` | 不存在视为成功 |
| `FileStore.move` | 原子改名 | `from`、`to` | `void` | `StorageError` | 同一根内；目标存在时覆盖由调用方保证 |

`MigrationError`、`StorageError` 是平台内部错误；`DatabaseUnavailableError` 来自 `kernel`。`Health.check` 不直接写 HTTP 响应。

## 4 依赖与边界

- 允许：Bun 内置 `Bun.sql`、Bun 文件 API、Bun 运行时类型、PostgreSQL、`CMP-kernel` 的共享契约类型。
- 禁止：导入任何领域组件的 store/service；解释 `SKILL.md`/zip 结构；实现业务规则；直接拼 HTTP 响应；读取配置文件或进程环境。
- 启动配置由 `CMP-config` 产出，组合根注入数据库连接串与存储根；本组件不依赖 `CMP-config`。
- `ReferenceGuard` 端口是共享契约，不在本组件实现；由 `catalog` 实现，组合根注入。
- 存储适配器不拥有业务键语义；`package_key`/`draft_id` 的生成、当前指针与 GC 策略归 `CMP-skill`。

## 5 验证

- 迁移：空库执行全部迁移；重复执行不重复应用；校验 checksum 不匹配时失败；重建后为 4 个迁移、13 张业务表。
- 事务：提交后可见；抛错回滚；嵌套事务不被静默吞掉。
- `Bun.sql` 能力验证：参数化查询、事务、动态 SQL、唯一冲突错误映射；不足时停止并给选项。
- 健康检查：DB 可用时 `Health.check()` 返回 `ok`；断开时返回 `degraded`；`/healthz` 的状态码由 `http-gateway` 映射。
- 存储：写入后可读；覆盖原子；`head`/`list` 返回稳定；删除不存在不报错；路径穿越/绝对路径/反斜杠被拒绝；临时文件与 fsync 路径可观测。
- 架构测试：平台之外不直接使用 `Bun.sql` 或 Bun 文件 API；业务组件只依赖 `FileStore` 端口。

## 6 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 6 KB。
- 单独验证命令：`bun test tests/components/platform`。
- 当前状态：`current`；本规格是契约 v1 的目标状态，存储适配已由 T-SKP-09 实现；历史实现见 [`result.md`](../../../history/works/2026-10-24-db-backend-infra/result.md)（归档件，仅作追溯）。

## 7 B1 实现口径

- `Bun.sql` 的事务、动态 SQL 与错误映射已在 `T-B1-I02` 验证，实现继续使用 `Bun.sql`。
- 配置已拆到 `CMP-config`；本组件只接收 `databaseUrl` 与存储根，不再导出 `Config` / `loadConfig`。
- 测试库按进程独立命名（`agentflow_test_<pid>`，可用 `TEST_DATABASE_URL` 覆盖），由测试基座自动创建并迁移；不单独提供销毁脚本。
- 存储根默认 `.local/skills`，下分 `packages/`、`drafts/`、`tmp/`；测试使用独立根，不写真实用户目录。
- 包/草稿清理失败由 `CMP-skill` 的 GC 对账重试；平台只提供幂等删除原语。
