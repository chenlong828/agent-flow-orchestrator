---
layer: works
module: global
status: closed
updated: 2026-10-25
---

# 列表读模型补齐

## 背景

前端把列表当作选择/导航视图，但后端列表 DTO 缺少选择所需字段：Skill 列表没有 `triggers`，专家列表只有 `skillCount` 没有前 3 个 Skill 名称，工具列表没有 `description`。让 BFF 逐条拉详情会形成 N+1，并把读模型缺口推到中间层。

用户建议按 B1 数据量直接做加法，采用方案 A：列表 DTO 直接补齐字段；否决 BFF 富化与前端 N+1。

## 目标

1. `SkillListItem` 增加有序 `triggers`。
2. `ExpertListItem` 增加 `skills` 预览，按装配顺序取前 3 个 `{id,name}`。
3. `ToolListItem` 增加 `description`。
4. 领域读契约与 `catalog` 组合同步，列表接口一次请求即可渲染；不改变详情语义。

## 范围

**做：**

- `SkillSummary` 增加 `triggers`，`CMP-skill` 列表/摘要读取补齐。
- `ExpertSummary` 增加 `skillIds` 供 `catalog` 组合列表预览；`ExpertRead.list` 返回有序 ID。
- `CMP-catalog` 的 `SkillListItem` / `ExpertListItem` / `ToolListItem` 组合新增字段。
- HTTP 规格、OpenAPI、组件规格、架构端点说明与测试同步。

**不做：**

- 不改列表分页、筛选、排序语义。
- 不新增 `?include=` 参数，不引入 BFF 富化或前端 N+1。
- 不把 Skill/工具完整详情塞进列表；专家列表只取前 3 个预览。
- 不改数据库表结构。

## 改动级别与确认门

**P2**：兼容性读契约扩展，跨 `skill` / `expert` / `catalog` / `http-gateway` 多个组件；不改组件切分、数据库 schema 或数据所有权。

- 用户已给出方案 A 并明确否决 BFF 富化 / N+1，按该方案执行。
- 与 `2026-10-25-expert-aggregate-write` 同一批次验证；两处都完成后再收口。

## 任务表

| ID | 类型 | 组件 | 状态 | 产出 |
|---|---|---|---|---|
| `T-LIST-01` | change | `CMP-skill` | done | `SkillSummary.triggers` 与列表/摘要读取 |
| `T-LIST-02` | change | `CMP-expert` / `CMP-catalog` | done | 专家列表有序 `skillIds` 与前 3 个预览 |
| `T-LIST-03` | change | `CMP-tool` / `CMP-catalog` | done | 工具列表 `description` |
| `T-LIST-04` | docs/verify | `global` | done | 规格、OpenAPI、README/架构、测试与冒烟 |

## 验收标准

- `GET /skills` 每项含有序 `triggers`；乱序/空数组按存储顺序返回。
- `GET /experts` 每项含 `skills`，最多 3 个、顺序同装配，元素为 `{id,name}`；无装配为空数组。
- `GET /tools` 每项含 `description`，空描述返回空字符串。
- 详情接口仍返回完整字段，既有 `PUT` / 装配 / 并发语义不变。
- `bun test --max-concurrency=1` 与 `bun run typecheck` 通过；真实 API 列表响应包含新字段。
