---
layer: works
module: global
status: active
updated: 2026-10-26
---

# 给展示端的背景说明（约 400 字）

变更原因：Skill 数据混着两种用途——给人看、方便管理的，与给编排器装载整篇技能用的。旧契约里 summary 与 triggers 各承担一半“何时使用”，列表还要多读子表，编排侧却拿不到完整文本。

调整按面拆开。管理面：两者合并为 description，1–400 字，语义是“适用 / 触发 / 不适用”，也是列表检索与路由的唯一依据；创建、更新必须提交，带旧字段会 400。编排面：新增 GET /api/v1/skills/{id}/document，返回固定结构 markdown（frontmatter + 五章 + 可选两节），带 ETag，If-None-Match 可拿 304，停用技能同样可读。

对 UI 的影响只有三件事：字段改名并去掉触发词；表单按 1–400 校验 description；全文视图改从新端点取数，纯文本展示并复用 ETag。

细节见 ui-handoff.md；本仓库只给契约与数据，页面结构由 UI 决定。
