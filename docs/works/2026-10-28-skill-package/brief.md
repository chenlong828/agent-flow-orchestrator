---
layer: works
module: skill
status: active
updated: 2026-10-29
---

# 工序：Skill 包形态（B1）

## 需求与背景

- 需求来源：`agent-flow-ui` 仓库的 Skill 包提案（[contract-proposal.md](../../../../agent-flow-ui/docs/works/2026-10-27-skill-package/contract-proposal.md)），经 2026-10-28 交互确认，收敛为“一个 zip + 数据库 brief”。
- 现状：B1 的 Skill 是五章结构化子表 + 踩坑 + 引用；文档由 `composeDocument` 拼装；没有附件、包、草稿。见 [skill 规格](../../design/components/skill/spec.md) 与 [service.ts](../../../src/components/skill/service.ts)。
- 本轮决定：
  - 最终形态是一个 zip：根 `SKILL.md`，下面 `scripts/`、`references/`，两个目录可为空，无其他根文件或目录。
  - zip 是内容唯一真相；数据库只存 brief（名称、描述、版本、分类、标签、启停、revision、更新时间）与当前包指针。
  - 编辑期服务端保留完整包副本作为草稿；保存时生成 `SKILL.md`、打包、原子替换；打包失败即保存失败。
  - `SKILL.md` 是入口，上限 16 KiB（含 frontmatter）；长内容放 `references/`。
  - 只提供整包下载；不提供单文件下载、不内联显示附件；草稿不提供下载预览。
- B1 按旁路处理，不新建 `REQ` / `SCN`（依据 [roadmap.md](../../plan/roadmap.md)「B1 是基础设施工序，按旁路处理」）；本 brief 为锚点。

## 范围

本轮做：

- 设计 B1 侧包形态：数据所有权、状态模型、读写路径、契约面、失败与并发语义、存储与 GC、迁移与验证。
- 明确 UI 提案的 `body` + staging 部分被本设计取代。
- 产出 P1 设计提案与 REST 契约，按人工确认门冻结。
- 契约冻结后同步规格/OpenAPI；T-SKP-08 起按任务实现代码、迁移与种子。

本轮不做：

- 设计与契约阶段不提前写实现；实现从 T-SKP-08 开始按任务推进。
- 不做 UI 页面与编辑器；不规定展示端实现。
- 不做版本历史、权限、病毒扫描、运行时执行、单文件访问、附件内联显示、草稿包预览。

## 验收标准

1. 设计提案写清 zip 与 brief 的真相边界、草稿状态机、读路径、写路径、保存原子性与失败语义、并发与重试、存储与 GC、原地重建与兼容、16 KiB 正文边界与长内容分流。
2. 写清 `CMP-skill`、`CMP-catalog`、`CMP-http-gateway`、`CMP-platform`、`CMP-config`、`CMP-kernel` 的职责与数据所有权。
3. 给出 P1 定级、人工确认门与待确认的设计选择；不写实现细节。
4. 契约冻结前不改既有规格/代码；冻结后同步规格/OpenAPI，实现从 T-SKP-08 起按任务推进。

## 任务表

