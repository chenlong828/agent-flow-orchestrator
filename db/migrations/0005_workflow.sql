-- 工作流定义：聚合根、唯一当前定义与专家引用投影。

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
