---
layer: design
module: skill
status: current
component: CMP-skill
updated: 2026-10-29
---

# `CMP-skill` 组件规格

## 1 主目标

维护 Skill 聚合的 brief、包指针与草稿生命周期：保存时生成 `SKILL.md` 与 zip，原子切换包指针；读接口提供 brief、详情、`SKILL.md` 原文与整包下载。它是 `skill`、`skill_tag`、`skill_draft` 及存储根下 `packages/`、`drafts/` 的唯一写入口。

Skill 有两种消费方式：

- **管理面**：`catalog` 组合的列表/详情，给管理界面做检索、编辑与导航；详情包含 `body` 与文件清单。
- **编排面**：`getDocument` 返回包内 `SKILL.md` 原文；`getPackage` 返回完整 zip。编排器直接按整篇载入，不读数据库正文。

**不负责**：专家装配、版本历史、权限/草稿所有权、病毒扫描、运行时执行、HTTP 路由、UI 实现。

## 2 拥有的数据

| 表/存储 | 关键字段/键 | 说明 |
|---|---|---|
| `skill_category` | `code`、`label`、`position` | 参考数据，种子只读，无写接口 |
| `skill` | `id`、`name`、`category_code`、`description`、`package_key`、`version`、`enabled`、`revision`、审计字段 | 聚合根；`package_key` 非空唯一，指向当前 zip |
| `skill_tag` | `skill_id`、`position`、`tag` | 有序，级联删除 |
| `skill_draft` | `id`、`skill_id`、`base_revision`、`base_version`、`expires_at`、`created_at`、`created_by`、`updated_by` | 草稿元数据；目录键为 `id` |
| `packages/` | `package_key` | 已保存 zip；唯一键，数据库提交前不切换 |
| `drafts/` | `<draft_id>/` | 草稿完整包副本；不进入数据库正文 |
| `tmp/` | 临时文件 | 打包/上传中间态；失败清理 |

不变量：

- `name` 大小写不敏感唯一；`category_code` 必须存在；`description` 1–400 字。
- `version` 形如 `vX.Y`；新建 `v1.0`；更新 minor+1，`v1.9` → `v2.0`；客户端不可写。
- **zip 是内容唯一真相**；数据库只存 brief 与当前包指针，不存五章、踩坑、引用正文，不存文件内容。
- 包根必须且只能有 `SKILL.md`；只允许 `scripts/`、`references/` 及其子目录；空目录不写入包。
- `SKILL.md` frontmatter 只允许 `name`/`description`/`version` 三键；正文是 frontmatter 结束后的原始内容，读取时不 trim。
- `SKILL.md` 含 frontmatter ≤16384 UTF-8 字节；单文件未压缩 ≤20 MiB；文件数含 `SKILL.md` ≤100（附件 ≤99）；包总量未压缩 ≤100 MiB。
- 包内条目不接受目录条目、符号链接、绝对路径、`..`、反斜杠与控制字符；路径规则见契约 §9.3。
- 草稿是服务端完整包副本：已有 Skill 创建时复制当前包，包含只读 `SKILL.md`；新建草稿为空；`SKILL.md` 只能由保存生成，不能上传、改名或删除。
- 草稿 TTL 从创建起 24 小时，不滑动；过期但未清理返回 `draft_expired`，已清理返回 `not_found`。
- 收藏/保存不推进 revision；启停推进 revision 但不重建包；保存推进 revision/version 并消费草稿。
- 保存成功即删草稿；成功后重试 404，客户端刷新 Skill；未消费的并发保存按 revision 冲突，草稿保留。
- 不建版本历史；旧包删除失败交 GC 兜底。
- 删除 Skill 前调用 `ReferenceGuard`；有专家引用则抛 `ReferencedError`；通过后删 brief、当前包与草稿。
- 读列表不读 zip；详情只读 zip 中央目录与 `SKILL.md`，不读附件内容；文档与下载只读 zip。
- 停用 Skill 仍可读、可下载、可建草稿；启停不改变包与 `SKILL.md`。
- 数据结构按原地重建落成：重写 `0003_skill.sql`、删除 `0005_skill_description.sql`；重建后 13 张业务表、4 个迁移。

## 3 公共契约

