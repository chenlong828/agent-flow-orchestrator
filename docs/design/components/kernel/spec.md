---
layer: design
module: kernel
status: current
component: CMP-kernel
updated: 2026-11-11
---

# `CMP-kernel` 共享契约组件规格

## 1. 主目标

**只定义跨组件共享的契约词汇与端口**：统一错误分类、分页类型、引用检查端口、时钟与 ID 生成端口、文件存储端口；不实现业务规则、不访问数据库、不处理 HTTP。

## 2. 不负责

- 不实现 Harness/工具/Skill/专家业务规则。
- 不连接数据库、不执行 SQL、不管理迁移。
- 不解析 HTTP、不生成 DTO、不映射状态码。
- 不组合跨组件读模型；`catalog` 负责组合，`http-gateway` 负责传输。
- 不实现文件存储；只定义端口，由 `platform` 适配。
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
  | "file_conflict"           // 409
  | "draft_expired"           // 410
  | "payload_too_large"       // 413
  | "unsupported_media_type"  // 415
  | "skill_md_too_large"      // 422
  | "precondition_required"   // 428
  | "task_not_found"          // 404
  | "binding_conflict"        // 409
  | "package_unavailable"     // 500
  | "unsupported_protocol"    // 400
  | "unauthorized"            // 401
  | "run_not_found"           // 404
  | "run_conflict"            // 409
  | "session_log_missing"     // 409
  | "invalid_state"           // 409
  | "invalid_archive"         // 400
  | "unsupported_node_type"   // 400
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
class FileConflictError extends AppError {}
class DraftExpiredError extends AppError {}
class PayloadTooLargeError extends AppError {}
class UnsupportedMediaTypeError extends AppError {}
class SkillMdTooLargeError extends AppError {}
class PreconditionRequiredError extends AppError {}
class TaskNotFoundError extends AppError {}
class BindingConflictError extends AppError {}
class PackageUnavailableError extends AppError {}
class UnsupportedProtocolError extends AppError {}
class UnauthorizedError extends AppError {}
class RunNotFoundError extends AppError {}
class RunConflictError extends AppError {}
class SessionLogMissingError extends AppError {}
class InvalidStateError extends AppError {}
class InvalidArchiveError extends AppError {}
class UnsupportedNodeTypeError extends AppError {}
class DatabaseUnavailableError extends AppError {}
```

- 领域组件只抛上述错误类型；`http-gateway` 负责映射为 HTTP 状态码与 `error` 响应体。
- `ReferencedError.details` 至少包含 `references`，与 REST 契约的 `details` 结构一致。
- `name_conflict` 用于任何名称唯一约束冲突；Harness、工具、Skill、专家按各自唯一规则使用。
- `draft_expired` 只用于草稿记录仍在但 `expires_at` 已过；草稿已清理时用 `not_found`。
- `file_conflict` 用于草稿附件改名目标已存在；`revision_conflict` 只用于 revision/baseRevision 闸门。
- `payload_too_large` 覆盖单文件、文件数、包总量/草稿总量；`skill_md_too_large` 只覆盖生成的 `SKILL.md`。
- `package_unavailable` 表示已保存 Skill 的包缺失/损坏/`SKILL.md` 无效；不用于草稿目录缺失。
- `unauthorized` 只由执行面守护产生：Bearer 缺失或 token 未映射到 `clientId`；产品端点不使用。
- `task_not_found` 只用于执行面 `P-02`：请求的 `taskId` 不存在或不属于该 client 的实例；其他资源的「不存在」仍用 `not_found`。
- `binding_conflict` 只用于执行面的节点绑定与实例登记：Harness 登记时 `clientId` 或 token 已被其他节点占用（`details.field` 区分，凭据冲突不回显 token 值）；实例登记时同 `instanceId` 的 `clientId`/`workspacePath` 被改成不同值，或同一 client 下 `workspacePath` 重复登记。不用于任务或资产名称。
- `unsupported_protocol` 只用于 `X-Executor-Protocol` 与当前整数版本不匹配（`executor-http-v3` §3、§13）；请求体形状错误用 `validation_error`。
- `run_not_found` 只用于执行面 `P-05` 与产品面 run 端点：`runId` 不存在或其所属实例不绑定该 `clientId`；其他资源的「不存在」仍用 `not_found`。
- `run_conflict` 只用于启动 run：同一工作区（`instanceId`）已有 `running`/`waiting_confirm` 的 run；不用于任务冲突（任务归调度器）。
- `session_log_missing` 只用于执行面 `P-02`：结果到达时该 `taskId+attempt` 没有已上传并校验通过的会话日志；任务不结算、不重派。
- `invalid_state` 用于「当前状态不允许该操作」：`P-05` 的 run 未终态、产品面决策时节点不在 `waiting_confirm`；与 `revision_conflict` 的区别是后者只针对 revision 闸门。
- `invalid_archive` 只用于 `P-05`：gzip/tar 损坏、含绝对路径/`..`/越界符号链接、超出条目或解压总量上限。
- `unsupported_node_type` 只用于启动 run 时图含本期不支持的节点类型（`split`/`fanout`）；保存工作流时不使用（保存允许这两类）。
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
type ReferenceOwner = "harness" | "tool" | "skill" | "expert";

type Reference = {
  type: "tool" | "expert" | "workflow";
  id: string;
  name: string;
};

/** 只读专家状态端口；由 CMP-expert 实现，组合根注入工作流服务。 */
type ExpertStatusReader = {
  statuses(expertIds: string[]): Promise<Record<string, boolean>>;
};

type ReferenceGuard = {
  check(owner: ReferenceOwner, id: string): Promise<Reference[]>;
};
```

