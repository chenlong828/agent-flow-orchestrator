---
layer: history
module: skill
status: frozen
updated: 2026-11-02
---

# Skill 包形态 · 整体设计审视

状态：审查记录。B1 已定（原地重建）；B2–B8 的修订已进 [design.md](design.md)；P1 设计已确认（v1，2026-10-28）；P1 契约已冻结（v1，2026-10-28）。

## 0. 结论

设计方向成立：zip 是内容唯一真相，数据库只存 brief 与包指针，草稿是完整包副本，保存时打包并原子切换，只整包下载。

审查时发现 4 个阻塞项：B1 迁移/重建、B2 种子与测试、B3 16 KiB、B4 保存持久性。B1 已决定原地重建；B2–B4 的修订已进 [design.md](design.md)；B5–B8 为高风险，边界也已补进设计。下面保留审查证据，不替代设计正文。

## 1. 审视依据

- [design.md](design.md)、[brief.md](brief.md)
- 现有 schema：[0003_skill.sql](../../../../db/migrations/0003_skill.sql)、[0005_skill_description.sql](../../../../db/migrations/0005_skill_description.sql)、[0004_expert.sql](../../../../db/migrations/0004_expert.sql)
- 现有种子：[seed.ts](../../../../scripts/seed.ts)
- 测试夹具：[test-db.ts](../../../../tests/helpers/test-db.ts)、[schema.test.ts](../../../../tests/db/schema.test.ts)
- 规格：[skill](../../../design/components/skill/spec.md)、[catalog](../../../design/components/catalog/spec.md)、[http-gateway](../../../design/components/http-gateway/spec.md)、[platform](../../../design/components/platform/spec.md)、[config](../../../design/components/config/spec.md)、[architecture](../../../design/architecture.md)

## 2. 阻塞项

### B1 迁移/重建方案（已定）

- 现状：`skill_section`、`skill_pitfall`、`skill_ref` 三张子表存正文；`skill` 行没有包指针；`expert_skill.skill_id` 是 `on delete restrict`（[0004_expert.sql](../../../../db/migrations/0004_expert.sql)）。
- 决定（2026-10-28）：当前 Skill 都是演示数据，无生产使用；不做升级迁移、不回填、不保留旧数据；开发库原地重建。
- 结论：不承担旧库升级，不处理 `expert_skill` restrict 的升级顺序；重写 `0003` 为新结构、删除 `0005`，迁移链变为 4 个，只服务空库。旧 `skill` 行、`expert_skill` 边、三张子表随重建消失。
- 仍需：重建步骤（drop/recreate）、seed 重建 12 个 Skill 的包与装配边、测试表清单与迁移版本同步。当前测试期望 15 张业务表、5 个迁移；重建后 13 张业务表（删 3 张、加 `skill_draft`）、4 个迁移（`0001`/`0002`/`0003`/`0004`）。
- 由于不迁移，B1 不再是阻塞项；B2–B4 仍需在设计里补齐。

### B2 种子与测试夹具

- `seed.ts` 现在为 12 个 Skill 写五章、踩坑、引用；新模型下每个 Skill 必须有一个合法 zip 和 `package_key`。种子必须：
  - 用同一套 `SKILL.md` 生成与打包逻辑，避免种子包和保存包两种格式；
  - 校验 16 KiB；超限的种子内容要拆到 `references/`；
  - 幂等：重复 seed 生成新包并更新指针，旧包由 GC 清理；seed 在数据库事务里，包文件写在事务外，失败会留孤儿，需 GC 兜底。
- 测试夹具需新增 `skill_draft` 清理；现有 `schema.test.ts` 的表清单与迁移版本要改；`tests/components/skill/*` 里五章/`sections` 的断言要整体替换为包/草稿断言。
- 重建后没有旧 `skill` 行与 `expert_skill` 边，seed 直接建 12 个 Skill 的包和专家装配；不要保留没有包的 Skill 行。

### B3 16 KiB 边界

- 设计已写 16 KiB，但契约口径还没定：
  - 计的是 `SKILL.md` 总字节（含 frontmatter）还是正文字节；建议总字节，UTF-8，`Buffer.byteLength`；
  - 生成内容是否带尾随换行、是否 trim；建议生成后按最终字节数计；
  - 超限错误是 400/422，错误字段是 `body` 还是 `skillMd`，是否带 `limitBytes`/`actualBytes`；建议 422 + 明确提示“把长内容移到 `references/`”；
  - UI 编辑器要显示字节计数与预警，服务端仍是最终裁判；这是展示端契约，需在 UI 侧同步。
- 现有 seed 内容看起来不大，但必须实际量；历史五章数据不迁移，不存在旧文档超限问题。

### B4 保存持久性

- 设计有“唯一包文件 + 数据库指针 + 提交后删旧包”，方向对；但“必要时 fsync”不够：
  - 包文件写完后必须 fsync 文件，再 fsync 目录，然后才提交数据库；否则崩溃可能留下“指针指向未落盘文件”。
  - 明确崩溃窗口：临时文件、已 rename 未提交、已提交未删旧包、已提交未删草稿；都由启动/周期 GC 对账。
  - GC 只能删“非当前指针”的包，并留 grace period，避免删掉正在构建或下载的文件。
  - 数据库提交失败要删新包；删除失败留孤儿，GC 兜底。
