---
layer: works
module: skill
status: active
updated: 2026-10-28
---

# Skill 包形态 · 契约 v1（已冻结）

状态：**v1，P1 契约已确认（2026-10-28），已冻结。** 设计依据是 [design.md](design.md) v1（已确认、冻结）；本文件只定义 HTTP 契约、数据与重建口径、验收边界，不写实现。

契约已冻结；下一步只同步规格/OpenAPI，不进入编码。实现另开任务。

## 0. 一句话

Skill 的内容是一份 zip；数据库只存 brief、管理元数据、当前包指针与草稿记录。编辑先建草稿，附件在草稿里增删改，保存时生成 `SKILL.md`、打包并原子切换；读取只整包下载，不提供单文件访问。

## 1. 范围与破坏性

本轮替换 Skill 管理面的写契约，并改变读契约的详情与文档内容：

- **移除**：`POST /api/v1/skills`、`PUT /api/v1/skills/{id}`。创建与更新统一走草稿保存。
- **新增**：草稿资源、草稿文件操作、草稿保存、整包下载。
- **改变**：`GET /skills/{id}` 不再返回 `sections` / `pitfalls` / `refs`，改为 `body` + `files`；`GET /skills/{id}/document` 不再现场拼五章，返回包内 `SKILL.md` 原文。
- **不变**：列表筛选与分页、分类参考数据、启停、删除引用保护、专家装配、错误信封、`If-Match` / revision 语义、`X-Actor` 仅展示。

无鉴权；草稿 ID 本身是可读写能力凭证，拿到即可读写；`X-Actor` 只用于展示，不构成所有权。单机本地原型接受此限制，对外必须加鉴权。

破坏性变更只发生在 `/api/v1`；单消费方、无生产数据，不做 `/api/v2`。UI 侧 2026-10-27 提案中的 `body` + staging 设计被本契约取代。

## 2. 术语

| 术语 | 含义 |
|---|---|
| brief | 数据库中的 Skill 列表投影：name、description、version、分类、标签、启停、revision、时间 |
| package | 已保存的 zip，内容唯一真相；含 `SKILL.md`、`scripts/`、`references/` |
| `SKILL.md` | 包根入口；frontmatter 只有 `name`、`description`、`version`；正文为编排入口 |
| draft | 服务端临时包副本；含只读 `SKILL.md` 与可编辑附件；24 小时 TTL |
| published | 已保存状态；列表、详情、文档、整包下载可见 |
| consumed | 保存成功后草稿被删除；草稿 ID 不再可用 |

## 3. 数据与重建口径

### 3.1 表

| 表 | 变化 | 说明 |
|---|---|---|
| `skill` | 加 `package_key` | 当前包指针；非空、唯一；不暴露给 API |
| `skill_tag` | 不变 | 有序标签 |
| `skill_category` | 不变 | 参考数据，种子只读 |
| `skill_section` | 删除 | 五章不再入库 |
| `skill_pitfall` | 删除 | 踩坑不再入库 |
| `skill_ref` | 删除 | 引用资料不再入库 |
| `skill_draft` | 新增 | 草稿记录；目录由草稿 ID 定位 |
| `expert_skill` | 不变 | 装配边；`on delete restrict` 保留 |

`skill.package_key` 是不透明存储键，形如 `<uuid>.zip`；实际目录由存储层解析，数据库不存绝对路径。

`skill_draft` 字段：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | uuid | 主键 |
| `skill_id` | uuid / null | 新建草稿为空；已有 Skill 指向 `skill.id`，`on delete cascade` |
| `base_revision` | integer / null | 已有 Skill 时非空；新建为空 |
| `base_version` | text / null | 已有 Skill 时非空；新建为空 |
| `created_at` | timestamptz | 非空；TTL 起点 |
| `expires_at` | timestamptz | 非空；`created_at + 24h` |
| `created_by` | text | 展示名，不构成所有权 |
| `updated_by` | text | 最后一次草稿操作者展示名 |

约束：`skill_id`、`base_revision`、`base_version` 必须同时为空或同时非空；`expires_at > created_at`。索引：`skill_id`、`expires_at`。