- `ReferenceGuard` 是端口，由 `catalog` 实现；领域删除服务只依赖本端口。`expert` owner 返回引用该专家的去重工作流摘要（`type="workflow"`）。
- 返回空数组表示可删除；返回非空数组表示被引用，由领域服务抛 `ReferencedError`。
- 本端口不负责删除后的级联清理；工作流删除级联自身定义/引用，不跨聚合删除专家。
- `ExpertStatusReader` 只返回启停状态，不暴露专家实体；供工作流保存/校验判断 `expert_missing` / `expert_disabled`。

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

### 3.5 文件存储端口

```ts
type FileData = Uint8Array | ReadableStream<Uint8Array>;

type FileStat = {
  key: string;        // 相对存储根的 POSIX 键
  size: number;       // 字节数
  modifiedAt: Date;
};

type FileStore = {
  put(key: string, data: FileData): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  head(key: string): Promise<FileStat | null>;
  list(prefix: string): Promise<FileStat[]>;
  delete(key: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
};
```

- 端口由 `platform` 实现；`skill` 只依赖本端口，不直接使用 Bun 文件 API。
- `key` 必须是相对存储根的 POSIX 路径；实现拒绝绝对路径、`..`、反斜杠与控制字符。
- `put` 原子覆盖：同根临时文件 → fsync 文件 → rename → fsync 目录；失败不留下半文件。
- `get` 返回流；不存在由调用方按 `head` 判定，`get` 失败抛平台存储错误。
- `head` 不存在返回 `null`；`list` 只返回文件，不返回目录，按 `key` 排序。
- `delete` 幂等，不存在视为成功；只删文件或空目录，不递归删非空目录。
- `move` 在同一存储根内原子改名；目标存在时由调用方先保证不存在。

### 3.6 执行面制品端口

```ts
/** 不可变技能包引用；packageId 与内容一一对应，由 CMP-skill 发放。 */
type SkillPackageRef = {
  packageId: string;
  skillId: string;
  name: string;
  version: string;
  digest: string;      // sha256:<hex>，包字节摘要
  sizeBytes: number;
  etag: string;        // HTTP ETag 值（含引号），与 P-03 一致
};

type SkillPackageSource = {
  /** 入队冻结：取 Skill 当前包的不可变引用。 */
  currentForSkill(skillId: string): Promise<SkillPackageRef>;
  /** P-03 解析：未知或已下架返回 null。 */
  describe(packageId: string): Promise<SkillPackageRef | null>;
  /** P-03 取流：与 describe 同一引用；包缺失/损坏抛 PackageUnavailableError。 */
  open(packageId: string): Promise<{ ref: SkillPackageRef; stream: ReadableStream<Uint8Array> }>;
};
```

- 端口由 `CMP-skill` 实现，组合根注入 `CMP-scheduler`（冻结技能集）与 `CMP-http-gateway`（`P-03` 供流）。
- `packageId` 必须对应不可变内容：内容变化必须换 `packageId`；`digest` 与 `etag` 由内容派生，不允许调用方自行拼装。
- `currentForSkill` 在 Skill 不存在时抛 `NotFoundError`，包缺失时抛 `PackageUnavailableError`；`describe` 只区分「有/无」，不抛包损坏。
- 端口不含 HTTP 语义（状态码、头部名、304 判定）；条件请求由 `CMP-http-gateway` 用 `etag` 比较后决定。

### 3.7 执行节点目录端口

```ts
/** 执行节点目录：client 节点是否可接任务。由 CMP-harness 实现，组合根注入 scheduler。 */
type NodeDirectory = {
  /** 节点存在、已绑定 clientId 且 enabled；未知 clientId 返回 false。 */
  isDispatchable(clientId: string): Promise<boolean>;
  /** 已绑定且 enabled 的 clientId；启动交集校验与排障用。 */
  listClientIds(): Promise<string[]>;
};
```

- 端口定义在 kernel，实现在 `CMP-harness` 的读契约之上；`scheduler` 只依赖本端口，不导入 Harness 组件。
- `isDispatchable` 只回答「节点是否接活」，不回答实例是否可派发；实例归属仍由 `CMP-instance` 判定。
- 端口不含在线状态：在线/离线/满载由 `CMP-scheduler` 的 presence 观测派生，`catalog` 组合展示（见 `harness` §3.3）。
- 端口不含 HTTP 语义；错误只抛 `DatabaseUnavailableError`（读库失败）。

