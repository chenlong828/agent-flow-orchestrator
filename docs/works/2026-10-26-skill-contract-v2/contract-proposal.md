---
layer: works
module: global
status: active
updated: 2026-10-26
---

# Skill 契约 v2 提案：管理面字段 / 编排面文档

状态：**已确认（P1，2026-10-26）**。契约冻结，作为实现依据。跨项目只按本文件的 REST 契约交互。

## 0. 一句话

把 skill 拆成两个消费面：**管理面**继续用结构化字段（列表、筛选、表单、审计），**编排面**只认一份合成出来的 markdown 文档（frontmatter 里的 `description` 即路由键）；`summary` 与 `triggers` 合并为 `description`，其余字段不动。

## 1. 为什么按"两个面"切

| 面 | 消费者 | 需要什么 | 现在的缺口 |
|---|---|---|---|
| 管理面 | 人、管理端 | 可筛选、可编辑、可审计的结构化字段 | 基本够用；`summary` 与 `triggers` 语义重叠 |
| 编排面 | orchestrator | 一个路由键 + 一份可直接加载的完整文本 | **没有**任何端点能给出完整文本；拼接顺序只在代码里 |

两个面共用且只共用 `description`：人在表单里写一次，编排在文档 frontmatter 里读一次。其余字段各归一面，不互相借用。

## 2. 字段归属

| 字段 | 归属 | 说明 |
|---|---|---|
| `id` `name` `categoryCode` `categoryLabel` `tags` `enabled` `version` `revision` `updatedAt` `createdAt` `usedByCount` | 管理面 | 列表、筛选、表单、引用、审计 |
| `description` | **两面共用** | 人写"何时用 / 何时不适用"；编排当路由键，写入文档 frontmatter |
| `sections`（五章）`pitfalls` `refs` | 管理面编辑，仅经文档暴露 | 编排不直接读结构化字段，避免两套读法 |
| `document` | 编排面（派生） | 合成文本，**不落库**，每次按 `revision` 现场合成，不产生可漂移的第二份副本 |

## 3. 契约 diff

| 项 | v1（现状） | v2 |
|---|---|---|
| 请求字段 | `summary`（≤200 字）+ `triggers`（有序、唯一） | `description`（1–400 字） |
| 列表项 | `summary` + `triggers[]` | `description` |
| 详情 | `summary` + `triggers[]` | `description` |
| 查询 `q` | 仅匹配 `name` | 匹配 `name` 或 `description` |
| 新增 | — | `GET /api/v1/skills/{id}/document` → `text/markdown` |
| 数据 | `skill.summary`、`skill_trigger` 表 | `skill.description`；无 `skill_trigger` |

