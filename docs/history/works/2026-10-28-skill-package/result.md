---
layer: history
module: skill
status: frozen
updated: 2026-11-02
---

# 结果：Skill 包形态（B1）

## 结论

按契约 v1 完成 Skill 原地重建：Skill 内容是一个 zip（根 `SKILL.md` + 可选 `scripts/`、`references/`），数据库只保留 brief、有序标签与当前包指针；草稿保存生成 `SKILL.md`、打包、原子切换指针并消费草稿。T-SKP-08～T-SKP-18 全部完成。

## 交付

| 任务 | 结果 |
|---|---|
| T-SKP-08 | kernel 增加 `FileData`/`FileStat`/`FileStore` 端口与 6 个新错误类型 |
| T-SKP-09 | platform 实现根目录绑定的 `FileStore`：路径校验、临时文件 + rename + fsync、`get`/`head`/`list`/`delete`/`move` |
| T-SKP-10 | config 增加 `skillStorageRoot`、`skillDraftTtlHours` 及环境变量、默认值、正整数校验 |
| T-SKP-11 | 重写 `0003_skill.sql`，删除 `0005_skill_description.sql`；4 个迁移、13 张业务表 |
| T-SKP-12 | `buildSkillMarkdown` / `buildSkillPackage` / `readSkillPackage`；seed 重建 12 个 Skill 包与 23 条装配边 |
| T-SKP-13 | 读路径：列表只读 brief；详情 `body`+`files`；文档原文；整包下载；缺失包 `package_unavailable` |
| T-SKP-14 | 草稿生命周期：新建/复制、文件清单、上传/覆盖/改名/删除、TTL、取消与限额 |
| T-SKP-15 | 保存：版本进位、baseRevision 闸门、打包 → fsync → 数据库事务切指针 → 消费草稿；启停、删除、GC |
| T-SKP-16 | catalog Skill 详情改为 `body`+`files`，新增 `getSkillPackage`；引用投影改用 brief 摘要 |
| T-SKP-17 | 网关 15 个 Skill 端点：路由、DTO、multipart、下载头、ETag/304、错误映射；同步 OpenAPI 与测试 |
| T-SKP-18 | 全量验收与本文档 |

## 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `./node_modules/.bin/tsc --noEmit` | 通过 |
| 全量测试 | `bun test` | 210 pass / 0 fail，25 个文件，2039 个断言 |
| 场景索引 | `bun run scripts/scenario-index.ts --check` | 4 个场景，索引最新 |
| OpenAPI | `bun test tests/components/http-gateway/openapi.test.ts` | 24 个 path、38 个 operation（37 业务 + `/healthz`）、8 个参数、10 个响应、54 个 schema、361 个 `$ref` 全部可解析 |
| Skill 专项 | `bun test tests/components/skill tests/components/http-gateway/skill.test.ts` | 草稿、保存、读、下载、网关契约均通过 |

## 行为要点

- 新建 Skill：草稿保存返回 201，版本 `v1.0`、revision 1；已有 Skill 保存返回 200，minor+1，`v1.9` 进位 `v2.0`。
- 已有草稿保存必须带 `If-Match`；缺失 428、旧 revision 409（`details.currentRevision`）；失败保留草稿与旧包，新包清理。
- 草稿过期读取 410 `draft_expired`，取消按 204 清理；已清理再读 404。
- 读写分离：列表不读 zip；详情/文档/下载按包读取；`SKILL.md` 在文件清单首项且只读。
- 旧 `POST /api/v1/skills`、`PUT /api/v1/skills/{id}` 已移除；创建与更新统一走草稿保存。

## 未做与遗留

- 开发库 `.local/pgdata` 曾记录旧 `0003_skill.sql` 的 checksum；2026-10-30 质量重构已把迁移历史拍扁为 `0001_baseline.sql` 并重置开发库，本条不再适用。
- 不做版本历史、权限、病毒扫描、运行时执行、草稿预览、单文件下载。
- `src/components/skill/service.ts`、`store.ts`、`types.ts` 曾作为迁移期兼容入口保留；T-DEBT-02 已删除这些占位壳，当前入口为 `src/components/skill/index.ts`。

## 收口补充（2026-11-02）

- 2026-11-02 重跑 `bun run check`：typecheck 通过，273 pass / 0 fail / 2493 expect，`docs:check` 4 个场景索引最新。
- 工序内 18 个任务全部完成，当前规格、OpenAPI 与测试均反映 zip 包 + 草稿保存契约；无未完成实现项。
- 结论：本工序收口，随目录归档。
