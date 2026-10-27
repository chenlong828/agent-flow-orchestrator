---
layer: history
module: global
status: frozen
updated: 2026-10-27
---

# B1 数据领域对象清单

> 范围：仅 B1。本文先确认「有哪些领域对象、归属哪个聚合、彼此什么关系、有哪些不变量」；表级数据库设计（列类型、索引、DDL）在确认后单独做，不在本文冻结。

## 1 口径

- 领域对象（Domain Object，OBJ）按聚合归属列出；一个聚合只有一个写入口。
- 类型：**聚合根**、**子实体**、**关联实体**、**参考数据**、**只读投影**。
- 只读投影不落表，由查询组合；派生计数不落可写列。
- 表名只是设计占位；表级设计时允许调整列名，不改变对象职责与关系。

## 2 对象总表

| ID | 对象 | 类型 | 表 | 所属聚合 | 一句话职责 | 主要用例 |
|---|---|---|---|---|---|---|
| `OBJ-01` | Harness | 聚合根 | `harness` | Harness | 登记一个可承载任务的运行设施 | `UC-B1-01` |
| `OBJ-02` | Harness 标签 | 子实体 | `harness_tag` | Harness | 给 Harness 打有序能力标签 | `UC-B1-01` |
| `OBJ-03` | 工具 | 聚合根 | `tool` | 工具 | 登记一个可被专家使用的工具及其调用信息 | `UC-B1-02` |
| `OBJ-04` | 工具参数 | 子实体 | `tool_param` | 工具 | 描述工具入参的名称、类型与顺序 | `UC-B1-02` |
| `OBJ-05` | Skill 分类 | 参考数据 | `skill_category` | Skill | 提供稳定的 Skill 分类代码与展示名 | `UC-B1-03` |
| `OBJ-06` | Skill | 聚合根 | `skill` | Skill | 登记一份可被专家引用的能力说明 | `UC-B1-03` |
| `OBJ-07` | Skill 标签 | 子实体 | `skill_tag` | Skill | 给 Skill 打有序标签 | `UC-B1-03` |
| `OBJ-08` | 触发词 | 子实体 | `skill_trigger` | Skill | 描述触发 Skill 的关键词 | `UC-B1-03` |
| `OBJ-09` | Skill 章节 | 子实体 | `skill_section` | Skill | 承载渐进式披露的五章内容 | `UC-B1-03` |
| `OBJ-10` | 踩坑记录 | 子实体 | `skill_pitfall` | Skill | 记录该 Skill 的已知坑与对策 | `UC-B1-03` |
| `OBJ-11` | Skill 引用 | 子实体 | `skill_ref` | Skill | 指向支撑该 Skill 的资料或规范 | `UC-B1-03` |
| `OBJ-12` | 专家 | 聚合根 | `expert` | 专家 | 登记一个承担工作流节点的专家角色 | `UC-B1-04` |
| `OBJ-13` | 专家人设 | 子实体 | `expert_persona` | 专家 | 描述专家的工作风格与约束 | `UC-B1-04` |
| `OBJ-14` | 专家 Skill 关联 | 关联实体 | `expert_skill` | 专家 | 表达专家使用哪些 Skill 及其顺序 | `UC-B1-05` |
| `OBJ-15` | 专家工具关联 | 关联实体 | `expert_tool` | 专家 | 表达专家使用哪些工具及其顺序 | `UC-B1-05` |
| `OBJ-16` | 专家引用 | 子实体 | `expert_ref` | 专家 | 指向专家依赖的资料或规范 | `UC-B1-04` |

合计：4 个聚合根、9 个子实体、2 个关联实体、1 个参考数据、16 张表。

## 3 聚合与对象卡

### 3.1 Harness 聚合

**`OBJ-01` Harness（聚合根）**

- 身份：`id`（UUIDv7）。
- 业务属性：`name`、`kind`、`address`、`accessMode`、`description`、`concurrencyMax`、`queuePolicy`、`enabled`。
- 运行时属性：`health`、`lastHeartbeatAt`。B1 只读展示；新对象 `health=unknown`、`lastHeartbeatAt=null`，客户端不可写。
- 并发与审计：`revision`、`createdAt`、`updatedAt`、`createdBy`、`updatedBy`。
- 不变量：
  - `name` 大小写不敏感唯一。
  - `kind ∈ container / server / desktop / laptop`。
  - `accessMode ∈ agent / ssh / container_registry`。
  - `concurrencyMax ≥ 1`。
  - `queuePolicy ∈ fifo / priority`。
  - `health ∈ unknown / online / offline / overloaded`。
  - 有工具引用时不可删除。

**`OBJ-02` Harness 标签（子实体）**

- 属性：`harnessId`、`position`、`tag`。
- 不变量：同一 Harness 内 `tag` 唯一；`position` 从 0 连续；随 Harness 删除级联。
- 数量上限：UI 未给出明确依据，组件规格/表级设计时再定，不在对象层编造。