预计重建后 13 张业务表（15 − 3 + 1），4 个迁移（`0001` / `0002` / `0003` / `0004`；重写 `0003`，删除 `0005`）。

### 3.2 重建，不做升级

- 不写升级迁移、不回填、不保留旧 Skill 数据；当前 Skill 都是演示数据。
- 重写 `0003_skill.sql`：直接建新结构（`skill` 含 `package_key`、`skill_tag`、`skill_category`、`skill_draft`），不再建 `skill_section`、`skill_pitfall`、`skill_ref`、`skill_trigger`，也不建 `summary`。
- 删除 `0005_skill_description.sql`；它要做的 `description` / `skill_trigger` 变化已并入新的 `0003`。`0004_expert.sql` 保留。
- 迁移链变为 `0001`、`0002`、`0003`、`0004` 共 4 个；不改 `0001`/`0002`/`0004`。
- 旧库不升级：已有库的 `0003` checksum 与新文件不一致，迁移器会拒绝；重建时先 drop/recreate 开发库。不保留旧数据与旧迁移历史。
- 重建步骤：停服务 → drop/recreate 开发库 → `bun run db:migrate` → `bun run db:seed` → 清空存储根。
- 不做备份/回滚；开发库可再次 drop/recreate。

### 3.3 种子

- 重建 12 个 Skill；保留现有名称、描述、分类、标签、版本、启停与专家装配关系（23 条边）。
- 每个 Skill 生成一个合法 zip 与 `package_key`；至少含 `SKILL.md`，可选 `references/` 示例附件。
- 种子与保存共用同一个 `SKILL.md` 生成与打包函数，避免两种格式。
- 种子可重复执行：同名 Skill 更新包指针，旧包交 GC；不写旧子表。
- 测试夹具增加 `skill_draft`，移除三张旧子表；`schema.test.ts` 改为 13 张业务表、4 个迁移。

## 4. 资源与字段

### 4.1 Skill

```ts
type SkillListItem = {
  id: string;              // UUID
  name: string;            // 1–80 字
  categoryCode: string;    // 必须存在
  categoryLabel: string;
  description: string;     // 1–400 字
  version: string;         // ^v\d+\.\d+$，服务端维护
  enabled: boolean;
  tags: string[];          // 有序、去重
  usedByCount: number;     // 引用专家数，catalog 组合
  revision: number;        // >= 1
  updatedAt: string;       // ISO-8601
};

type SkillFile = {
  path: string;            // 相对包根，POSIX 分隔符
  size: number;            // 未压缩字节数
  readOnly: boolean;
};

type SkillDetail = SkillListItem & {
  body: string;            // SKILL.md 去掉 frontmatter 后的正文
  files: SkillFile[];      // 含 SKILL.md；SKILL.md 首项
  createdAt: string;
};
```

`SkillDetail.files` 的 `readOnly` 在已保存状态全部为 `true`（发布包不可编辑）；`SKILL.md` 首项，其余按 `path` 升序。

### 4.2 草稿

```ts
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
```

草稿态 `SKILL.md` 的 `readOnly` 为 `true`；附件为 `false`。新建草稿在保存前没有 `SKILL.md`。

### 4.3 保存结果与分类

```ts
type SaveSkillResult = {
  id: string;
  revision: number;
  version: string;
  updatedAt: string;
};

type SkillCategory = {
  code: string;
  label: string;
  position: number;
};
```

## 5. 端点总表

路径均以 `/api/v1` 为前缀。

