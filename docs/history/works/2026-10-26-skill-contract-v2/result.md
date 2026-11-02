---
layer: history
module: global
status: frozen
updated: 2026-11-02
---

# 结果：Skill 契约 v2（description 合并 + 编排文档）

## 结论

Skill 的两类消费面已按契约拆开，后端不再混用同一组字段：

- **管理面**：`description` 取代 `summary` 与 `triggers`，1–400 字，语义为“适用 / 触发 / 不适用”；列表、详情、创建/更新、专家装配摘要全部换字段；`q` 同时匹配 `name` 与 `description`。
- **编排面**：新增 `GET /api/v1/skills/{id}/document`，一次性输出可整篇载入的 markdown（frontmatter + 五章 + 可选踩坑/参考资料），带 `ETag` 与 304 协商，停用技能照常可读。
- **数据**：迁移 `0005` 用 `summary + " 触发：" + 触发词` 回填 `description`，随后删除 `summary` 列与 `skill_trigger` 表；业务表 16 → 15 张。
- **契约红线**：请求体出现旧字段 `summary` / `triggers` 按未知字段返回 400，不静默兼容。

## 交付物

| 落点 | 内容 |
|---|---|
| [`db/migrations/0005_skill_description.sql`](../../../../db/migrations/0005_skill_description.sql) | 加列、回填、非空 + 1–400 约束、删列与删表 |
| [`src/components/skill/types.ts`](../../../../src/components/skill/types.ts) | `description` 取代 `summary`/`triggers`；新增 `SkillDocument`、`SkillRead.getDocument` |
| [`src/components/skill/store.ts`](../../../../src/components/skill/store.ts) | 读写改用 `description`，删除触发词子表读写；`q` 覆盖名称与描述 |
| [`src/components/skill/service.ts`](../../../../src/components/skill/service.ts) | `description` 校验、`getDocument` 与文档合成（frontmatter、五章、可选节） |
| [`src/components/catalog/index.ts`](../../../../src/components/catalog/index.ts) | 视图字段换 `description`；新增 `getSkillDocument` 透传 |
| [`src/components/http-gateway/app.ts`](../../../../src/components/http-gateway/app.ts) | 写字段换 `description`；新增文档路由（markdown、ETag、304） |
| [`src/components/http-gateway/openapi.yaml`](../../../../src/components/http-gateway/openapi.yaml) | `API-31`、DTO 字段、`text/markdown` 响应与 `If-None-Match` |
| [`scripts/seed.ts`](../../../../scripts/seed.ts) | 12 条演示 Skill 合并为 `description`，去掉触发词写入 |
| [`docs/design/components/skill/spec.md`](../../../design/components/skill/spec.md) | 数据面拆分、`getDocument` 契约、编排文档结构 |
| [`docs/design/components/catalog/spec.md`](../../../design/components/catalog/spec.md) | 视图字段与 `getSkillDocument` 数据来源 |
| [`docs/design/components/http-gateway/spec.md`](../../../design/components/http-gateway/spec.md) | 31 个业务端点、Skill DTO、markdown 例外与文档端点 |
| [`tests/components/skill/service.test.ts`](../../../../tests/components/skill/service.test.ts) | 描述写入规则、文档合成 5 例、名称/描述检索 |
| [`tests/components/http-gateway/skill.test.ts`](../../../../tests/components/http-gateway/skill.test.ts) | 旧字段 400、描述上限、文档 200/304/404、停用可读 |

## 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `./.local/bun/bun run typecheck` | 通过 |
| 全量测试 | `./.local/bun/bun test --max-concurrency=1` | 206 pass / 0 fail |
| 迁移（开发库） | `./.local/bun/bun run scripts/db-migrate.ts` | `applied=1 skipped=4`，新增 `0005` |
| 种子 | `./.local/bun/bun run scripts/seed.ts` | Harness 5、工具 10、Skill 12、专家 8 |
| 场景索引 | `./.local/bun/bun run scripts/scenario-index.ts --check` | 已是最新 |

测试覆盖的契约点：完整文档合成与五章顺序、空五章保留标题、空踩坑/空引用整节省略、frontmatter 转义、`revision` 与 `ETag` 同步、`If-None-Match` 304、缺失资源 404、停用技能照常输出、`q` 命中 `description`、旧字段 `summary`/`triggers` 返回 400。

## 与提案的偏差

- 提案只写端点与字段；实现时把“空踩坑/空引用整节省略、空章节标题保留、末尾单换行”落成测试断言，作为文档结构的冻结口径。
- `catalog` 的专家装配摘要 `ExpertSkillSummaryView.summary` 一并改为 `description`，否则旧的 200 字摘要没有数据来源；这是提案影响清单内字段的连带改动。
- 计数类断言随契约同步更新：业务表 16→15、迁移 4→5、业务端点 30→31、OpenAPI paths 18→19、`$ref` 302→308。

## 遗留

- 展示端（独立仓库）的界面重构不在本工序；契约差异与数据来源已整理成交接件 [`ui-handoff.md`](ui-handoff.md)，页面结构与排布由该项目自行决定。
- `version` 与 `revision` 未合并；版本历史、批量导出、`/api/v2` 路径化仍待定，见 [`contract-proposal.md`](contract-proposal.md) §9。

## 收口补充（2026-11-02）

- 本工序的 `description` 与 `GET /skills/{id}/document` 保留；后续 [`2026-10-28-skill-package`](../2026-10-28-skill-package/result.md) 将 Skill 写路径改为 zip 包 + 草稿保存，移除了 `POST /skills`、`PUT /skills/{id}`，并删除本工序新增的迁移文件（迁移历史已在 2026-10-30 拍扁为 `0001_baseline.sql`）。
- 展示端是否已接入由独立项目决定，不在本仓库验收范围；本仓库侧契约与数据交付已完成。
- 结论：本工序收口，随目录归档。