### 3.2 工具聚合

**`OBJ-03` 工具（聚合根）**

- 身份：`id`（UUIDv7）。
- 业务属性：`name`、`kind`、`invocation`、`description`、`harnessId`、`timeoutMs`。
- 运行时属性：`status`、`lastDebugAt`。B1 新对象 `status=unverified`、`lastDebugAt=null`；客户端不可写。
- 并发与审计：`revision`、`createdAt`、`updatedAt`、`createdBy`、`updatedBy`。
- 不变量：
  - `name` 大小写不敏感唯一。
  - `kind ∈ mcp / cli / script`。
  - `harnessId` 必须指向存在的 Harness；Harness 被引用时不可删除。
  - `timeoutMs` 在 1 秒～10 分钟之间。
  - `status ∈ unverified / available / unavailable`；B1 客户端不可写。
  - 有专家引用时不可删除。

**`OBJ-04` 工具参数（子实体）**

- 属性：`toolId`、`position`、`paramKey`、`paramType`、`description`。
- 不变量：同一工具内 `paramKey` 唯一；`paramType ∈ string / int`；`position` 从 0 连续；随工具删除级联。
- 数量上限：同上，UI 未给出依据，设计时定。

### 3.3 Skill 聚合

**`OBJ-05` Skill 分类（参考数据）**

- 属性：`code`（主键）、`label`、`position`。
- 建议初始 4 行：编码、检索、审视、测试；代码建议 `coding / retrieval / review / testing`，表级设计确认。
- 不变量：`code` 稳定不复用；分类不提供删除接口；Skill 必须属于一个分类。

**`OBJ-06` Skill（聚合根）**

- 身份：`id`（UUIDv7）。
- 业务属性：`name`、`categoryCode`、`summary`、`version`、`enabled`。
- 并发与审计：`revision`、`createdAt`、`updatedAt`、`createdBy`、`updatedBy`。
- 不变量：
  - `name` 大小写不敏感唯一。
  - `categoryCode` 必须存在。
  - `summary` ≤200 字。
  - `version` 形如 `vX.Y`；API 新建为 `v1.0`；每次保存 minor+1，minor 超过 9 时 major+1、minor=0；客户端不可直接写；种子保留 UI 版本（如 `v0.9`）。
  - 五章齐全：`overview / steps / examples / scripts / verification`。
  - 有专家引用时不可删除。
  - B1 不建版本历史表；版本号只用于展示与冲突提示。

**`OBJ-07` Skill 标签（子实体）**

- 属性：`skillId`、`position`、`tag`；同一 Skill 内唯一、有序、级联删除。

**`OBJ-08` 触发词（子实体）**

- 属性：`skillId`、`position`、`keyword`；同一 Skill 内 `keyword` 唯一、有序。

**`OBJ-09` Skill 章节（子实体）**

- 属性：`skillId`、`kind`、`contentMd`；`kind` 固定五类，每个 Skill 恰好五条；主键 `(skillId, kind)`。

**`OBJ-10` 踩坑记录（子实体）**

- 属性：`skillId`、`position`、`content`；有序；随 Skill 删除级联。

**`OBJ-11` Skill 引用（子实体）**

- 属性：`skillId`、`position`、`label`、`refType`、`path`（可空）。
- `refType` 在 REST 契约中先按字符串；是否收敛为固定枚举，表级设计时确认；B1 种子按 UI 实际值转换，不新造类型。

### 3.4 专家聚合

**`OBJ-12` 专家（聚合根）**

- 身份：`id`（UUIDv7）。
- 业务属性：`name`、`color`、`role`、`enabled`、`duty`、`skillOrder`、`verifyOrder`、`notes`。
- 并发与审计：`revision`、`createdAt`、`updatedAt`、`createdBy`、`updatedBy`。
- 不变量：
  - `name` 大小写不敏感唯一。
  - `color` 形如 `#RRGGBB`。
  - `role` 非空；`enabled` 默认 `true`。
  - B1 没有工作流节点引用，删除允许；后续出现节点引用后再补删除保护。
  - `refCount` 不落列；B1 查询结果为 0。

**`OBJ-13` 专家人设（子实体）**

- 属性：`expertId`、`position`、`value`；有序；随专家删除级联。

**`OBJ-14` 专家 Skill 关联（关联实体）**

- 属性：`expertId`、`skillId`、`position`。
- 不变量：同一专家内 `skillId` 唯一、`position` 唯一；Skill 必须存在；Skill 被引用时不可删除；随专家删除级联。

**`OBJ-15` 专家工具关联（关联实体）**

- 属性：`expertId`、`toolId`、`position`。
- 不变量：同一专家内 `toolId` 唯一、`position` 唯一；工具必须存在；工具被引用时不可删除；随专家删除级联。

**`OBJ-16` 专家引用（子实体）**