| ID | 方法 | 路径 | 目的 | 成功 | 主要错误 |
|---|---|---|---|---|---|
| SKP-01 | GET | `/skills` | 列表/检索 | 200 分页 | 400 |
| SKP-02 | GET | `/skills/{id}` | 详情 | 200 详情 | 404、500 |
| SKP-03 | GET | `/skills/{id}/document` | `SKILL.md` 原文 | 200、304 | 404、500 |
| SKP-04 | GET | `/skills/{id}/download` | 整包下载 | 200、304 | 404、500 |
| SKP-05 | GET | `/skill-categories` | 分类参考数据 | 200 | — |
| SKP-06 | GET | `/skills/{id}/references` | 引用专家 | 200 | 404 |
| SKP-07 | PATCH | `/skills/{id}/enabled` | 启停 | 200 详情 | 400、404、409、428、500 |
| SKP-08 | DELETE | `/skills/{id}` | 删除 | 204 | 404、409、428 |
| SKP-09 | POST | `/skill-drafts` | 建草稿 | 201 | 400、404、500 |
| SKP-10 | GET | `/skill-drafts/{id}` | 读草稿 | 200 | 404、410 |
| SKP-11 | POST | `/skill-drafts/{id}/files` | 上传/覆盖附件 | 200 | 400、404、410、413、415、500 |
| SKP-12 | PATCH | `/skill-drafts/{id}/files` | 改名 | 200 | 400、404、409、410、500 |
| SKP-13 | DELETE | `/skill-drafts/{id}/files` | 删除附件 | 204 | 400、404、410、500 |
| SKP-14 | DELETE | `/skill-drafts/{id}` | 取消草稿 | 204 | 404、410、500 |
| SKP-15 | POST | `/skill-drafts/{id}/save` | 保存 | 200/201 | 400、404、409、410、413、422、428、500、503 |

已移除 `POST /skills`、`PUT /skills/{id}`；调用按现有网关口径返回 404 `not_found`。

## 6. 读接口

### 6.1 列表 `SKP-01`

`GET /api/v1/skills`

查询参数沿用现状：`q`、`categoryCode`、`tag`、`enabled`、`limit`、`offset`、`sort`（`name`、`-name`、`updatedAt`、`-updatedAt`）。`q` 只匹配 brief 的 `name` 与 `description`，不搜正文、不搜 `references/`。

响应 `{ items: SkillListItem[], total, limit, offset }`。列表不读 zip。

### 6.2 详情 `SKP-02`

`GET /api/v1/skills/{id}` → `SkillDetail`。

- `name`、`description`、`version` 以 zip 的 `SKILL.md` frontmatter 为准；分类、标签、启停、revision、时间取自 brief。
- `body` 是 `SKILL.md` frontmatter 结束后的剩余字节，不在读取时 trim。
- 文件清单来自 zip 中央目录；不读文件内容。
- 包缺失或损坏：500 `package_unavailable`，不回落 brief。
- 停用 Skill 照常可读。
- brief 与包 frontmatter 不一致是数据错误；读接口不自动修复，排障或重建处理。

### 6.3 文档 `SKP-03`

`GET /api/v1/skills/{id}/document`

- 返回包内 `SKILL.md` 的原始字节；`content-type: text/markdown; charset=utf-8`。
- `ETag: "<revision>"`；`If-None-Match` 精确匹配时 304、无响应体；其他值按不匹配处理。
- `Cache-Control: no-cache`。
- 缺失 Skill 404；包/`SKILL.md` 缺失或损坏 500 `package_unavailable`。
- 条件请求在 Skill 与包存在性校验之后评估；包缺失不返回 304。
- 停用 Skill 照常返回。

### 6.4 整包下载 `SKP-04`

`GET /api/v1/skills/{id}/download`

- 返回已保存 zip；`content-type: application/zip`；`content-length` 为文件大小。
- `ETag: "<revision>"`；`If-None-Match` 精确匹配时 304。
- `Cache-Control: no-cache`。
- `Content-Disposition: attachment`；文件名 `<name>-<version>.zip`，同时提供 ASCII 回退与 `filename*=UTF-8''...`；清洗引号、CRLF、路径分隔符。
- `X-Content-Type-Options: nosniff`。
- 缺失 Skill 404；包缺失/损坏 500 `package_unavailable`；停用 Skill 照常可下载。
- 条件请求在 Skill 与包存在性校验之后评估；包缺失不返回 304。
- 不提供单文件下载、Range、内联预览。

### 6.5 分类与引用

- `GET /api/v1/skill-categories` 返回 `{ items: [{ code, label, position }] }`，无分页。
- `GET /api/v1/skills/{id}/references` 保持现有 `ReferencePage` 形状。

