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