- 属性：`expertId`、`position`、`label`、`refType`、`path`（可空）；有序；随专家删除级联。

**专家五区映射**：

| UI 五区 | 领域对象 / 字段 | 说明 |
|---|---|---|
| ① 角色描述 | `expert.role`、`expert_persona` | 角色定位 + 性格/视角标签 |
| ② Skill 组合 | `expert_skill` | 有序引用 Skill |
| ③ 工具清单 | `expert_tool` | 有序引用工具 |
| ④ 主要工作内容 | `expert.duty`、`skillOrder`、`verifyOrder`、`notes` | 职责、Skill 配合顺序、验证顺序、任务解读 |
| ⑤ 参考知识 | `expert_ref` | 业务经验、行业规则、运行期注入 |

> UI 规格里的「关注视角」没有独立夹具字段；当前由 `role` / `notes` 承接。是否拆独立字段，在表级设计时确认，不先造列。

## 4 关系与删除规则

| 关系 | 基数 | 删除规则 | 说明 |
|---|---|---|---|
| Harness → 工具 | 1:N | `RESTRICT` | 有工具的 Harness 不可删 |
| 工具 → 工具参数 | 1:N | `CASCADE` | 删工具清理参数 |
| Skill 分类 → Skill | 1:N | `RESTRICT` | 分类不提供删除接口 |
| Skill → 标签/触发词/章节/踩坑/引用 | 1:N | `CASCADE` | 删 Skill 清理子表 |
| 专家 → 人设/引用 | 1:N | `CASCADE` | 删专家清理子表 |
| 专家 ↔ Skill | N:M | `RESTRICT`（Skill 侧） | 删专家清理关联；删 Skill 被专家引用时拒绝 |
| 专家 ↔ 工具 | N:M | `RESTRICT`（工具侧） | 删专家清理关联；删工具被专家引用时拒绝 |

- 所有关联目标必须存在；外键是最后一道保护，服务层先做可读错误。
- 聚合根硬删除；B1 不做软删除。
- 子表不单独暴露 CRUD；随聚合整体替换。

## 5 只读投影与派生值

以下对象不落表，由查询时组合；不建可写计数列。

| ID | 投影 | 内容 | 用途 |
|---|---|---|---|
| `OBJ-R01` | 资产列表项 | `id`、`name`、类型相关摘要、启停状态（按资产）、`revision`、`updatedAt` | 各资产列表 |
| `OBJ-R02` | 资产详情 | 聚合根字段 + 子实体有序列表 + 关联摘要 | 各资产详情 |
| `OBJ-R03` | 引用摘要 | 引用方类型、ID、名称、计数 | 删除前检查、引用查询 |
| `OBJ-R04` | 专家装配 | 专家 + 有序 Skill/工具摘要 | 专家详情与装配回读 |

派生值口径：

- Harness `toolCount`：引用它的工具数。
- Skill/工具 `usedByCount`：引用它的专家数；B1 不含工作流节点。
- 专家 `skillCount` / `toolCount`：装配关联数。
- 专家 `refCount`：B1 固定 0（没有工作流节点引用）。
- 不落 `nodeCount`、`lastRun`、`running` 等非 B1 派生值。

## 6 生命周期与事务

- **创建**：聚合根 + 子实体在同一事务插入；`revision=1`；`createdAt/updatedAt` 服务端生成。
- **更新**：聚合根字段更新；有序子表整体替换；`revision+1`；旧 `revision` 冲突返回 409。
- **启停**：Harness、Skill、专家只更新 `enabled` 与 `revision`，不级联；工具没有启停。
- **删除**：先做引用检查；再删聚合根（子表级联）；有引用返回 409 + 引用列表。
- **装配**：专家 Skill/工具列表整体替换，与专家 `revision` 同一事务；不会留下半套关系。
- **版本**：Skill 保存时服务端 minor+1；新建 `v1.0`；客户端不能写版本。

## 7 实施采用口径

用户 2026-10-24 直接要求按当前 spec 实现，以下按设计默认采用：

1. 4 个聚合、16 张表；Skill 的五章、标签、触发词、踩坑、引用均为独立子实体。
2. 审计字段只放聚合根，子表不单独记录。
3. Skill 新建 `v1.0`，每次保存 minor+1，`v1.9` 进位 `v2.0`；B1 不提供 major 直达入口。
4. `skill_category` 使用 `coding/retrieval/review/testing` + 中文标签。
5. `refType` 先存文本，不固定枚举。
6. 有序子表不设业务数量上限，只做字段级长度与请求体校验。
7. 专家在 B1 无引用方，允许直接删除；后续工作流节点引用出现时再加保护。
8. 种子可写 UI 演示值（在种子与结果中标注），通过 API 新建的对象仍保持 `unknown`/`unverified`。
9. 「关注视角」不新增独立字段，由 `role` / `notes` 承接。
