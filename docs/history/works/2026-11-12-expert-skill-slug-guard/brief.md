---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-12-expert-skill-slug-guard
level: P2
---

# 工序：专家装配入口校验技能系统标识唯一

> 触发：`OQ-33`（客户端按技能名建目录，多包重名会报 `invalid_skill_format`）。
> 用户要求（2026-11-12）：expert 绑定 skills 时，把「slug 不重复」作为入口断言，避免坏装配到 client 才报错。

## 1 问题

客户端（`agent-flow-client` `CMP-assets`）把每个技能包按 `SKILL.md` frontmatter 的 `name`（即编排侧 `skill.slug`）落入 `<skills>/<name>/`；同一技能集内重名时按 `invalid_skill_format` 显式失败，不再静默覆盖。编排侧目前只在建包时保证全局 `slug` 唯一，专家装配入口没有把「同一专家内 slug 不重复」写成可读断言；一旦将来唯一性范围变化、数据绕过写入口或包内名称漂移，错误会推迟到运行期由 client 暴露。

## 2 范围

| 做 | 不做 |
|---|---|
| `kernel` 增加只读端口 `SkillSlugReader`；`skill` 实现 | 客户端、DSH 与 UI 的任何改动 |
| `expert` 的 `create` / `updateAggregate` / `setSkills` 入口校验同一专家内 `slug` 唯一，重复返回 `ValidationError`（400） | 数据库 schema / 迁移；不改变现有全局唯一索引 |
| 组合根、测试与组件规格、OpenAPI 描述、场景失败路径、`OQ-33` 收口 | 运行期派发入口的重复校验（错误在装配入口已拦截） |

## 3 验收标准

1. 同一专家装配两个 `slug` 相同的 Skill：`create` 返回 `400 validation_error`，`details.field=skillIds`，专家根不落库。
2. 同一专家 `PATCH` 聚合更新 `skillIds` 到重复 `slug`：返回 400，`details.field=skillIds`，主体、其他装配与 `revision` 均不变。
3. 同一专家 `PUT /skills` 装配重复 `slug`：返回 400，`details.field=items`，装配与 `revision` 不变。
4. 两个 `slug` 不同的 Skill 正常装配，既有 3 正 1 反回归通过。
5. `SkillSlugReader` 对已存在 Skill 返回 `id → slug`，未知 id 不出现在结果中，空输入返回空对象。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-EXS-01` | change | `CMP-kernel` | 定义 `SkillSlugReader` 只读端口 | 完成 |
| `T-EXS-02` | change | `CMP-skill` | 实现 `createSkillSlugReader`，按 id 批量读 `slug` | 完成 |
| `T-EXS-03` | change | `CMP-expert` / 组合根 | 装配入口校验重复 slug；注入端口 | 完成 |
| `T-EXS-04` | change | `CMP-http-gateway` | OpenAPI 请求字段与操作说明补 400 语义 | 完成 |
| `T-EXS-05` | test | expert / skill | 重复 slug 拒绝、端口读取、既有回归 | 完成 |
| `T-EXS-06` | docs | expert / skill / kernel / architecture / scenario / OQ | 规格、依赖、失败路径与 `OQ-33` 收口 | 完成 |
