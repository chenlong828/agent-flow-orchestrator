---
layer: design
module: agent-capability-assets
status: verified
updated: 2026-11-04
flow: FLOW-SKL-PUBLISH-001
scenario: SCN-0002
domain: 智能体能力资产
valueStream: Skill 能力定义与供给
title: Skill 草稿与发布
entries:
  - component: CMP-http-gateway
    path: src/components/http-gateway/app.ts
    symbol: createHttpApp
  - component: CMP-skill
    path: src/components/skill/draft-service.ts
    symbol: createSkillDraftService
  - component: CMP-catalog
    path: src/components/catalog/index.ts
    symbol: createCatalog
docs:
  - path: docs/design/components/skill/spec.md
    heading: 3.2 方法契约
  - path: docs/design/components/http-gateway/spec.md
    heading: 5.3 Skill
  - path: docs/design/components/skill/spec.md
    heading: 5 验证
tests:
  - role: R1
    id: TC-SKL-001
  - role: R2
    id: TC-SKL-002
  - role: R3
    id: TC-SKL-003
  - role: N1
    id: TC-SKL-004
externalRefs:
  - path: src/components/http-gateway/openapi.yaml
    anchor: createSkillDraft
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: getSkillDraft
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: uploadSkillDraftFile
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: renameSkillDraftFile
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: deleteSkillDraftFile
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: cancelSkillDraft
    kind: openapi-operation
  - path: src/components/http-gateway/openapi.yaml
    anchor: saveSkillDraft
    kind: openapi-operation
---

# Skill 草稿与发布

## 1 场景与价值

作者在管理端新建或取出一份 Skill 草稿，补齐正文、标签与 `scripts/`、`references/` 附件，然后保存发布。结果：Skill 的当前包被创建或替换，版本推进，草稿被消费；读端拿到的就是这个新包。

Skill 的唯一写入口是草稿保存，`POST /skills` 与 `PUT /skills/{id}` 已移除。草稿保存把内容当作包来发布：服务端生成 `SKILL.md`，附件随包保存，数据库只保留 brief 与当前包指针。

本场景只覆盖写路径。检索、详情、`SKILL.md` 原文与整包下载属于读路径，见 `SCN-0003`；启停、删除与引用保护是低密度管理操作，不单独建场景。

## 2 入口

入口与文档锚点以本文件 frontmatter 的 `entries`、`docs`、`externalRefs` 为准，索引由这些字段生成，不在正文重复路径。

- HTTP 入口：`CMP-http-gateway` 的 `createHttpApp`，承载 `/api/v1/skill-drafts` 与保存后的回读。
- 领域入口：`CMP-skill` 的 `createSkillDraftService`，负责草稿生命周期与发布。
- 读模型入口：`CMP-catalog` 的 `createCatalog`，保存成功后回读详情与列表投影。

## 3 运行序

流程定义：`FLOW-SKL-PUBLISH-001`。

1. 建草稿：`POST /api/v1/skill-drafts`。空 body 新建空草稿；带 `skillId` 时复制该 Skill 的当前包，文件清单包含只读 `SKILL.md` 与现有附件，并返回 `baseRevision` / `baseVersion`。允许对停用 Skill 建草稿，也允许多个草稿并存。
2. 编辑附件：以 multipart 上传或覆盖一个文件（`path` + `file`），路径只允许在 `scripts/` 或 `references/` 下；`PATCH` 改名或跨这两个目录移动；`DELETE` 删除附件。`SKILL.md` 不能上传、改名或删除。同路径覆盖不推进版本，单文件、附件数与总量受限额约束。
3. 保存发布：`POST /skill-drafts/{id}/save`，提交 `name`、`categoryCode`、`description`、`tags`、`body`。服务端生成三键 frontmatter 的 `SKILL.md`，正文换行统一并保证单个结尾换行；新建得到 `v1.0` / `revision=1` / `enabled=true`，已有 Skill 递增 minor（`v1.9` → `v2.0`）。已有 Skill 的保存必须带 `If-Match: "<baseRevision>"`。
4. 落盘与切换：写新包 → fsync → 单事务更新 brief、`package_key`、`revision`、`version` 并删除草稿记录 → 提交 → 删除草稿目录；旧包删除失败交 GC。成功后草稿 404，客户端应刷新 Skill，不能重试同一草稿。
5. 回读：用 `GET /skills/{id}` 与列表确认 brief、正文和文件清单；新包内容以 `SKILL.md` 与附件为准。