| ID | 类型 | 组件 | 状态 | 目标 / 交付 | 完成判据 | 依赖 | 装载清单 |
|---|---|---|---|---|---|---|---|
| T-SKP-01 | design | `CMP-skill` | 已完成 | 形成 Skill 包形态设计与 UI 提案映射 | P1 设计确认（v1） | 无 | 本 brief、[design.md](design.md)、UI 提案、skill / catalog / gateway 规格、architecture、现有迁移与实现 |
| T-SKP-02 | design | `CMP-platform` + `CMP-config` | 已完成 | 存储与 GC、配置设计 | P1 设计确认（v1） | T-SKP-01 | [design.md](design.md)、platform / config 规格、存储与 GC 设计 |
| T-SKP-03 | review | global | 已完成 | P1 设计评审与确认 | 确认记录落 brief | T-SKP-02 | [design.md](design.md)、本 brief、P1 确认门 |
| T-SKP-04 | review | global | 已完成 | 设计审查与阻塞项修订 | B1–B8 审查结论落 [design-review.md](design-review.md) | T-SKP-03 | [design-review.md](design-review.md)、design.md、本 brief、现有 schema / seed / 测试 |
| T-SKP-05 | contract | `CMP-skill` + `CMP-http-gateway` + `CMP-catalog` | 已完成 | 字段、端点、错误、ETag、限额与迁移口径冻结 | 契约 v1 冻结 | T-SKP-04 | [contract-proposal.md](contract-proposal.md)、design v1、现有 OpenAPI / 规格、重建口径 |
| T-SKP-06 | spec | `CMP-skill` + `CMP-catalog` + `CMP-http-gateway` + `CMP-platform` + `CMP-config` | 已完成 | 规格、architecture、OpenAPI 同步契约 v1 | 37 个业务 operation、14 个公共错误码、端点表一致 | T-SKP-05 | 契约 v1、组件规格、`architecture.md`、`openapi.yaml` |
| T-SKP-07 | design | global | 已完成 | 把实现拆成可执行任务 | T-SKP-08～T-SKP-18 的依赖与验收可执行 | T-SKP-06 | 本 brief、[design.md](design.md) 第 13 节、契约 v1、各组件规格、现有源码 / 测试 |
| T-SKP-08 | change | `CMP-kernel` | 已完成 | 增加 `FileData`/`FileStat`/`FileStore` 端口与 6 个新错误类型 | `bun test tests/components/kernel` 绿；无运行时 / Bun 导入；类型导出可用 | 无 | kernel 规格、契约 §错误/FileStore、`src/core/kernel/*`、`tests/components/kernel/*`、`tests/core/kernel-platform.test.ts` |
| T-SKP-09 | change | `CMP-platform` | 已完成 | 实现 `FileStoreFactory` 与 `FileStore`：相对键、路径穿越拒绝、临时文件 + rename + fsync、`get`/`head`/`list`/`delete`/`move` | `bun test tests/components/platform` 绿；不解释包结构、不读 Config | T-SKP-08 | platform / kernel 规格、`src/core/platform/*`、`tests/components/platform/*`、`tests/core/kernel-platform.test.ts` |
| T-SKP-10 | change | `CMP-config` | 已完成 | 增加 `skillStorageRoot`、`skillDraftTtlHours` 及环境变量、默认值、校验 | `bun test tests/core/config.test.ts` 绿；空根回退 `.local/skills`，TTL 为正整数 | 无 | config 规格、`src/core/config/*`、`tests/core/config.test.ts` |
| T-SKP-11 | change | `CMP-skill` | 已完成 | 重写 `0003_skill.sql`（`skill` 含 `package_key`、`skill_tag`、`skill_draft`），删除 `0005_skill_description.sql`；同步迁移计数断言 | `bun test tests/db/schema.test.ts tests/components/platform/db.test.ts` 绿；空库 4 个迁移、13 张业务表；旧子表不建 | T-SKP-08、T-SKP-09 | skill 规格、契约 §5/§9、`db/migrations/0003*`、`0004*`、`0005*`、`tests/db/schema.test.ts`、`tests/components/platform/db.test.ts`、`tests/helpers/test-db.ts` |
| T-SKP-12 | change | `CMP-skill` | 已完成 | 抽出 `SKILL.md` 生成与 zip 打包；seed 重建 12 个 Skill 的合法包与 23 条装配边 | `bun run db:seed` 可重复；包可解压、`SKILL.md` 合法；种子测试绿 | T-SKP-09、T-SKP-10、T-SKP-11 | skill 规格 §8、契约 §6.2/§9、`scripts/seed.ts`、`tests/scripts/seed.test.ts`、platform FileStore |
| T-SKP-13 | change | `CMP-skill` | 已完成 | 实现读路径：`list`/`get`/`getSummary`/`getDocument`/`getPackage`/`listCategories`，详情 `body`+`files`，下载流 | skill 读测试绿；列表不读 zip；文档逐字一致；包缺失 500 `package_unavailable` | T-SKP-12 | skill 规格 §3.1/§5、契约 §6、`src/components/skill/*`、skill 测试 |
| T-SKP-14 | change | `CMP-skill` | 已完成 | 实现草稿生命周期：建草稿、文件清单、上传/覆盖/改名/删除、取消；TTL、路径、文件数/大小限额、`SKILL.md` 保留 | skill 草稿测试绿；已有 Skill 复制包，新建为空；过期 410、已清理 404 | T-SKP-13 | skill 规格 §3.2 草稿、契约 §6.3–6.4、skill 测试 |
| T-SKP-15 | change | `CMP-skill` | 已完成 | 实现 `saveDraft`、版本进位、`If-Match`/baseRevision 闸门、打包 → fsync → 原子切包指针 → 消费草稿；`setEnabled`/`delete` 与旧包/孤儿包 GC | skill 保存 / GC 测试绿；失败保留草稿与旧包；并发保存符合契约 | T-SKP-14 | skill 规格 §3.2 保存/GC、契约 §7–§8、platform FileStore、skill 测试 |
| T-SKP-16 | change | `CMP-catalog` | 已完成 | 增加 `getSkillPackage`，`SkillDetailView` 改为 `body`+`files`，透传文档/整包 | catalog 测试绿；不解析 zip、不写表 | T-SKP-15 | catalog / skill 规格、`src/components/catalog/index.ts`、catalog 测试 |
| T-SKP-17 | change | `CMP-http-gateway` | 已完成 | 实现 15 个 Skill 端点：路由、DTO、multipart、下载头、错误映射；同步运行时 OpenAPI 与旧测试计数 | `bun test tests/components/http-gateway` 绿；24 个 path、38 个 operation（37 业务 + `/healthz`）、8 个参数、10 个响应、54 个 schema；`openapi.test.ts` 同步更新 | T-SKP-16 | gateway 规格、`openapi.yaml`、catalog / skill 契约、`tests/components/http-gateway/*`、`tests/architecture.test.ts` |
| T-SKP-18 | verify | global | 已完成 | 全量验收：重建库 + seed、全量测试、OpenAPI / 规格逐项核对、契约 3 正 1 反抽查 | `bun test` 全绿；无旧 Skill 结构残留；本 brief 与 `result.md` 收尾 | T-SKP-17 | 全量测试、重建 / seed、OpenAPI 与规格逐项核对 |

