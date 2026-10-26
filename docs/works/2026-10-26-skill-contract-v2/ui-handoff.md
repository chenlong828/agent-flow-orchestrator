---
layer: works
module: global
status: active
updated: 2026-10-26
---

# 交接：Skill 契约 v2 对展示端的影响

## 边界

本文件只交付**契约差异与数据来源**，供独立项目 `../agent-flow-ui` 安排自己的重构；页面结构、tab/抽屉排布、组件拆分由该项目决定，本仓库不改其代码、不规定其实现。

后端已按 [`contract-proposal.md`](contract-proposal.md) 交付完成，验证见 [`result.md`](result.md)。

## 一、契约变化（展示端必须跟进）

| 面 | 变化 | 展示端处理 |
|---|---|---|
| Skill 列表/详情 | `summary`（≤200）删除，改为 `description`（1–400，必填） | 字段改名与长度校验；列表/详情的简介位置改读 `description` |
| Skill 列表/详情 | `triggers: string[]` 删除 | 删除“触发词”展示与编辑控件；触发信息已并入 `description` 文本 |
| 创建/更新 | 请求体必须带 `description`；出现 `summary`/`triggers` 返回 400 `validation_error`（`details.field = "body"`） | 提交前不要带旧字段；捕获 400 时提示“契约已升级，请刷新页面” |
| 检索 `q` | 同时匹配 `name` 与 `description` | 搜索框占位文案可写“名称或描述” |
| 专家详情 | `skills[]` 摘要字段 `summary` → `description` | 专家详情里的技能条目改读 `description` |
| 新增 `GET /api/v1/skills/{id}/document` | 返回 `text/markdown; charset=utf-8`，`ETag: "<revision>"`；带相同 `If-None-Match` 返回 304 无响应体；停用技能照常返回；不存在 404 JSON | 全文展示的唯一数据源；不要把五章/踩坑/引用在展示端重新拼成一篇 |

## 二、展示端要做的数据侧改动

1. **表单**：`description` 必填、1–400 字（前端先校验，后端仍会校验）；删除触发词输入；旧表单若残留 `summary`/`triggers` 必须清掉，否则 400。
2. **列表**：简介列改读 `description`；删除触发词列/标签云。
3. **详情**：结构化五章、踩坑、引用仍来自 `API-15`；全文视图改为请求 `API-31`，按纯文本渲染。
4. **全文缓存**：首次请求保存 `ETag`；再次打开同一 Skill 时带 `If-None-Match`，304 则复用上一次文本。
5. **状态**：`enabled=false` 的技能同样能取到文档；如果展示端之前用启停过滤全文入口，需要放开。
6. **Mock/夹具**：删除 `summary`、`triggers` 字段；新增 `document` 的 markdown 夹具（含空踩坑/空引用两种）。

## 三、建议的展示端任务顺序

| 顺序 | 任务 | 验收 |
|---|---|---|
| U1 | 字段替换：`description` 接入列表/详情/表单，删除 `triggers` | 列表、详情、编辑提交均无旧字段；请求无 400 |
| U2 | 校验与提示：1–400 字前端校验；400 `validation_error` 统一提示 | 超长/缺失被前端拦住；服务端 400 有可读提示 |
| U3 | 全文视图接 `API-31`，处理 200/304/404 | 文档顺序与后端一致；二次打开命中 304 |
| U4 | 专家详情技能条目改读 `description` | 无 undefined/空白字段 |
| U5 | 夹具与回归：mock 数据、端到端冒烟 | 列表/详情/全文三条路径通过 |

## 四、验收口径（对展示端）

- 网络面板中不再出现 `summary`、`triggers` 字段；写请求带旧字段会失败。
- 全文视图内容与 `GET /skills/{id}/document` 响应完全一致，不在前端二次拼接。
- 304 时页面仍能显示上次文本（不出现空白）。
- 列表检索能通过描述命中（例如搜“方案”命中名称为“CRED 技能”的条目）。
