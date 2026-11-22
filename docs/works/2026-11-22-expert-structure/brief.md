---
layer: works
module: expert
status: active
updated: 2026-11-22
procedure: 2026-11-22-expert-structure
level: P2
---

# 工序：专家结构精简，职责范围合并为 Markdown

## 1 背景与目标

专家编辑界面目前把职责、技能配合顺序、验证顺序、任务解读分成四块展示，其中三块在运行期没有独立消费者；工具清单与参考知识也没有运行期消费者。用户要求专家只保留「角色定位 + 职责范围 + 性格标签 + Skill 组合」，其余字段先退出运行链路与接口返回，等 UI 改造完成后删除。

目标：

- 专家根只保留 `role`、`duty`（Markdown 职责范围）、`persona` 与有序 `skillIds`。
- 原 `skillOrder` / `verifyOrder` / `notes` 的存量内容合并进 `duty`，用固定 Markdown 小节承载。
- 工具清单、参考知识、主要工作内容不再进入提示词；接口字段返回空值，写请求接受但忽略。
- Skill 仍通过配置（`expert_skill` 顺序）注入，不写进职责范围文本。

## 2 范围

| 做 | 不做 |
|---|---|
| 新增迁移 0015：四列合并为 `duty` Markdown 并清空旧列 | 本轮不删除 `expert_tool` / `expert_ref` 表与 `expert` 的三列 |
| 领域读模型：弃用字段恒为空，`tools`/`refs` 恒为空数组 | 不改 UI 仓库；不处理 UI 侧 ③④⑤ 的删除 |
| 提示词只拼 名称/角色/性格/职责范围 | 不改 Skill 装配顺序与技能包下发 |
| 写请求：弃用字段校验形状后忽略；`setTools` 接受但不落库 | 不改 `API-28` Skill 装配语义 |
| seed 改为 Markdown 职责范围 | 不预置新专家、不改工作流图 |
| 组件规格、OpenAPI、测试同步 | 不新增工具/参考知识相关的替代能力 |

## 3 关键决策（已确认）

| 问题 | 结论 | 来源 |
|---|---|---|
| 职责范围 Markdown 结构 | 四个二级标题：`## 主要职责`、`## 技能配合顺序`、`## 重点验证顺序`、`## 对承担任务的解读`，空段省略 | 用户选择推荐方案 |
| 存量数据 | 新增 SQL 迁移合并四列并清空旧列，同时改 seed | 用户选择推荐方案 |
| 过渡期写入 | 弃用字段接受但忽略，读恒为空；等 UI 完成后整体删除 | 用户选择推荐方案 |

## 4 验收

1. `GET /experts/{id}`：`duty` 为 Markdown；`skillOrder`/`verifyOrder`/`notes` 恒为 `""`；`tools`/`refs` 恒为 `[]`；`toolCount` 恒为 `0`；`role`/`persona`/`skills`/`skillCount` 保持原语义。
2. 新派发任务的 prompt 专家块只有 名称/角色/性格/职责范围，不再出现「职责：」「验证顺序：」「注意事项：」三行。
3. 迁移把存量四列拼成 `duty` 并清空旧列；重跑 seed 得到同一 Markdown。
4. 写请求：`skillOrder`/`verifyOrder`/`notes`/`refs`/`toolIds` 只校验形状；`setTools` 接受请求并推进 revision，但 `expert_tool` 无新增。
5. `bun run typecheck`、`bun test --max-concurrency=1` 通过；服务重启后 `/healthz` 正常且 `/openapi.yaml` 已含新字段说明。

## 5 任务表

| ID | 类型 | 组件 | 内容 | 状态 |
|---|---|---|---|---|
| `T-EXP-STR-01` | change | expert/db | 迁移 0015 合并四列并清空 | 完成 |
| `T-EXP-STR-02` | change | expert | 读写模型：duty Markdown、弃用字段读空/写忽略、setTools 过渡 | 完成 |
| `T-EXP-STR-03` | change | run | prompt 专家块改为 职责范围 + Markdown | 完成 |
| `T-EXP-STR-04` | change | catalog | 详情 tools/refs 空值、toolCount 0 | 完成 |
| `T-EXP-STR-05` | change | http-gateway | OpenAPI 字段说明与弃用标注 | 完成 |
| `T-EXP-STR-06` | change | seed | 专家种子改为 Markdown 职责范围 | 完成 |
| `T-EXP-STR-07` | test | expert/run/catalog/gateway/seed | 契约与迁移测试同步 | 完成 |
| `T-EXP-STR-08` | docs | design | expert/run/catalog/http-gateway/architecture 规格同步 | 完成 |
| `T-EXP-STR-09` | ops | local | 本地迁移、seed、重启 3100 并验证 | 完成 |
