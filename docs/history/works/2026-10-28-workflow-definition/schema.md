---
layer: history
module: workflow
status: frozen
updated: 2026-10-29
---

# 工作流定义 Schema 与数据库修改提案（P1 第二轮评审材料）

> 状态：提案，未冻结。本文只设计 B3 工作流定义的三张表；不写数据库修改、不改数据库。本工序不搬迁任何旧数据。
>
> 关联：[architecture.md](architecture.md)、[contract.md](contract.md)、[review.md](review.md)。

## 1 表清单

| 表 | 作用 | 删除规则 |
|---|---|---|
| `workflow` | 工作流聚合根 | 删除级联定义与专家引用 |
| `workflow_definition` | 唯一当前定义，`graph` JSONB | 随 `workflow` 级联 |
| `workflow_expert_ref` | 专家引用投影 | 随 `workflow` 级联；`expert_id` `RESTRICT` |

不建：`workflow_version`、`workflow_behavior`、`workflow_run`、`workflow_expert_ref_history`。

## 2 DDL 提案

```sql
create table workflow (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 80),
  type text not null check (char_length(type) between 1 and 40),
  description text not null default '' check (char_length(description) <= 500),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);

create unique index workflow_name_lower_key on workflow (lower(name));
create index workflow_type_idx on workflow (type);
create index workflow_updated_at_idx on workflow (updated_at desc);

create table workflow_definition (
  workflow_id uuid primary key references workflow (id) on delete cascade,
  graph jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  check (
    jsonb_typeof(graph) = 'object'
    and jsonb_typeof(graph->'stages') = 'array'
    and jsonb_typeof(graph->'nodes') = 'array'
    and jsonb_typeof(graph->'edges') = 'array'
  )
);

create table workflow_expert_ref (
  workflow_id uuid not null references workflow (id) on delete cascade,
  node_id text not null
    check (node_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  expert_id uuid not null references expert (id) on delete restrict,
  primary key (workflow_id, node_id)
);

create index workflow_expert_ref_expert_idx
  on workflow_expert_ref (expert_id);
```

### 2.1 说明

- `workflow.name` 大小写不敏感唯一，已确认；不改成不唯一。
- `type` 是自由文本标签，1–40 字；不建枚举，不加 `check` 的固定值。
- `description` 默认空串，避免 `null` 与空串两套语义。
- `workflow_definition` 没有独立 `revision`；并发由 `workflow.revision` 控制。
- `graph` 的数据库 check 只做“顶层对象 + 三个数组”的兜底；字段级形状由服务校验，不用数据库函数重复实现。
- `workflow_expert_ref` 的主键保证一个节点最多一个专家；`expert_id` 可重复，表示同一专家被多个节点/工作流引用。
- `expert_id` 外键 `RESTRICT`：专家被当前定义引用时不能删除；删除保护同时由 `ReferenceGuard` 提前返回 409。
- 不建 `position`；专家引用没有顺序语义。

## 3 Graph JSON 形状

```json
{
  "stages": [
    {
      "id": "s1",
      "name": "方案设计",
      "description": "",
      "layout": { "x": 80, "y": 120, "width": 320, "height": 240 }
    }
  ],
  "nodes": [
    {
      "id": "n1",
      "type": "start",
      "name": "开始",
      "stageId": "s1",
      "expertId": "0192f0c4-7a1e-7d3b-9c2a-1f5e6d7c8b9a",
      "layout": { "x": 120, "y": 160 }
    },
    {
      "id": "n2",
      "type": "confirm",
      "name": "是否进入实现",
      "stageId": "s1",
      "expertId": null,
      "layout": { "x": 360, "y": 160 }
    }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2", "kind": "seq" }
  ]
}
```

约束：

- `stages`、`nodes`、`edges` 必须存在且为数组；创建时为空数组。
- 节点/阶段/边字段集固定，未知字段拒绝；`layout` 可省略。
- `stageId` 为 `null` 或存在的阶段 ID；`expertId` 为 `null` 或 UUID。
- 边 `kind` 只能 `seq` / `rollback`；`from`/`to` 必须存在且不能相同。
- 规模上限：阶段 ≤100、节点 ≤500、边 ≤1000。

## 4 专家引用投影

保存/复制/导入后按图重建：

```sql
delete from workflow_expert_ref where workflow_id = $1;

insert into workflow_expert_ref (workflow_id, node_id, expert_id)
select $1, n->>'id', (n->>'expertId')::uuid
from jsonb_array_elements($2::jsonb -> 'nodes') as n
where n->>'expertId' is not null;
```

- 只投影 `expertId` 非空的节点；`confirm` 若错误绑专家，也会被投影，供删除保护和后续修正。
- 同一工作流同一节点只有一行；图校验保证节点 ID 唯一。
- 投影可随时从 `graph` 重建；不作为唯一事实源。