拆分规则：`change` 一次只改一个组件；`CMP-skill` 的五个任务按 T-SKP-11 → 12 → 13 → 14 → 15 串行（组件级 WIP=1）；每个任务自带该组件测试，不把红测试留给后续任务；最后 T-SKP-18 做跨组件验收。每个任务单独 commit，测试命令与未决问题回写本 brief；实现若暴露契约缺口，先补规格再改代码，不静默改契约。

不在拆分内：UI 适配、版本历史、权限、病毒扫描、运行时执行、草稿预览、单文件下载；这些仍按设计文档的非目标处理。

## 领取的开放问题

迁移已定：无生产使用，当前 Skill 都是演示数据；不做升级迁移、不回填、不保留旧数据，开发库原地重建（见 [design.md](design.md) 第 9 节）。其余设计选择 D1–D4 已确认，D5–D8 按建议默认。

契约已冻结（v1）：文件总数含 `SKILL.md`、保存走草稿、下载用 `/download`、`enabled` 不进保存、6 个新错误码、重写 `0003`/删除 `0005`；见 [contract-proposal.md](contract-proposal.md) 第 14 节。T-SKP-06 已把契约同步到组件规格、`architecture.md` 与 `openapi.yaml`；T-SKP-07 已拆出 T-SKP-08～T-SKP-18，按依赖顺序执行，`CMP-skill` 内串行。

## 确认记录