失败路径：

- 元数据非法（`name` 1–80、`description` 1–400、`categoryCode` 存在、`body` 为字符串）：`400`，草稿保留。
- 附件路径非法、`SKILL.md` 作为附件、改名目标已存在、新旧路径相同：`400` 或 `409`，草稿保留。
- 名称冲突：`409 name_conflict`，草稿保留，旧 Skill 不变。
- `SKILL.md` 超过 16384 字节：`422 skill_md_too_large`；附件或总量超限：`413`；非 multipart：`415`。
- 已有 Skill 保存缺 `If-Match`：`428`；旧 revision：`409 revision_conflict`，`details.currentRevision` 给出当前值；新建草稿带 `If-Match`：`400`。
- 任何保存失败都保留草稿、旧包与旧 brief；新包在事务失败后清理，不产生半切换。
- 草稿 TTL 从创建起 24 小时，不滑动；过期但未清理返回 `410 draft_expired`，已清理返回 `404`。取消草稿成功 `204`，不影响已保存 Skill。

## 4 不可变引用

外部客户端把后端 REST API 视为不可变契约。本场景通过 `externalRefs` 指向实际 OpenAPI 文档的 operation：

- `createSkillDraft`、`getSkillDraft`、`uploadSkillDraftFile`、`renameSkillDraftFile`、`deleteSkillDraftFile`、`cancelSkillDraft`、`saveSkillDraft`

引用只记录 operationId，不复制请求/响应字段；OpenAPI 的破坏性变更必须走契约决策，不能静默改。

## 5 测试映射

测试 ID 在测试标题中稳定存在，索引生成器会校验：

| 角色 | 测试 ID | 断言 |
|---|---|---|
| R1 | `TC-SKL-001` | 新建草稿为空且 24 小时有效；附件上传后保存返回 201、`v1.0`、`revision=1`；草稿被消费；详情与列表回读到正文、文件顺序和投影 |
| R2 | `TC-SKL-002` | 已有 Skill 建草稿复制整包（`SKILL.md` 只读）；改名附件后保存返回 200、`v1.1`、`revision=2`；文档与下载 zip 反映新包 |
| R3 | `TC-SKL-003` | 名称冲突返回 409 后草稿与旧 Skill 均不变；改名后重试返回 201，包内保留附件 |
| N1 | `TC-SKL-004` | 更新保存缺 `If-Match` 返回 428、旧 revision 返回 409、新建带 `If-Match` 返回 400；失败后草稿保留、旧版本不变，按正确 revision 重试成功 |

R3 的失败断言不是“另一个功能”，而是发布的原子性：失败不产生半切换，草稿可继续修复后重试。

## 6 覆盖边界

- 不覆盖检索、详情、`SKILL.md` 原文与整包下载；这些是读路径，见 `SCN-0003`。
- 不覆盖启停、删除与引用保护：属于低密度管理操作，未建独立场景；端点契约在 `http-gateway` 规格，组件与 HTTP 测试覆盖。
- 不覆盖草稿 TTL 与 GC 的时钟路径：场景测试使用真实时钟，不注入过期；组件测试覆盖过期读取、取消与 GC。
- 附件删除与取消草稿不在 3+1 内：由既有 HTTP 契约测试覆盖；本场景聚焦发布主链与失败原子性。
- 不覆盖版本历史（当前不存在）、权限与草稿所有权（草稿 ID 即 bearer capability）、病毒扫描、草稿包预览与单文件下载。
- 不覆盖多草稿并存下的并发保存竞争；`If-Match` 冲突路径已由 N1 覆盖，复杂并发重试不在本场景。
