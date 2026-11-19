-- run 初始资料（图片）：暂存 → 启动绑定。
-- staged 无 TTL，一直保留到绑定或 DELETE；bound 随 run 保留。

create table run_input (
  id uuid primary key,
  run_id uuid references workflow_run (id) on delete cascade,
  position integer check (position is null or position between 1 and 100),
  name text not null check (char_length(name) between 1 and 200),
  media_type text not null
    check (media_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  store_key text not null unique,
  state text not null check (state in ('staged', 'bound')),
  created_at timestamptz not null default now(),
  bound_at timestamptz,
  check (
    (state = 'staged' and run_id is null and position is null and bound_at is null)
    or
    (state = 'bound' and run_id is not null and position is not null and bound_at is not null)
  )
);

create unique index run_input_run_name on run_input (run_id, name) where state = 'bound';
create unique index run_input_run_position on run_input (run_id, position) where state = 'bound';
create index run_input_staged_idx on run_input (created_at) where state = 'staged';
