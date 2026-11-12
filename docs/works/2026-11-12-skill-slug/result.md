---
layer: works
module: global
status: active
updated: 2026-11-12
procedure: 2026-11-12-skill-slug
---

# 结果：技能系统标识 `slug`

## 1 结论

`skill` 增加系统标识 `slug`，`name` 继续做展示名。`SKILL.md` 的 frontmatter `name` 改用 `slug`，下载文件名也用它；展示名不再进包。带技能包的 run 已能通过客户端安装并执行（实测 n1 `succeeded`，run 推进到 n2）。

## 2 验收结果

| 项 | 命令/方式 | 结果 |
|---|---|---|
| 全量测试 | `bun test --max-concurrency=1` | **390 pass / 0 fail** |
| 新增用例 | `tests/components/skill/service.test.ts`「Skill 系统标识（slug）」5 例 | 通过：显式/派生/非法/重复/改名 |
| 迁移 | 启动时自动应用 | `已应用迁移：0006_skill_slug.sql`；两条技能回填 `skill-<尾8>` |
| 存量重打包 | 建草稿 → 带 `slug` 保存 | 工作流初始化 → `workflow-init`、基础测试Skill → `basic-test`，版本 `v1.0 → v1.1` |
| 包内 frontmatter | 下载 zip 后 `unzip -p SKILL.md` | `name: "workflow-init"`、`version: "v1.1"` |
| 真实运行 | `POST /workflows/{id}/runs` → 查节点 | n1 `start` **succeeded**（此前 1s 内 `failed(asset)`） |
| 会话日志 | `GET /runs/{id}/nodes/n1/session-log` | 含 `workflow-init` 12 处，说明 DSH 侧读到了该技能 |
| 门禁 | `typecheck`、`docs:check`、`quality:report` | 通过；违规 0 |

## 3 结论落点

| 产物 | 落点 |
|---|---|
| 迁移 | `db/migrations/0006_skill_slug.sql` |
| 契约（字段、派生、改名、冲突） | [`skill/spec.md`](../../design/components/skill/spec.md) §2、§3、§4 |
| 目录投影 | [`catalog/spec.md`](../../design/components/catalog/spec.md) `SkillListItem.slug` |
| REST 契约 | `openapi.yaml` `SkillListItem`/`SkillDraftSave` 加 `slug` |
| 种子 | `scripts/seed.ts`：12 个技能补 `slug`，包内 frontmatter 用 slug |
| 代码 | `skill/{contract,draft-types,draft-save,read}.ts`、`catalog/{types,skill}.ts`、`gateway/{fields,openapi}` |
| 开放问题 | `OQ-31` 关闭；`OQ-32`（实例被 block 后静默排队）、`OQ-33`（多包覆盖）新增 |

## 4 裁决摘要

blocker 0 / decision now 5（已落规格与测试）/ hold 3（`H-01`→`OQ-33`、`H-02`→`OQ-32`、`H-03`→交 UI 仓库）。详见 [`review.md`](review.md)。

## 5 偏差与未覆盖

- 提案里「包文件名 `<name>-<version>.zip` 改为 `<slug>-…`」的事实判断有误（存储键是 `<uuid>.zip`），但**下载文件名**确实用了展示名，本轮已改成 slug。
- `slug` 允许改名（提案建议不可变）：开发期需要把派生占位名改成可读名；代价与说明见 `review.md` `D-03`。
- 未做：UI 输入框、安装目录布局（多包覆盖）、实例 `blocked` 的恢复入口。