```ts
type SkillDraftService = {
  createDraft(skillId: string | null, actor?: string | null): Promise<SkillDraft>;
  getDraft(id: string): Promise<SkillDraft>;
  uploadDraftFile(id: string, path: string, data: FileData): Promise<DraftFileResult>;
  renameDraftFile(id: string, path: string, newPath: string): Promise<DraftFileResult>;
  deleteDraftFile(id: string, path: string): Promise<void>;
  cancelDraft(id: string): Promise<void>;
  saveDraft(
    id: string,
    baseRevision: number | null,
    input: SaveSkill,
    actor?: string | null,
  ): Promise<SaveSkillResult>;
  setEnabled(
    id: string,
    revision: number,
    enabled: boolean,
    actor?: string | null,
  ): Promise<{ id: string; revision: number }>;
  delete(id: string, revision: number): Promise<void>;
  gc(graceMs?: number): Promise<{ packages: number; drafts: number }>;
};

type SkillRead = {
  list(query: SkillQuery): Promise<Page<SkillSummary>>;
  get(id: string): Promise<SkillDetail>;
  getSummary(id: string): Promise<SkillSummary>;
  getDocument(id: string): Promise<SkillDocument>;
  getPackage(id: string): Promise<SkillPackage>;
  listCategories(): Promise<SkillCategory[]>;
};
```

- 输入/输出使用领域字段；不出现 HTTP DTO、SQL 列名、multipart 字段名。
- `saveDraft` 的新建草稿传 `baseRevision=null`；已有草稿传草稿的 `baseRevision`，服务端同时校验当前 `skill.revision`。
- `setEnabled` / `delete` 以 `revision` 做乐观锁；`saveDraft` 以草稿 `baseRevision` + 当前 `revision` 做闸门。
- `delete` 先 `ReferenceGuard.check("skill", id)`；有引用不删除。
- `getDocument` / `getPackage` 读取当前包；包缺失或损坏抛 `PackageUnavailableError`，不回落 brief。

### 3.1 领域类型

```ts
type SkillSummary = {
  id: string;
  name: string;
  categoryCode: string;
  description: string;
  version: string;
  enabled: boolean;
  tags: string[];
  revision: number;
  updatedAt: string;
};

type SkillFile = {
  path: string;              // 相对包根，POSIX 分隔符
  size: number;              // 未压缩字节数
  readOnly: boolean;
};

type SkillDetail = SkillSummary & {
  body: string;              // SKILL.md 去掉 frontmatter 后的正文
  files: SkillFile[];        // 含 SKILL.md；SKILL.md 首项
  createdAt: string;
};

type SkillDraft = {
  id: string;                    // UUID；bearer capability
  skillId: string | null;        // 新建为 null
  baseRevision: number | null;   // 新建为 null
  baseVersion: string | null;    // 新建为 null
  expiresAt: string;             // ISO-8601
  createdAt: string;
  files: SkillFile[];            // 已有 Skill 含只读 SKILL.md；新建为空
};

type DraftFile = SkillFile;

type DraftFileResult = {
  file: DraftFile;
  files: DraftFile[];
};

type SkillDocument = {
  markdown: string;              // 包内 SKILL.md 原文
  revision: number;
};

type SkillPackage = {
  stream: ReadableStream<Uint8Array>;
  size: number;                  // zip 文件字节数；下载用 content-length
  filename: string;              // <name>-<version>.zip，已清洗
  revision: number;
};

type SaveSkill = {
  name: string;
  categoryCode: string;
  description: string;
  tags?: string[];
  body: string;                  // 可为空
};

type SaveSkillResult = {
  id: string;
  revision: number;
  version: string;
  updatedAt: string;
};

type CreateDraft = {
  skillId?: string | null;
};

type SkillCategory = {
  code: string;
  label: string;
  position: number;
};

type SkillQuery = {
  q?: string;
  category?: string;
  tag?: string;
  enabled?: boolean;
  page: PageQuery;
  sort?: "name" | "-name" | "updatedAt" | "-updatedAt" | "version" | "-version";
};
```

`SkillDetail` 的 `name`、`description`、`version` 以包内 `SKILL.md` frontmatter 为准；`categoryCode`、`tags`、`enabled`、`revision`、时间来自 brief。`SkillSummary` 由列表从 brief 读取，不读 zip。`SkillDetail.files` 在已保存状态全部 `readOnly: true`；`SkillDraft.files` 中 `SKILL.md` 为 `true`，附件为 `false`。