## 7. 草稿接口

### 7.1 建草稿 `SKP-09`

`POST /api/v1/skill-drafts`

请求：

```json
{ "skillId": "可选 UUID；缺省或 null 表示新建" }
```

- 已有 Skill：创建草稿记录，把当前包完整复制到草稿目录；`files` 含只读 `SKILL.md` 与附件；`baseRevision`、`baseVersion` 取当前值。
- 新建：只建空草稿目录；`skillId`、`baseRevision`、`baseVersion` 为 `null`；`files` 为空。
- `skillId` 不存在 404；包缺失/损坏 500 `package_unavailable`；复制失败清理草稿并报 500。
- 响应 201：`SkillDraft`；`Location: /api/v1/skill-drafts/{id}`。
- 允许对停用 Skill 建草稿；允许多个草稿并存。

### 7.2 读草稿 `SKP-10`

`GET /api/v1/skill-drafts/{id}` → `SkillDraft`。

- 不返回正文；`files` 含只读 `SKILL.md`（已有 Skill）与附件。
- 草稿不存在 404；已过期但未清理 410 `draft_expired`；已清理 404。
- 不提供草稿列表、草稿包下载或单文件读取。

### 7.3 上传/覆盖附件 `SKP-11`

`POST /api/v1/skill-drafts/{id}/files`

`content-type: multipart/form-data`，字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | text | 是 | 目标相对路径，如 `scripts/build.sh`、`references/api.md` |
| `file` | binary | 是 | 单个文件；一次一个 |

- `path` 必须位于 `scripts/` 或 `references/` 下；允许子目录；不接受 `SKILL.md`。
- 同路径覆盖（替换），不推进 revision/version；`files` 中路径唯一。
- 响应 200：`{ file: DraftFile, files: DraftFile[] }`；`files` 按 `SKILL.md` 首项、其余 `path` 升序。
- 文件 0–20 MiB；附件最多 99 个；总量含 `SKILL.md` ≤100 MiB。新建草稿预留 16 KiB 给 `SKILL.md`。
- 非 multipart 415 `unsupported_media_type`；字段缺失/路径非法 400；超限 413 `payload_too_large`。
- 不改变草稿 `expiresAt`。

### 7.4 改名 `SKP-12`

`PATCH /api/v1/skill-drafts/{id}/files`

```json
{ "path": "scripts/old.sh", "newPath": "references/new.sh" }
```

- 源必须是附件且存在；目标不能存在；`SKILL.md` 不可作为源或目标；新旧路径相同 400。
- 允许跨 `scripts/` 与 `references/`；路径规则同上传。
- 响应 200：`{ file: DraftFile, files: DraftFile[] }`。
- 目标已存在 409 `file_conflict`；源不存在 404；草稿过期 410。

### 7.5 删除附件 `SKP-13`

`DELETE /api/v1/skill-drafts/{id}/files?path=scripts/old.sh`

- 只删附件；`SKILL.md` 返回 400；不存在 404；成功 204。
- 不推进 revision/version。

### 7.6 取消草稿 `SKP-14`

`DELETE /api/v1/skill-drafts/{id}`

- 删除草稿记录与目录；成功 204。
- 不存在 404；已过期按 204 处理（能清理就清理），不返回 410。
- 不影响已保存 Skill。

### 7.7 保存 `SKP-15`

`POST /api/v1/skill-drafts/{id}/save`

请求：

```json
{
  "name": "调用链分析",
  "categoryCode": "coding",
  "description": "基于 Call Trace 定位符号引用链，圈定影响面",
  "tags": ["调用链", "Trace"],
  "body": "## 适用场景\n..."
}
```

