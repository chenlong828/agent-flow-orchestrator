-- 单基线：当前全部业务表结构。上线后冻结本文件，后续只新增增量迁移。

-- Harness 聚合：聚合根与有序标签。

create table harness (
  id uuid primary key,
  name text not null,
  kind text not null check (kind in ('container', 'server', 'desktop', 'laptop')),
  address text not null check (char_length(address) between 1 and 200),
  access_mode text not null check (access_mode in ('agent', 'ssh', 'container_registry')),
  description text not null default '' check (char_length(description) <= 500),
  concurrency_max integer not null check (concurrency_max >= 1),
  queue_policy text not null check (queue_policy in ('fifo', 'priority')),
  enabled boolean not null default true,
  health text not null default 'unknown'
    check (health in ('unknown', 'online', 'offline', 'overloaded')),
  last_heartbeat_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  check (char_length(name) between 1 and 80)
);

create unique index harness_name_lower_key on harness (lower(name));
create index harness_kind_idx on harness (kind);
create index harness_enabled_idx on harness (enabled);
create index harness_health_idx on harness (health);
create index harness_updated_at_idx on harness (updated_at desc);

create table harness_tag (
  harness_id uuid not null references harness (id) on delete cascade,
  position integer not null check (position >= 0),
  tag text not null check (char_length(tag) > 0),
  primary key (harness_id, position),
  unique (harness_id, tag)
);

-- 工具聚合：聚合根与有序参数；Harness 归属由外键 RESTRICT 保护。

create table tool (
  id uuid primary key,
  name text not null,
  kind text not null check (kind in ('mcp', 'cli', 'script')),
  invocation text not null check (char_length(invocation) between 1 and 500),
  description text not null default '' check (char_length(description) <= 500),
  harness_id uuid not null references harness (id) on delete restrict,
  timeout_ms integer not null check (timeout_ms between 1000 and 600000),
  status text not null default 'unverified'
    check (status in ('unverified', 'available', 'unavailable')),
  last_debug_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  check (char_length(name) between 1 and 80)
);

create unique index tool_name_lower_key on tool (lower(name));
create index tool_harness_id_idx on tool (harness_id);
create index tool_kind_idx on tool (kind);
create index tool_status_idx on tool (status);
create index tool_updated_at_idx on tool (updated_at desc);

create table tool_param (
  tool_id uuid not null references tool (id) on delete cascade,
  position integer not null check (position >= 0),
  param_key text not null check (char_length(param_key) > 0),
  param_type text not null check (param_type in ('string', 'int')),
  description text not null default '',
  primary key (tool_id, position),
  unique (tool_id, param_key)
);

-- Skill 聚合：分类参考数据、brief、标签与草稿；包内容在文件系统。

create table skill_category (
  code text primary key,
  label text not null,
  position integer not null check (position >= 0),
  unique (position)
);

insert into skill_category (code, label, position) values
  ('coding', '编码', 0),
  ('retrieval', '检索', 1),
  ('review', '审视', 2),
  ('testing', '测试', 3)
on conflict (code) do nothing;

create table skill (
  id uuid primary key,
  name text not null,
  category_code text not null references skill_category (code) on delete restrict,
  description text not null check (char_length(description) between 1 and 400),
  package_key text not null unique,
  version text not null check (version ~ '^v[0-9]+\.[0-9]+$'),
  enabled boolean not null default true,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  check (char_length(name) between 1 and 80)
);

create unique index skill_name_lower_key on skill (lower(name));
create index skill_category_code_idx on skill (category_code);
create index skill_enabled_idx on skill (enabled);
create index skill_updated_at_idx on skill (updated_at desc);
create index skill_version_idx on skill (version);

create table skill_tag (
  skill_id uuid not null references skill (id) on delete cascade,
  position integer not null check (position >= 0),
  tag text not null check (char_length(tag) > 0),
  primary key (skill_id, position),
  unique (skill_id, tag)
);

create index skill_tag_tag_idx on skill_tag (tag);

create table skill_draft (
  id uuid primary key,
  skill_id uuid references skill (id) on delete cascade,
  base_revision integer check (base_revision is null or base_revision >= 1),
  base_version text check (
    base_version is null or base_version ~ '^v[0-9]+\.[0-9]+$'
  ),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_by text not null,
  check (
    (skill_id is null and base_revision is null and base_version is null)
    or
    (skill_id is not null and base_revision is not null and base_version is not null)
  )
);

create index skill_draft_skill_id_idx on skill_draft (skill_id);
create index skill_draft_expires_at_idx on skill_draft (expires_at);

-- 专家聚合：聚合根、人设、有序装配与引用。

create table expert (
  id uuid primary key,
  name text not null,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  role text not null check (char_length(role) between 1 and 200),
  enabled boolean not null default true,
  duty text not null default '',
  skill_order text not null default '',
  verify_order text not null default '',
  notes text not null default '',
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  check (char_length(name) between 1 and 80)
);

create unique index expert_name_lower_key on expert (lower(name));
create index expert_enabled_idx on expert (enabled);
create index expert_updated_at_idx on expert (updated_at desc);

create table expert_persona (
  expert_id uuid not null references expert (id) on delete cascade,
  position integer not null check (position >= 0),
  value text not null check (char_length(value) > 0),
  primary key (expert_id, position)
);

create table expert_skill (
  expert_id uuid not null references expert (id) on delete cascade,
  skill_id uuid not null references skill (id) on delete restrict,
  position integer not null check (position >= 0),
  primary key (expert_id, position),
  unique (expert_id, skill_id)
);

create index expert_skill_skill_id_idx on expert_skill (skill_id);

create table expert_tool (
  expert_id uuid not null references expert (id) on delete cascade,
  tool_id uuid not null references tool (id) on delete restrict,
  position integer not null check (position >= 0),
  primary key (expert_id, position),
  unique (expert_id, tool_id)
);

create index expert_tool_tool_id_idx on expert_tool (tool_id);

create table expert_ref (
  expert_id uuid not null references expert (id) on delete cascade,
  position integer not null check (position >= 0),
  label text not null check (char_length(label) > 0),
  ref_type text not null,
  path text,
  primary key (expert_id, position)
);

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