`SkillPackage.size` 是包文件字节数，用于下载 `content-length`；`getPackage` 不把整包读入业务内存，返回存储流。`FileData` 来自 `kernel`：`Uint8Array | ReadableStream<Uint8Array>`。

### 3.2 方法契约

| 方法 | 目的 | 输入 | 输出 | 错误 | 事务/并发 |
|---|---|---|---|---|---|
| `createDraft` | 建空草稿或复制当前包 | `CreateDraft` | `SkillDraft` | `NotFoundError`、`PackageUnavailableError`、`ValidationError` | 先建草稿记录；复制失败清理记录/目录 |
| `getDraft` | 读草稿清单 | `id` | `SkillDraft` | `NotFoundError`、`DraftExpiredError` | 读；不返回正文 |
| `uploadDraftFile` | 上传/覆盖附件 | `id`、`path`、`FileData` | `DraftFileResult` | `NotFoundError`、`DraftExpiredError`、`ValidationError`、`PayloadTooLargeError` | 单文件写入；同路径覆盖；TTL 不变 |
| `renameDraftFile` | 附件改名/跨目录 | `id`、`path`、`newPath` | `DraftFileResult` | `NotFoundError`、`DraftExpiredError`、`FileConflictError`、`ValidationError` | 目标必须不存在；`SKILL.md` 保留 |
| `deleteDraftFile` | 删除附件 | `id`、`path` | `void` | `NotFoundError`、`DraftExpiredError`、`ValidationError` | 只删附件；不推进 revision |
| `cancelDraft` | 取消草稿 | `id` | `void` | `NotFoundError` | 删记录/目录；过期按 204 清理 |
| `saveDraft` | 生成包并保存 | `id`、`baseRevision`、`SaveSkill` | `SaveSkillResult` | `ValidationError`、`NotFoundError`、`DraftExpiredError`、`RevisionConflictError`、`NameConflictError`、`PayloadTooLargeError`、`SkillMdTooLargeError`、`PackageUnavailableError`、`DatabaseUnavailableError` | 生成包 → fsync → 单事务切指针 → 删草稿；失败保留草稿 |
| `setEnabled` | 启停 | `id`、`revision`、`enabled` | `{ id, revision }` | `NotFoundError`、`RevisionConflictError` | 单行更新；不重建包 |
| `delete` | 删除 Skill | `id`、`revision` | `void` | `NotFoundError`、`RevisionConflictError`、`ReferencedError` | 先引用检查；删 brief/包/草稿 |
| `list` | 列表查询 | `SkillQuery` | `Page<SkillSummary>` | `ValidationError` | 读 brief，不读 zip |
| `get` | 详情 | `id` | `SkillDetail` | `NotFoundError`、`PackageUnavailableError` | 读中央目录 + `SKILL.md`；不读附件 |
| `getSummary` | 摘要，供 catalog 使用 | `id` | `SkillSummary` | `NotFoundError` | 读 brief |
| `getDocument` | `SKILL.md` 原文 | `id` | `SkillDocument` | `NotFoundError`、`PackageUnavailableError` | 读 zip；不缓存、不落库 |
| `getPackage` | 整包下载 | `id` | `SkillPackage` | `NotFoundError`、`PackageUnavailableError` | 返回存储流；不读入内存 |
| `listCategories` | 分类参考数据 | 无 | `SkillCategory[]` | 无 | 读 |

`saveDraft` 的失败边界：

- 元数据校验、名称冲突、revision 冲突、`SKILL.md` 超限、文件/总量超限、打包失败 → 草稿保留，旧包与 brief 不变。
- 新包写入成功但数据库失败 → 删除新包，旧包与 brief 不变，抛数据库错误；不产生半切换。
- 新包写入、fsync、数据库提交成功后才删草稿；删除草稿目录失败交 GC，不影响保存结果。
- 旧包删除失败交 GC；GC 只删非当前指针且超过 grace period 的包。

## 4 依赖与边界