- 这些是设计约束，不是实现细节；应在契约冻结前写进 [design.md](design.md)。

## 3. 高风险项

### B5 草稿无鉴权与 TTL

- 草稿 ID 实际是 bearer capability；无鉴权时，拿到 ID 就能读写草稿。单机本地原型可接受，但要在规格标注；一旦对外，必须加鉴权。
- TTL 从创建算 24 小时（已确认）；长编辑会过期，页面要能处理“草稿已过期”并重新进入编辑；已上传附件会丢。
- 草稿恢复依赖页面保存 draft ID；如果 ID 丢失，草稿只能等 TTL 清理。是否需要“列出我的草稿”不在需求内，不建议加。
- 上传同路径是覆盖还是冲突、rename 目标已存在怎么办、大小写与 Unicode 归一化，都要在契约冻结时定。

### B6 读路径性能

- 详情与文档不应解压整个 100 MiB 包；只读 zip 中央目录与 `SKILL.md` 条目。文件清单也只读中央目录。设计要写清“只读所需条目”，否则实现容易全量解压。
- 首版不缓存可以，但要定一个可观测阈值；超过再按 revision 缓存解析结果。
- 列表不碰 zip，保持。

### B7 搜索范围与投影漂移

- 搜索只覆盖 brief 的 `name`/`description`，不搜正文、不搜 `references/`。这是范围边界，要写进规格，避免以后被当成缺陷。
- brief 与 zip 的 name/description/version 是投影关系；只有保存写两者。若出现漂移，列表与详情会不一致；首版不做自动修复，但要把它作为不变量和排障项记录。
- `category`/`tags`/`enabled` 只在数据库，不进 zip；详情以 zip 为准，管理字段以数据库为准。

### B8 内容安全

- `SKILL.md` 是 Markdown，可能含原始 HTML/JS；B1 只返回 `text/markdown`，展示端必须 sanitize。UI 侧要同步这条。
- 下载文件名来自 Skill `name`，可能含引号、换行、路径分隔符；`Content-Disposition` 必须清洗并正确编码。
- 附件是不可信内容；B1 不扫描、不执行，运行时必须自行隔离。
- 服务端构建 zip，不接受任意 zip 上传；仍校验条目名、大小、数量、符号链接。

## 4. 中低风险与收口

### B9 组件与协议

- `CMP-skill` 拥有包、草稿与状态；`CMP-platform` 存储适配；`CMP-kernel` 存储端口；`CMP-config` 存储根；`CMP-catalog` 读组合；`CMP-http-gateway` multipart 与下载头。无新增业务组件。
- 现有 gateway 没有二进制响应与 413/415 映射；platform/kernel 没有存储端口；config 没有存储根。这些都是 P1 变更，规格与预算要同步。
- 架构中的端点/表数量会变，`openapi.yaml` 与 6 份规格要同步。

### B10 契约冻结清单

冻结前至少要定：

- 操作：列表、详情、文档、文件清单、整包下载、草稿创建/读取/上传/改名/删除/取消、保存（新建/更新）。
- 字段：brief、详情 body/files、草稿状态、包下载头、ETag。
- 错误：校验、404、revision 冲突、草稿过期、16 KiB、413/415、包缺失/损坏。
- 并发：`If-Match`/revision；草稿 base revision；重复保存。
- 限额：16 KiB、20 MiB/文件、100 文件、100 MiB/包；路径规则。
- 重建：drop/recreate 步骤、seed 重建、测试表清单与迁移版本。

### B11 文档与流程

- 本 works 目录已建；`docs/README.md` 的工序清单、`plan/roadmap.md` 的近期完成、`result.md` 在收口时补。
- UI 侧 2026-10-27 提案的 `body` + staging 已被本设计取代；需要另起 UI 工序同步，不在本仓库改。
- 本次只新增 works 文件；未改代码与规格。

## 5. 重建结论

- 已定（2026-10-28）：无生产使用，当前 Skill 都是演示数据；原地重建，不做升级迁移、不回填、不保留旧数据。
- 技术边界：schema 仍要以 fresh-only 基线落成（只服务空库），migrator 的 checksum 不再背旧库；旧 `skill` 行、`expert_skill` 边、三张子表随重建消失。
- 不做：备份/回滚、升级迁移、旧数据对比；开发库可再次 drop/recreate。
- 仍需：seed 重建 12 个 Skill 的包与装配边；测试表清单、迁移版本、清理表同步。

## 6. 修订顺序

1. 迁移已定：无升级、原地重建。
2. [design.md](design.md) 已补重建、种子、16 KiB、持久性、草稿边界与安全项；P1 已确认（v1）。
3. P1 已确认（v1）；契约已冻结（v1）。

## 7. 不塞进本轮

- 版本历史、权限、病毒扫描、运行时执行、单文件访问、附件内联显示、草稿包预览（已确认不做）。
- 全文检索（正文或附件）不在本轮；列表只搜 brief。
- UI 页面与编辑器实现不在本仓库。