- `name`、`categoryCode`、`description`、`body` 必填；`body` 可为空字符串；`tags` 可省略，默认 `[]`；未知字段 400。
- 不接受 `enabled`、`version`、`id`、`skillId`、`baseRevision` 或文件清单；启停另走 `SKP-07`。
- 已有草稿必须带 `If-Match: "<baseRevision>"`；缺失 428，格式非法 400，值不等于 `baseRevision` 或与当前 revision 不一致 409（`details.currentRevision`）。
- 新建草稿不带 `If-Match`；带了 400。
- 新建 Skill 版本 `v1.0`、revision 1、`enabled=true`；更新按现有规则 minor+1，`v1.9` → `v2.0`。
- 服务端生成 `SKILL.md`：frontmatter 固定 `name`、`description`、`version` 三键；正文为请求 `body`，换行统一为 `\n`，生成后保证文件以且仅以一个 `\n` 结尾。最终 UTF-8 字节数 ≤16384；超出 422 `skill_md_too_large`（`limitBytes`、`actualBytes`）。
- 校验草稿文件：路径、数量、单文件与总量、无符号链接；打包失败即保存失败。
- 成功：写新包 → fsync 文件与目录 → 数据库事务更新 brief、`package_key`、revision、version、时间并删除草稿记录 → 提交 → 删草稿目录、旧包交 GC。
- 响应：新建 201，更新 200；体为 `SaveSkillResult`；新建带 `Location: /api/v1/skills/{id}`。
- 失败：草稿保留，旧包与旧 brief 不变；新包/临时文件清理。数据库失败返回 503，不产生半状态。
- 保存成功即消费草稿；之后再 `GET` 该草稿 404。设计 §4 的“重复保存按冲突”指未消费的并发保存；成功后重试按 404 处理，客户端刷新 Skill 即可。

## 8. 保留的 Skill 写接口

### 8.1 启停 `SKP-07`

`PATCH /api/v1/skills/{id}/enabled`

- 请求 `{ "enabled": boolean }`；必须带 `If-Match`。
- 只改 brief 的 `enabled`，不重建包；revision+1。
- 响应 200 `SkillDetail`。
- 409 revision 冲突、428 缺头、404 不存在。

### 8.2 删除 `SKP-08`

`DELETE /api/v1/skills/{id}`

- 必须带 `If-Match`；先 `ReferenceGuard`，有专家引用 409 `referenced`。
- 通过后删 brief、当前包、草稿；包删除失败交 GC；成功 204。
- 不保留版本历史，不可恢复。

## 9. `SKILL.md` 与 zip

### 9.1 `SKILL.md`

```markdown
---
name: "调用链分析"
description: "基于 Call Trace 定位符号引用链，圈定影响面"
version: "v1.0"
---
## 适用场景
...
```

- 只允许 `name`、`description`、`version` 三个 frontmatter 键；YAML 双引号标量；值由服务端写入。
- `name` 1–80 字、大小写不敏感唯一；`description` 1–400 字；`version` 匹配 `^v\d+\.\d+$`。
- 正文是 frontmatter 结束后的内容；读取详情时不 trim。
- 总字节数含 frontmatter；上限 16384 字节（UTF-8）。

### 9.2 zip 结构

| 项 | 规则 |
|---|---|
| 根文件 | 必须且只能有 `SKILL.md` |
| 目录 | 只允许 `scripts/`、`references/` 及其子目录 |
| 文件数 | 含 `SKILL.md` 最多 100；附件最多 99 |
| 单文件 | 未压缩 ≤20 MiB |
| 总量 | 未压缩 ≤100 MiB |
| 条目 | 不允许目录条目、符号链接、绝对路径、`..`、反斜杠、控制字符 |
| 编码 | UTF-8 文件名；deflate 压缩 |
| 空目录 | 不写入包 |

`SKILL.md` 在包内首项；下载文件名不等于包内路径。

### 9.3 路径规则

- 相对路径，POSIX `/`；不以 `/` 开头，不以 `/` 结尾，无空段、`.`、`..`、反斜杠。
- 必须以 `scripts/` 或 `references/` 开头；`SKILL.md` 只能作为包根保留文件，不能作为附件。
- 允许 Unicode；拒绝 U+0000–U+001F、U+007F；整条路径 ≤512 字节，单段 ≤255 字节。
- 路径精确、大小写敏感；不做 Unicode 归一化；部署存储需大小写敏感。
- 同名上传覆盖；改名目标必须不存在。

