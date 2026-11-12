-- 运行编排：一次工作流运行、节点执行轮次与制品元数据。
-- 归属 CMP-run；任务生命周期仍在 task / task_attempt，本迁移不给 task 加 run 关联。

create table workflow_run (
  id uuid primary key,
  workflow_id uuid not null references workflow (id) on delete restrict,
  workflow_revision integer not null check (workflow_revision >= 1),
  graph_snapshot jsonb not null check (jsonb_typeof(graph_snapshot) = 'object'),
  intent_markdown text not null check (char_length(intent_markdown) between 1 and 262144),
  harness_id uuid not null references harness (id) on delete restrict,
  client_id text not null check (
    char_length(client_id) between 1 and 64 and client_id !~ '\s'
  ),
  instance_id uuid not null references instance (id) on delete restrict,
  workspace_path text not null check (
    char_length(workspace_path) between 1 and 1024 and left(workspace_path, 1) = '/'
  ),
  task_space_path text not null check (
    char_length(task_space_path) between 1 and 1024 and left(task_space_path, 1) = '/'
  ),
  auto_confirm boolean not null default false,
  state text not null default 'created'
    check (state in ('created', 'running', 'waiting_confirm', 'done')),
  outcome text check (outcome is null or outcome in ('succeeded', 'failed', 'cancelled')),
  current_node_id text,
  final_message text,
  error jsonb,
  archive_state text not null default 'none'
    check (archive_state in ('none', 'pending', 'stored', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  check (state <> 'done' or outcome is not null),
  check (state <> 'done' or finished_at is not null)
);

-- 同一工作区同一时刻最多一个活跃 run；不同工作区互不影响。
create unique index workflow_run_active_instance_key
  on workflow_run (instance_id)
  where state in ('running', 'waiting_confirm');
create index workflow_run_workflow_idx on workflow_run (workflow_id, created_at desc);
create index workflow_run_state_idx on workflow_run (state);
create index workflow_run_archive_idx on workflow_run (archive_state) where archive_state = 'pending';

create table run_node (
  run_id uuid not null references workflow_run (id) on delete cascade,
  node_id text not null check (
    char_length(node_id) between 1 and 64 and node_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
  ),
  visit integer not null default 1 check (visit between 1 and 100),
  node_type text not null
    check (node_type in ('start', 'agent', 'split', 'review', 'confirm', 'fanout', 'end')),
  expert_id uuid references expert (id) on delete restrict,
  state text not null default 'queued'
    check (state in ('queued', 'dispatched', 'waiting_confirm', 'succeeded', 'rejected', 'failed')),
  task_id uuid,
  verdict jsonb,
  message text,
  error jsonb,
  dispatched_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, node_id, visit),
  check (state <> 'dispatched' or task_id is not null)
);

-- 一个任务只对应一轮节点执行；重派复用同一 taskId。fan-out（第二期）需要放宽此约束。
create unique index run_node_task_id_key on run_node (task_id) where task_id is not null;
create index run_node_run_state_idx on run_node (run_id, state);

create table run_artifact (
  id uuid primary key,
  run_id uuid not null references workflow_run (id) on delete cascade,
  node_id text,
  visit integer check (visit is null or visit between 1 and 100),
  attempt integer check (attempt is null or attempt between 1 and 100),
  kind text not null check (kind in ('session_log', 'archive')),
  store_key text not null check (char_length(store_key) between 1 and 1024),
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (
    (kind = 'archive' and node_id is null and visit is null and attempt is null)
    or (kind = 'session_log' and node_id is not null and visit is not null and attempt is not null)
  )
);

create unique index run_artifact_log_key
  on run_artifact (run_id, node_id, visit, attempt) where kind = 'session_log';
create unique index run_artifact_archive_key
  on run_artifact (run_id) where kind = 'archive';
create index run_artifact_run_idx on run_artifact (run_id, created_at);
