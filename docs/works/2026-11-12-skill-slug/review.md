---
layer: works
module: global
status: active
updated: 2026-11-12
procedure: 2026-11-12-skill-slug
---

# 评审与裁决：技能系统标识 `slug`

定级 **P1**：动 `skill` 表 schema 与公共契约，影响 5 个消费方（skill、catalog、gateway、seed、执行面间接）。

## Blocker

无。

## Decision now

| ID | 决定 | 影响 |
|---|---|---|
| `D-01` | 新增 `skill.slug`（展示名 `name` 不动），包内 frontmatter 的 `name` 取 `slug` | 契约加字段、向后兼容；展示名语义不变，UI 无需改也能继续用 |
| `D-02` | `slug` 缺省派生 `skill-<uuid 尾 8 位>` | UUIDv7 前 8 位是毫秒时间戳，同毫秒批量创建会撞（测试实测 22 例全部冲突），故取尾段 |
| `D-03` | `slug` 允许在保存时改名（非不可变） | 开发期需要把占位名改成可读名；代价是 DSH 技能身份随改名变化，运行中的旧包不受影响 |
| `D-04` | 迁移用增量 `0006`，不改基线；存量回填占位 slug 后由一次保存重打包 | 偏离「直接改基线重建库」惯例，理由是保留现有工作流/运行/技能数据；仅 2 条技能，代价可控 |
| `D-05` | 下载文件名改用 `slug`（`<slug>-<version>.zip`） | 中文展示名在 `Content-Disposition` 里会被额外编码；包内文件名与技能身份保持一致 |

## Verified sound

| 区域 | 查了什么 / 怎么查 | 结果 |
|---|---|---|
| 包内 frontmatter | 重打包后下载 `GET /executor/skill-packages/{id}` 并 `unzip -p SKILL.md` | `name: "workflow-init"`、`version: "v1.1"` |
| 读模型 | 列表/详情返回 `slug`，`q` 可命中 slug | 测试 `TC-SLG` 覆盖 |
| 唯一性 | 名称冲突与 slug 冲突按约束名分别映射 | 测试：slug 重复 `details.field=slug` |
| 派生规则 | 缺省 slug 与 id 尾 8 位一致 | 测试断言 |
| 真实运行 | 起 run，节点 n1（start） | 由 `failed(asset)` 变为 `succeeded`，run 推进到 n2 |
| 回归 | `bun test --max-concurrency=1` | 390 pass / 0 fail |
| 门禁 | `typecheck`、`docs:check`、`quality:report` | 通过；违规 0 |

## Hold

| ID | 事项 | 去向 |
|---|---|---|
| `H-01` | 安装目录布局：多个技能包解到同一个 staging 根，会互相覆盖 | `OQ-33`（客户端侧） |
| `H-02` | 失败运行把实例置 `blocked`，同工作区再启动静默 `queued`，`unblock` 无 REST 面 | `OQ-32` |
| `H-03` | UI 无「系统标识」输入框，新建技能只能拿派生 slug | 交 `agent-flow-ui` |