破坏性：删两个响应字段、删一个请求字段、删一张表。带 `summary` / `triggers` 的请求按现有的未知字段规则返回 400（[validation.ts:18-26](../../../src/components/http-gateway/validation.ts#L18-L26)）。

## 4. 管理面（改后）

### 4.1 列表项 `SkillListItem`

```ts
type SkillListItem = {
  id: string;
  name: string;
  categoryCode: string;
  categoryLabel: string;
  description: string;   // 原 summary；≤400
  version: string;       // vX.Y，服务端维护（本轮不变）
  enabled: boolean;
  tags: string[];        // 有序
  usedByCount: number;
  revision: number;
  updatedAt: string;
};
```

`triggers` 删除。列表读少一次子表查询：原 `1 + 2N`（tags/triggers）降为 `1 + N`。

### 4.2 详情 `SkillDetail`

`SkillListItem` + `sections: SkillSections`、`pitfalls: string[]`、`refs: SkillRef[]`、`createdAt`。五章与子表**存储不变**，仍是编辑单位。

### 4.3 创建/更新请求

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 1–80 字，唯一 |
| `categoryCode` | string | 是 | 必须存在 |
| `description` | string | 是 | 1–400 字，去首尾空白后校验；语义见 5.2 |
| `tags` | string[] | 否 | 有序 |
| `sections` | `SkillSections` | 是 | 五章齐全 |
| `pitfalls` | string[] | 否 | 有序 |
| `refs` | `SkillRef[]` | 否 | 有序；`path` 可空 |

`version`、`enabled`、`triggers` 均不在请求中，传了即 400。

### 4.4 查询

`q`（`name` 或 `description` 的 ILIKE，`%`/`_` 转义）、`category`、`tag`、`enabled`、`limit`、`offset`、`sort` 不变。

## 5. 编排面：文档端点

### 5.1 接口

| 项 | 值 |
|---|---|
| 方法与路径 | `GET /api/v1/skills/{id}/document` |
| 成功 | `200`，`Content-Type: text/markdown; charset=utf-8` |
| `ETag` | `"<revision>"`（与 `If-Match` 同格式，可直接回填用于后续更新） |
| 条件请求 | `If-None-Match` 命中 → `304`，无 body |
| `Cache-Control` | `no-cache`（强制带 ETag 再验证） |
| 失败 | `404`，沿用现有错误信封 `{ error: { code: "not_found", message, requestId } }` |
| 是否按 `enabled` 过滤 | 否。停用的 skill 照常输出；编排侧从列表按 `enabled` 选，不由文档端点兜底 |

### 5.2 `description` 的写法约定（写进字段说明）

- 回答"什么时候该加载这个 skill、什么时候不该"，不是营销简介。
- 建议句式：`适用：…；触发词：…；不适用：…`。触发词写在句子里即可，不再有独立的关键词数组。
- 1–400 字。400 是上限不是目标，一句到三句即可。

### 5.3 文档结构

固定顺序，由 `skill` 组件合成：

```markdown
---
name: "CRES 需求规范"
description: "适用：客户提出新需求或需求含糊时；触发词：需求分析、需求澄清、CRES；不适用：纯技术重构。"
version: "v1.3"
---

## 流程总述

<sections.overview>

## 执行步骤

<sections.steps>

## 示例

<sections.examples>

## 脚本

<sections.scripts>

## 完成验证

<sections.verification>

## 常见踩坑

- <pitfall 1>

## 参考资料

- <label>（<refType>）— <path>
```

规则：

- frontmatter 固定三键、固定顺序：`name`、`description`、`version`。双引号标量；`\` 与 `"` 转义；换行写成 `\n`。
- 五章标题**恒定输出**（即使内容为空），顺序固定：`流程总述`、`执行步骤`、`示例`、`脚本`、`完成验证`。标题是 API 契约的一部分，不随任何展示端文案变化。
- `pitfalls` 为空 → 整节"常见踩坑"省略；`refs` 为空 → 整节"参考资料"省略。不输出空列表。
- `refs[].path` 为空时只写 `- <label>（<refType>）`。
- 统一 `\n` 换行，文档以单个换行结尾。
- 文档内容不含 `categoryCode` / `categoryLabel` / `tags` / `enabled` / `revision`：它们是管理面字段，编排不需要。

### 5.4 编排侧组装方式（本轮不改代码，只约定）

按专家装配顺序逐个 `GET /skills/{id}/document`，拿到 markdown 直接进入上下文。当前规模（12 条 skill、单专家 ≤4 条）可接受；批量端点留待执行形态确定。

## 6. 数据迁移

### 6.1 回填口径

`description` = 原 `summary`；若该 skill 有触发词，追加 ` 触发：<kw1>、<kw2>…`。**不截断**：回填后超过 400 字则迁移失败，人工修数据（当前 12 条种子数据均远低于上限）。

### 6.2 迁移文件 `db/migrations/0005_skill_description.sql`

```sql
alter table skill add column description text;

update skill s
set description = s.summary || coalesce((
  select ' 触发：' || string_agg(t.keyword, '、' order by t.position)
  from skill_trigger t where t.skill_id = s.id
), '');

alter table skill alter column description set not null;
alter table skill add constraint skill_description_len
  check (char_length(description) between 1 and 400);

alter table skill drop column summary;
drop table skill_trigger;
```

### 6.3 回滚

迁移器只支持向上（[db-migrate.ts](../../../scripts/db-migrate.ts) 只调 `up()`），回滚以补偿迁移 `0006` 为准；开发库也可用 `db:init` 重建。当前无生产数据。

## 7. 影响面（本仓库）

| 位置 | 改动 |
|---|---|
| `db/migrations/0005_skill_description.sql` | 新增 |
| [`skill/spec.md`](../../design/components/skill/spec.md) | 数据表、不变量（`summary`→`description`）、文档合成规则、验证项 |
| [`src/components/skill/types.ts`](../../../src/components/skill/types.ts) | `summary`/`triggers` → `description`；新增文档类型 |
| [`src/components/skill/store.ts`](../../../src/components/skill/store.ts) | 根表字段、`q` 过滤、删 `triggersFor` 与 `replaceChildren` 里的触发词 |
| [`src/components/skill/service.ts`](../../../src/components/skill/service.ts) | 校验、`toSummary`、合成文档（新函数） |
| [`catalog/spec.md`](../../design/components/catalog/spec.md) + [`src/components/catalog/index.ts`](../../../src/components/catalog/index.ts) | `SkillListItem` / `SkillDetailView` 字段 |
| [`http-gateway/spec.md`](../../design/components/http-gateway/spec.md) | 字段表、API-14～21 表、新增 `API-31`（文档端点；现有最大编号为 `API-30`） |
| [`openapi.yaml`](../../../src/components/http-gateway/openapi.yaml) | `SkillCreate` / `SkillSummary` / `SkillDetail`、`/skills/{id}/document` |
| `src/components/http-gateway/*` | 路由 + markdown 响应 + ETag/304 |
| [`tests/components/skill/service.test.ts`](../../../tests/components/skill/service.test.ts) | 字段断言、迁移后行为、文档合成 |
| [`tests/components/http-gateway/skill.test.ts`](../../../tests/components/http-gateway/skill.test.ts) | 字段断言、`triggers` 400、`q` 命中 `description`、文档 3 正 1 反 |

## 8. 兼容与发布

破坏性变更；API 与消费端同批发布，不做 `/api/v2`，不留派生的 `summary` / `triggers` 过渡字段（已确认消费端调整无障碍）。

## 9. 未纳入本轮（及理由）

- **五章/踩坑/引用的存储收敛**（7 表降到 2 表）：收益是少 N+1、少机械代码，规模上还不值一次 P1 迁移；契约层解耦后，存储可单独收敛而不改契约。
- **`version` 与 `revision` 合并**：`version` 是展示字段，本轮不动，避免把两个决策捆在一起。
- **批量文档导出**（`/experts/{id}/documents`）：等执行形态（M4）确定后再定。
- **`?format=json` 文档变体**：编排侧直接吃 markdown，暂不需要第二种形状。
- **展示端形态**（tab、抽屉布局、如何渲染 markdown）：不在本仓库范围，后台只提供 `text/markdown` 数据。

## 10. 确认记录

- 2026-10-26：`description` 上限定为 **400** 字（原提案的 500 作废）。
- 2026-10-26：消费端字段调整无阻塞；本仓库只负责契约与数据，不规定展示端实现，因此不列对方文件与改造清单。
- 2026-10-26：详情抽屉的全文以 tab 展示属展示端决策；后台只提供文档数据，不参与展示形态设计。

## 11. 验收（文档端点 3 正 1 反）

- 正 1：完整 skill → frontmatter 三键齐全、五个固定 H2、踩坑与参考资料按序输出。
- 正 2：无踩坑、无引用 → 两整节省略，其余结构与正 1 一致。
- 正 3：`ETag` 与 `If-None-Match` → 304 无 body；`ETag` 值可直接用于 `If-Match` 更新。
- 反：资产不存在 → 404 JSON 错误信封；停用的 skill → 200（不按 `enabled` 过滤）。
- 契约：请求带 `summary` / `triggers` → 400；`q` 命中 `description`；列表与详情不再出现 `triggers`。
