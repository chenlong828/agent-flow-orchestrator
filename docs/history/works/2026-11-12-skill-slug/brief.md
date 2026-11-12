---
layer: works
module: global
status: frozen
updated: 2026-11-12
procedure: 2026-11-12-skill-slug
level: P1
---

# 工序：技能系统标识 `slug`（分离展示名与 DSH 技能名）

> 输入：`agent-flow-client` 的提案 ``2026-11-12-skill-name-proposal/proposal.md``（外部仓库）；`OQ-31`。
> 用户裁决（2026-11-12）：方案 A（新增 `slug`，`name` 继续做展示名）；开发阶段不做复杂迁移，只给存量补一个默认名继续开发；本轮先只做 slug，安装布局另议。

## 1 问题

`skill.name` 同时承担展示名与 DSH 技能名：前者要中文，后者必须 kebab-case。编排侧把展示名写进 `SKILL.md` 的 `name`，执行端按 DSH 规则拒绝（`invalid_skill_format`），带技能包的 run 在安装阶段失败。

## 2 范围

| 做 | 不做 |
|---|---|
| `skill.slug` 列、回填、唯一索引；`SaveSkill.slug` 与派生规则 | 客户端与 DSH 的任何改动 |
| 包内 frontmatter `name` 改用 `slug`；下载文件名用 `slug` | 安装目录布局（见 `OQ-32` 以外的说明 §5） |
| 读模型、目录投影、OpenAPI、种子数据 | UI 表单字段（另一个仓库，另行跟进） |
| 存量两个技能按可读 slug 重打包 | 展示名唯一性策略变更 |

## 3 验收标准

1. 展示名「工作流初始化」+ `slug=workflow-init`：保存成功，包内 `SKILL.md` 为 `name: "workflow-init"`。
2. 缺省不传 `slug`：派生 `skill-<uuid 尾 8 位>`（不用前 8 位，UUIDv7 前 8 位是毫秒时间戳）。
3. `slug` 非法（大写、下划线、中文、`--`、首尾 `-`）：`400 validation_error`，`details.field=slug`。
4. `slug` 重复：`409 name_conflict`，`details.field=slug`。
5. 更新时显式改 `slug` 生效并重建包；缺省沿用原值。
6. 真实运行：带技能包的工作流在客户端安装通过，节点进入执行（不再 `invalid_skill_format`）。

## 4 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-SLG-01` | design | skill / catalog / gateway | 决策、契约与字段 | 完成 |
| `T-SLG-02` | change | `CMP-skill` | `0006_skill_slug.sql`、保存/读路径、包构建、冲突映射 | 完成 |
| `T-SLG-03` | change | `CMP-catalog` / `CMP-http-gateway` | `slug` 投影、OpenAPI、字段白名单 | 完成 |
| `T-SLG-04` | change | seed / 存量数据 | 12 个种子技能补 slug；存量 2 个技能按可读 slug 重打包 | 完成 |
| `T-SLG-05` | test | 上述组件 | slug 契约测试 5 例 + 既有断言更新 | 完成 |

## 5 未决

- 安装目录布局：客户端把包解到同一个 staging 根，多包会互相覆盖（`OQ-33`）。
- 失败运行会把实例置 `blocked`，同工作区再启动会静默 `queued`，`unblock` 没有 REST 面（`OQ-32`）。
- UI 的「系统标识」输入框未加，当前新建技能只能拿到派生 slug。
