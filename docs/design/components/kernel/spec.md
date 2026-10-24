---
layer: design
module: kernel
status: current
component: CMP-kernel
updated: 2026-10-25
---

# `CMP-kernel` 共享契约组件规格

## 1. 主目标

**只定义跨组件共享的契约词汇与端口**：统一错误分类、分页类型、引用检查端口、时钟与 ID 生成端口；不实现业务规则、不访问数据库、不处理 HTTP。

## 2. 不负责

- 不实现 Harness/工具/Skill/专家业务规则。
- 不连接数据库、不执行 SQL、不管理迁移。
- 不解析 HTTP、不生成 DTO、不映射状态码。
- 不组合跨组件读模型；`catalog` 负责组合，`http-gateway` 负责传输。
- 不持有任何业务数据或运行时可变状态。

## 3. 公共契约

### 3.1 错误

```ts
type ErrorCode =
  | "validation_error"        // 400
  | "not_found"               // 404
  | "name_conflict"           // 409
  | "revision_conflict"       // 409
  | "referenced"              // 409
  | "precondition_required"   // 428
  | "database_unavailable";   // 503

type ErrorDetails = Record<string, unknown>;

class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: ErrorDetails;
  readonly retryable: boolean;
}

class ValidationError extends AppError {}
class NotFoundError extends AppError {}
class NameConflictError extends AppError {}
class RevisionConflictError extends AppError {}
class ReferencedError extends AppError {}
class PreconditionRequiredError extends AppError {}
class DatabaseUnavailableError extends AppError {}
```

- 领域组件只抛上述错误类型；`http-gateway` 负责映射为 HTTP 状态码与 `error` 响应体。
- `ReferencedError.details` 至少包含 `references`，与 REST 契约的 `details` 结构一致。
- `name_conflict` 用于任何名称唯一约束冲突；Harness、工具、Skill、专家按各自唯一规则使用。
- `database_unavailable` 只由 `platform` 在连接不可用时抛出；`http-gateway` 映射为 503。

### 3.2 分页

```ts
type PageQuery = {
  limit: number;
  offset: number;
};

type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
```

- 领域查询接受已规范化的 `PageQuery`；`http-gateway` 负责解析查询参数并调用 `normalizePageQuery`。
- `normalizePageQuery(limit?: number, offset?: number): PageQuery` 对缺失值用默认值，对非法值抛 `ValidationError`，`limit` 上限 200。

### 3.3 引用检查端口

```ts
type ReferenceOwner = "harness" | "tool" | "skill";

type Reference = {
  type: "tool" | "expert";
  id: string;
  name: string;
};

type ReferenceGuard = {
  check(owner: ReferenceOwner, id: string): Promise<Reference[]>;
};
```

- `ReferenceGuard` 是端口，由 `catalog` 实现；领域删除服务只依赖本端口。
- 返回空数组表示可删除；返回非空数组表示被引用，由领域服务抛 `ReferencedError`。
- 本端口不负责删除后的级联清理；B1 没有跨聚合级联删除。

### 3.4 时钟与 ID 端口

```ts
type Clock = {
  now(): Date;
};

type IdGenerator = {
  next(): string;
};
```

- `platform` 提供实现；领域组件通过构造参数接收，不在内部直接读系统时钟或生成随机 ID。
- B1 的 ID 为 UUIDv7 字符串；端口签名不暴露 UUID 细节，替换实现不改变领域契约。

### 3.5 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 说明 |
|---|---|---|---|---|---|
| `normalizePageQuery` | 规范化分页参数 | `limit?`, `offset?` | `PageQuery` | `ValidationError` | 默认 50，上限 200 |
| `ReferenceGuard.check` | 查询引用方 | `owner`, `id` | `Reference[]` | 无 | 空数组表示可删除 |

## 4. 依赖与边界

- 允许依赖：仅 TypeScript 标准库与纯类型工具。
- 禁止依赖：`platform`、任何领域组件、`catalog`、`http-gateway`、Bun/PostgreSQL 驱动。
- 本组件不拥有数据表；`schema_migrations` 属于 `platform`。
- 所有公开类型不得包含 HTTP 状态码、SQL 行类型或框架类型。

## 5. 单独验证

```bash
bun test tests/components/kernel
bunx tsc --noEmit
```

| 验证 | 证明 |
|---|---|
| 错误码映射 | 每个 `AppError` 子类的 `code` 与 `retryable` 正确 |
| 分页 | 缺省、边界、超上限、负数均符合契约 |
| 引用端口 | 空/非空引用返回结构稳定，领域可用假实现替换 |
| 依赖边界 | `kernel` 不导入 `platform`/领域/`catalog`/`http-gateway` |

## 6. 预算

- 目标 ≤30 KB；上限 ≤50 KB（源码 + 规格 + 测试）。
- 超出先合并重复类型，不新增抽象层。