### 4.1 引用计数

```sql
select expert_id, count(distinct workflow_id)::int as ref_count
from workflow_expert_ref
where expert_id = any($1::uuid[])
group by expert_id;
```

- 按不同工作流数计数，不按节点数。
- 列表批量查询，避免 N+1。

### 4.2 删除保护

- `CMP-expert` 删除前 `ReferenceGuard.check("expert", id)`；
- `catalog` 调 `WorkflowRead.listByExpert(id)`，返回工作流引用；
- 非空抛 `ReferencedError`，HTTP 409 `referenced`；
- 数据库 `expert_id RESTRICT` 作为并发兜底。

## 5 事务与并发

### 5.1 创建

```text
insert workflow
insert workflow_definition (empty graph)
commit
```

### 5.2 保存定义

```text
begin
select workflow ... for update
check revision
replace workflow_definition.graph
delete workflow_expert_ref where workflow_id = id
insert workflow_expert_ref from graph
update workflow set revision = revision + 1, updated_at, updated_by
commit
```

- 形状校验在事务前完成；事务内只做写入与 FK。
- 专家不存在由 FK 触发，事务回滚，服务转 `ValidationError`。
- 语义警告在事务前计算，写入成功后随响应返回。

### 5.3 复制

```text
begin
select source workflow + definition
insert new workflow
insert new workflow_definition with source graph
insert workflow_expert_ref from source graph
commit
```

- 节点/阶段/边 ID 原样复制；新 `workflow_id` 隔离。
- 源图语义不合法也允许复制；复制不是修复，也不做发布。

### 5.4 导入

```text
begin
validate DSL（形状 + 语义）
resolve expertId：不存在则置 null，记录 warning
insert new workflow
insert definition with graph
insert workflow_expert_ref
commit
```

- 导入总是新建；不覆盖。
- 名称冲突在插入根时由唯一索引转 409。
- `idMap` 当前为恒等映射；不静默重命名。

## 6 数据库修改

### 6.1 文件

- 文件：`db/migrations/0005_workflow.sql`。
- `db/migrations/` 是项目既有目录名，内容就是数据库修改脚本；不是搬数据。
- 实际编号在实现时按当时 `db/migrations/` 的下一个可用号确定；如果 Skill 包工序先占用，顺延。
- 只新增表，不改 B1 表；不新增列到 `expert`。

### 6.2 顺序

1. `workflow`
2. `workflow_definition`
3. `workflow_expert_ref`（依赖 `expert`）

### 6.3 回滚

- 只回滚新表：`drop table workflow_expert_ref; drop table workflow_definition; drop table workflow;`
- 无历史数据搬迁；B3 是新表，回滚不涉及数据转换。

### 6.4 数据库修改测试

- 三张表存在，列/类型/默认值正确。
- `workflow_name_lower_key` 唯一；大小写不同名称冲突。
- `workflow_definition` 删除级联；`workflow_expert_ref` 删除级联。
- `workflow_expert_ref.expert_id` 删除规则为 `RESTRICT`。
- `graph` 顶层不是对象/数组时插入失败。
- 不硬编码全库业务表总数；Skill 包工序可能并行改表。

## 7 查询

### 7.1 列表

```sql
select w.*,
  coalesce(jsonb_array_length(d.graph->'nodes'), 0) as node_count,
  coalesce(jsonb_array_length(d.graph->'stages'), 0) as stage_count
from workflow w
join workflow_definition d on d.workflow_id = w.id
where ...
order by ...
limit $n offset $m;
```

- `q` 用 `lower(name) like` 或 `ilike`；转义 `%`/`_`。
- `type` 精确匹配。
- 默认 `updated_at desc`，同时间用 `id asc` 稳定排序。

### 7.2 详情

- 根 + 定义一次查询；返回 graph。
- 不返回 behavior、运行数据。

### 7.3 专家引用

- `listByExpert`：`workflow_expert_ref` 联 `workflow`，按 `updated_at desc, id asc`。
- `countByExperts`：见 4.1；空数组返回 `{}`。

## 8 审计与安全

- `created_by`/`updated_by` 取 `X-Actor`，只做显示审计；不是身份。
- 不存密钥、token、专家输出、workspace 路径。
- JSONB 只存图；不把任意用户请求原样落库，先过字段白名单。
- 请求体上限沿用网关；图规模上限在服务层先拦。

## 9 未决

1. 数据库修改编号与 Skill 包工序的先后。

并发策略：QPS < 1 的 MVP 不增加专家删除相关锁或串行化；专家删除由 `expert_id` 的 `RESTRICT` 外键兜底；冲突返回 409，不自动重试。