- 允许：`platform` 的 `Db` 与 `FileStore` 实现；`kernel` 的 `Clock`、`IdGenerator`、`ReferenceGuard`、`FileData`/`FileStore` 端口与错误类型。
- 禁止：导入 `expert` 组件的 store/service；直接读 `expert_skill` 表；直接使用 Bun 文件 API；在组件内拼 HTTP 响应；解析 multipart。
- `skill_category` 只读；种子写入，Skill 服务不提供分类 CRUD。
- 存储键由本组件按 `packages/<package_key>`、`drafts/<draft_id>/...` 生成；`FileStore` 只接受相对键，拒绝绝对路径与 `..`。
- `SkillRead` 供 `catalog` 组合；不把领域实体直接暴露给 HTTP。
- 不维护正文/文件的第二真相：保存时从草稿包生成新包，读时从当前包读取。

## 5 验证

- 规则：名称唯一、分类存在、描述 1–400、版本进位、标签去重、`SKILL.md` 16 KiB、文件数/大小/路径限额。
- 构建：`SKILL.md` frontmatter 三键、正文归一化、最终一个换行；zip 根只有 `SKILL.md`，附件在 `scripts/`/`references/`，无目录条目/符号链接。
- 草稿：新建空草稿、已有 Skill 复制完整包、附件上传/覆盖/改名/删除、`SKILL.md` 保留、TTL 过期、取消、多个草稿并存。
- 保存：新建/更新、版本、`If-Match`/baseRevision、名称冲突、并发保存、成功后草稿 404、失败保留草稿、数据库失败清理新包。
- 读：列表不读 zip；详情 `body` 与 `files` 顺序；文档与 `SKILL.md` 逐字一致；下载 zip 可解压、文件名合规；停用可读。
- 持久化：原子写、fsync、包指针切换、旧包/草稿清理、GC 对账；包缺失/损坏返回 `package_unavailable`。
- 删除：引用保护、包/草稿清理、GC。
- 重建：重写 `0003`/删除 `0005` 后 13 张业务表、4 个迁移；种子 12 个 Skill 各有合法包与 23 条专家装配边。
- 契约：对应 REST 端点 3 正 1 反在 `http-gateway` 规格中列明。

## 6 预算与运行

- 预算上限：源码 + 规格 + 测试 ≤120k token；当前规格约 15 KB。
- 单独验证命令：`bun test tests/components/skill`。
- 当前状态：`current`；契约 v1 已由 T-SKP-08～T-SKP-15 实现，验证记录见 [工序 result.md](../../../works/2026-10-28-skill-package/result.md)；历史实现见 [`result.md`](../../../history/works/2026-10-24-db-backend-infra/result.md)（归档件，仅作追溯）。

## 7 B1 实现口径

- `skill_category` 固定为 `coding/retrieval/review/testing` 四个代码与中文标签。
- 种子重建 12 个 Skill：保留名称、描述、分类、标签、版本、启停与 23 条专家装配边；每个 Skill 生成合法 zip 与 `package_key`。
- 种子与保存共用同一个 `SKILL.md` 生成与打包函数，避免两种格式。
- 种子可重复执行：同名 Skill 更新包指针，旧包交 GC；不写旧子表。
- 不建版本历史；不提供单文件读取、草稿包预览、附件内联显示。
- 当前开发库是演示数据；重建直接 drop/recreate，不做升级迁移、不回填。

## 8 `SKILL.md` 与包结构

`getDocument` 返回包内 `SKILL.md` 原文；`get` 返回去掉 frontmatter 后的 `body`；两者都来自同一 zip。

```markdown
---
name: "调用链分析"
description: "基于 Call Trace 定位符号引用链，圈定影响面"
version: "v1.0"
---
## 适用场景
...
```

- frontmatter 只允许 `name`、`description`、`version` 三键，值为 YAML 双引号标量；由服务端生成，客户端不能直接写 `SKILL.md`。
- 正文是 frontmatter 结束后的剩余字节；保存时换行统一为 `\n`，生成后保证文件以且仅以一个 `\n` 结尾。
- 保存时按 `name`/`description`/`version` 生成 frontmatter；`description` 来自 brief，`version` 由服务端计算。
- 包内 `SKILL.md` 首项；附件按 `scripts/`、`references/` 存放；空目录不写入包；不写目录条目。
- 下载文件名为 `<name>-<version>.zip`，与包内路径无关；文件名清洗引号、CRLF、路径分隔符。
