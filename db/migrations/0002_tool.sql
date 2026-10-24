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