### 3.8 执行面凭据解析端口

```ts
/** 执行面 Bearer 凭据解析：token → clientId。由 CMP-harness 实现，执行端路由使用。 */
type ExecutorAuthenticator = {
  /** 未知 token 或未绑定节点返回 null；不区分「凭据不存在」与「节点已解绑」。 */
  resolveClientId(token: string): Promise<string | null>;
};
```

- 端口定义在 kernel，实现在 `CMP-harness`（`harness.client_token` 唯一索引）；执行端路由只依赖本端口。
- 返回 `null` 时由调用方决定语义：执行端返回 `401 unauthorized`。
- 端口不含 HTTP 语义，也不返回节点状态；「节点启用/停用」由 `NodeDirectory` 回答。
- 错误只抛 `DatabaseUnavailableError`。

### 3.9 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 说明 |
|---|---|---|---|---|---|
| `normalizePageQuery` | 规范化分页参数 | `limit?`, `offset?` | `PageQuery` | `ValidationError` | 默认 50，上限 200 |
| `ReferenceGuard.check` | 查询引用方 | `owner`, `id` | `Reference[]` | 无 | 空数组表示可删除；owner 含 expert |
| `ExpertStatusReader.statuses` | 批量专家启停 | `expertIds[]` | `Record<string,boolean>` | 无 | 只读状态，不暴露实体 |
| `FileStore.put` | 原子写/覆盖 | `key`, `data` | `void` | 平台存储错误 | fsync 文件与目录 |
| `FileStore.get` | 读流 | `key` | `ReadableStream<Uint8Array>` | 平台存储错误 | 不存在由 `head` 判定 |
| `FileStore.head` | 文件元数据 | `key` | `FileStat \| null` | 平台存储错误 | 不存在返回 null |
| `FileStore.list` | 列文件 | `prefix` | `FileStat[]` | 平台存储错误 | 只返回文件，按 key 排序 |
| `FileStore.delete` | 幂等删除 | `key` | `void` | 平台存储错误 | 不存在成功；不递归 |
| `FileStore.move` | 原子改名 | `from`, `to` | `void` | 平台存储错误 | 同根内 |
| `SkillPackageSource.currentForSkill` | 取当前包引用 | `skillId` | `SkillPackageRef` | `NotFoundError`、`PackageUnavailableError` | 不读整包内容 |
| `SkillPackageSource.describe` | 解析包引用 | `packageId` | `SkillPackageRef \| null` | 无 | 未知返回 null |
| `SkillPackageSource.open` | 取包字节流 | `packageId` | `{ref, stream}` | `PackageUnavailableError` | 由 `skill` 实现；流不经过业务内存 |
| `NodeDirectory.isDispatchable` | 节点是否可接活 | `clientId` | `boolean` | `DatabaseUnavailableError` | 由 `harness` 实现；`enabled` + 已绑定 |
| `NodeDirectory.listClientIds` | 可派发节点清单 | 无 | `string[]` | `DatabaseUnavailableError` | 启动交集校验用 |
| `ExecutorAuthenticator.resolveClientId` | 凭据解析 | `token` | `string \| null` | `DatabaseUnavailableError` | 未登记/已解绑返回 `null` |

## 4. 依赖与边界

- 允许依赖：仅 TypeScript 标准库与纯类型工具。
- 禁止依赖：`platform`、任何领域组件、`catalog`、`http-gateway`、Bun/PostgreSQL 驱动。
- 本组件不拥有数据表；`schema_migrations` 属于 `platform`。
- **实现状态**：`binding_conflict`、`NodeDirectory`、`ExecutorAuthenticator` 已实现（节点目录）；`task_not_found`、`package_not_found`、`unsupported_protocol`、`unauthorized` 与 `SkillPackageSource` 端口已随调度层实现（2026-11-11）；`run_not_found`、`run_conflict`、`session_log_missing`、`invalid_state`、`invalid_archive`、`unsupported_node_type` 已设计冻结、随运行编排实现（2026-11-11）；其余错误类型与端口不变。
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
| 存储端口 | `put/get/head/list/delete/move` 的 key 约束、幂等与流语义稳定，领域可用假实现替换 |
| 制品端口 | `currentForSkill`/`describe`/`open` 的不可变与错误语义稳定，可用假实现替换 |
| 节点目录端口 | `isDispatchable`/`listClientIds` 的语义稳定，可用假实现替换；未知 client 返回 `false`/`[]` |
| 凭据解析端口 | `resolveClientId` 未知 token 返回 `null`；解绑后旧 token 返回 `null` |
| 依赖边界 | `kernel` 不导入 `platform`/领域/`catalog`/`http-gateway` |

## 6. 预算

- 目标 ≤35 KB；上限 ≤55 KB（源码 + 规格 + 测试）。
- 超出先合并重复类型，不新增抽象层。