## 10. 错误与并发

### 10.1 错误信封

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "数据已被其他操作修改，请刷新后重试",
    "details": { "currentRevision": 4 },
    "requestId": "..."
  }
}
```

`code` 稳定；`message` 面向人；`details` 面向机器；`requestId` 可选。

### 10.2 状态码与错误码

| HTTP | code | 何时 |
|---|---|---|
| 400 | `validation_error` | 字段缺失/类型/未知字段/路径非法/UUID 非法/If-Match 格式非法/`categoryCode` 不存在 |
| 404 | `not_found` | Skill、草稿、附件不存在 |
| 409 | `name_conflict` | Skill 名称大小写不敏感重复 |
| 409 | `revision_conflict` | `If-Match` 与当前 revision 不一致 |
| 409 | `referenced` | 删除时仍有专家装配 |
| 409 | `file_conflict` | 改名目标已存在 |
| 410 | `draft_expired` | 草稿过期但记录仍在 |
| 413 | `payload_too_large` | 单文件、文件数、包总量或草稿总量超限 |
| 415 | `unsupported_media_type` | 上传不是 multipart/form-data |
| 422 | `skill_md_too_large` | 生成的 `SKILL.md` 超过 16384 字节 |
| 428 | `precondition_required` | 需要 `If-Match` 但缺失 |
| 500 | `package_unavailable` | 已保存包缺失/损坏/`SKILL.md` 无效 |
| 500 | `internal` | 未分类内部错误 |
| 503 | `service_unavailable` | 数据库不可用（内部 `database_unavailable`） |

`details` 约定：

- `validation_error`：`{ field, reason }`，多字段用 `{ fieldErrors: [{ field, reason }] }`。
- `revision_conflict`：`{ currentRevision }`。
- `file_conflict`：`{ path, newPath }`。
- `draft_expired`：`{ expiresAt }`。
- `payload_too_large`：`{ limit: "file_bytes" | "file_count" | "package_bytes" | "draft_bytes", limitValue, actualValue }`。
- `skill_md_too_large`：`{ limitBytes: 16384, actualBytes }`。
- `package_unavailable`：`{ skillId }`。
- `not_found`：`{ resource, id }`；附件用 `{ resource: "DraftFile", path }`。

### 10.3 并发与重试

- `revision` 从 1 开始，保存与启停成功后 +1；删除后资源消失，不复用 revision。
- 已有草稿保存以 `baseRevision` + 当前 revision 为闸门；不一致即 409，不消费草稿。
- 两个草稿同一 base revision：先保存者成功，后保存者 409；草稿保留。
- 同一草稿并发保存：一个成功并删草稿，另一个 404；不会重复写。
- 保存响应丢失：刷新 Skill 确认；不要盲目重试同一草稿。
- 包文件按唯一键写入；数据库提交前不切换指针；失败删新包。
- 旧包删除失败由 GC 兜底；GC 只删非当前指针且超过 grace period 的包。

## 11. 限额与配置

| 项 | 值 | 失败 |
|---|---|---|
| `SKILL.md` | 16384 字节（含 frontmatter） | 422 `skill_md_too_large` |
| 单文件 | 20 MiB | 413 `payload_too_large` |
| 文件数 | 100（含 `SKILL.md`；附件 99） | 413 `payload_too_large` |
| 包总量 | 100 MiB（未压缩） | 413 `payload_too_large` |
| 草稿 TTL | 创建后 24 小时，不滑动 | 410 / 404 |
| 名称 | 1–80 字 | 400 |
| 描述 | 1–400 字 | 400 |
| 分类代码 | 1–50 字，必须存在 | 400 |
| 标签 | 非空、去重、有序；不设业务数量上限 | 400 |
| 路径 | ≤512 字节，单段 ≤255 字节 | 400 |

配置：

- 存储根默认 `.local/skills`（已被 `.gitignore` 覆盖），环境变量 `SKILL_STORAGE_ROOT` 覆盖。
- 草稿 TTL 默认 24 小时，环境变量 `SKILL_DRAFT_TTL_HOURS` 覆盖。
- 存储根下分 `packages/`、`drafts/`、`tmp/`；测试使用独立根。

## 12. 重建与验收

### 12.1 重建清单

1. 停服务；drop/recreate 开发库。
2. 清空存储根（包、草稿、临时文件）。
3. `bun run db:migrate`（新 `0003` + `0004`）；`bun run db:seed`。
4. 检查 13 张业务表、4 个迁移、12 个 Skill、23 条专家 Skill 边、每个 Skill 有包。
5. `bun test`；`bun run typecheck`。

### 12.2 契约验收

- 列表：brief 字段、筛选、`q` 只搜 name/description；不读 zip。
- 详情：`body` 与 `files`；`SKILL.md` 首项；包缺失 500；停用可读。
- 文档：与包内 `SKILL.md` 逐字一致；ETag/304；停用可读。
- 下载：zip 可解压；文件名合规；ETag/304；`nosniff`；停用可下载。
- 草稿：新建/已有、文件清单、TTL、过期、取消、无鉴权能力边界。
- 文件：上传、覆盖、改名、删除、跨目录、路径穿越、`SKILL.md` 保留、20 MiB / 99 附件 / 100 MiB。
- 保存：新建/更新、版本进位、名称冲突、revision 冲突、`If-Match` 缺失/格式、16 KiB、打包失败、数据库失败、草稿消费。
- 删除：引用保护、包/草稿清理、GC。
- 安全：zip 条目、符号链接、下载头注入、Markdown 展示端 sanitize、单文件不可读。
- 重建：表/迁移/种子/测试夹具同步。

## 13. 不在本契约

- 鉴权、权限、草稿所有权、多人协作隔离。
- 版本历史、按 revision 下载旧包、回滚。
- 病毒扫描、运行时执行、脚本沙箱。
- 单文件读取、附件内联显示、草稿包预览。
- `/api/v2`、CORS、UI 实现。
- 生产迁移/回填；开发库直接重建。

## 14. 已确认的落点

以下已确认，作为 v1 冻结内容：

1. 文件总数含 `SKILL.md`，附件上限 99。
2. 保存用 `POST /skill-drafts/{id}/save`；移除 `POST /skills`、`PUT /skills/{id}`。
3. 整包下载用 `GET /skills/{id}/download`。
4. `enabled` 不进入保存请求；新建默认 `true`，启停走 `PATCH /skills/{id}/enabled`。按 MVP 简化：编辑状态丢失就重开草稿，不做已消费草稿的幂等恢复。
5. 详情 `files` 含 `SKILL.md`；发布态全部 `readOnly: true`，草稿态仅 `SKILL.md` 为 `true`。
6. 保存成功即删草稿；成功后重试 404，客户端刷新 Skill。
7. 新增 `draft_expired`、`file_conflict`、`payload_too_large`、`unsupported_media_type`、`skill_md_too_large`、`package_unavailable` 六个错误码。
8. 重写 `0003_skill.sql`、删除 `0005_skill_description.sql`；重建后 13 张业务表、4 个迁移。

本文件已冻结。变更另起 v2，不直接改 v1。

## 15. 确认记录

- 2026-10-28：文件数含 `SKILL.md`，附件最多 99。
- 2026-10-28：保存统一走 `POST /skill-drafts/{id}/save`；移除 `POST /skills`、`PUT /skills/{id}`。
- 2026-10-28：整包下载用 `GET /skills/{id}/download`。
- 2026-10-28：`enabled` 不进保存；沿用 `PATCH /skills/{id}/enabled`；按 MVP 简化，不做幂等恢复。
- 2026-10-28：发布态 `files` 全部 `readOnly: true`；草稿态仅 `SKILL.md` 为 `true`。
- 2026-10-28：保存成功删草稿；成功后重试 404。
- 2026-10-28：新增 6 个专用错误码。
- 2026-10-28：重写 `0003`、删除 `0005`；重建后 13 张业务表、4 个迁移。
- 2026-10-28：P1 契约冻结（v1）；下一步同步规格/OpenAPI，不写实现。