- 2026-10-28：需求口径确认——zip 是内容唯一真相；数据库只存 brief；草稿是完整包副本；保存时生成包，打包失败即保存失败；只整包下载；`SKILL.md` 在文件清单中作为只读条目；草稿不提供下载预览。
- 2026-10-28：设计选择确认——D1 文件系统 + 数据库指针；D2 删除旧包 + GC；D3 `SKILL.md` 16 KiB（含 frontmatter），长内容放 `references/`；D4 草稿 TTL 从创建算 24 小时；D5–D8 按建议默认。
- 2026-10-28：迁移决定——当前 Skill 都是演示数据，无生产使用；不做升级迁移、不回填、不保留旧数据；开发库原地重建，seed 重建 12 个 Skill 的包与装配边。
- 2026-10-28：P1 设计确认（v1），冻结供全文审视；契约未冻结。
- 2026-10-28：P1 契约冻结（v1）——文件数含 `SKILL.md`（附件 99）；保存 `POST /skill-drafts/{id}/save`；下载 `GET /skills/{id}/download`；`enabled` 不进保存；发布态全部 `readOnly: true`；保存成功删草稿、重试 404；6 个新错误码；重写 `0003`、删除 `0005`，重建后 13 张表、4 个迁移。
- 2026-10-28：T-SKP-06 完成——组件规格、`architecture.md` 与 `openapi.yaml` 已按契约 v1 同步；OpenAPI 37 个业务 operation（+`/healthz`），Skill 15 个端点，公共错误码 14 个；实现待 T-SKP-08 起。
- 2026-10-28：T-SKP-06 验证——OpenAPI YAML 可解析、`$ref` 全部可解析；现有 `tests/components/http-gateway/openapi.test.ts` 仍断言旧 31 端点/51 schema 口径，由 T-SKP-17 随网关实现更新。
- 2026-10-29：T-SKP-07 完成——实现拆分为 T-SKP-08～T-SKP-18；`change` 任务一次只改一个组件，`CMP-skill` 五段串行（schema → 包/种子 → 读 → 草稿 → 保存/GC），catalog、gateway 随后，最后全局验收。
- 2026-10-29：T-SKP-08 完成——kernel 增加 `FileData`/`FileStat`/`FileStore` 与 6 个错误类型；`tests/components/kernel`、`tests/core/kernel-platform.test.ts`、`tests/architecture.test.ts` 共 15 pass，`tsc --noEmit` pass。为保持 `ErrorCode` 扩宽后的类型闭合，gateway `statusFor` 补了 6 个状态分支；未实现 Skill 路由。
- 2026-10-29：T-SKP-10 完成——`Config` 增加 `skillStorageRoot`（默认 `.local/skills`）与 `skillDraftTtlHours`（默认 24），仅环境变量覆盖；TTL 正整数校验；config 测试 10 pass、`tsc --noEmit` pass。
- 2026-10-29：T-SKP-09 完成——platform 增加 `StorageError`、`FileStoreFactory`/`createFileStore` 与根绑定 `FileStore`；原子写、fsync、路径拒绝、流读写、递归列目录、幂等删除与移动；platform 测试 17 pass、`tsc --noEmit` pass。
- 2026-10-29：T-SKP-11 完成——`0003` 重建为 `skill`（`description`/`package_key`）、`skill_tag`、`skill_draft`，删除 `0005`；空库 4 迁移、13 张业务表；schema 与 platform 迁移测试 12 pass、`tsc --noEmit` pass。T-SKP-11～15 是同一个 breaking cut：中间只跑任务级测试，T-SKP-15 后再收口全量。
- 2026-10-29：T-SKP-12 完成——新增 `src/components/skill/package.ts`（frontmatter、路径/限额校验、deflate zip 构建与读取）；seed 写入 12 个合法包并更新 `package_key`，移除旧子表写入；package 4 pass、seed 3 pass、`tsc --noEmit` pass。
- 2026-10-29：T-SKP-13 完成——新增 `contract.ts`/`read.ts`；列表只读 brief，详情/文档/下载从当前包读取，`SKILL.md` 首项、缺失包 `package_unavailable`；读测试 4 pass、`tsc --noEmit` pass。
- 2026-10-29：T-SKP-14 完成——新增 `draft.ts`；建草稿复制当前包/新建空目录，附件上传覆盖、改名、删除，TTL 过期 410、取消幂等清理；草稿测试 5 pass、`tsc --noEmit` pass。
- 2026-10-29：T-SKP-15 完成——`saveDraft` 生成包、版本进位、baseRevision 闸门、DB 事务切指针并消费草稿，失败清理新包；启停/删除/GC 完成；skill 草稿与保存测试 10 pass、`tsc --noEmit` pass。
- 2026-10-29：T-SKP-16 完成——catalog Skill 详情改为 `body`+`files`，新增 `getSkillPackage` 透传；引用投影改用 `getSummary`，不因包缺失阻塞引用检查；catalog 测试绿。
- 2026-10-29：T-SKP-17 完成——网关移除旧 `POST/PUT /skills`，实现 15 个 Skill 端点（含草稿 multipart、整包下载、ETag/304、If-Match、错误映射）；OpenAPI 测试同步为 24 path / 38 operation（37 业务 + `/healthz`）/ 54 schema；gateway 测试绿。
- 2026-10-29：T-SKP-18 完成——全量 `bun test` 210 pass、`tsc --noEmit` 通过、`docs:check` 通过；旧五章服务入口改为新模块兼容导出，网关移除旧 Skill 写路由；开发库迁移 checksum 与重写后的 0003 不一致，按“原地重建、无生产数据”口径不在本工序内自动清库，验收使用新库/测试库，记录见 `result.md`。
