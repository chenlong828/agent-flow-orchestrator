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
