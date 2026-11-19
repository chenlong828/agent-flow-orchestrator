-- 超时节点继续跑：新增 waiting_resume 中间态。
-- 只放宽状态闭集与活跃 run 唯一索引；不加列、不改 task/run_artifact。

alter table workflow_run drop constraint workflow_run_state_check;
alter table workflow_run add constraint workflow_run_state_check
  check (state in ('created', 'running', 'waiting_confirm', 'waiting_resume', 'done'));

alter table run_node drop constraint run_node_state_check;
alter table run_node add constraint run_node_state_check
  check (state in ('queued', 'dispatched', 'waiting_confirm', 'waiting_resume', 'succeeded', 'rejected', 'failed'));

drop index workflow_run_active_instance_key;
create unique index workflow_run_active_instance_key
  on workflow_run (instance_id)
  where state in ('running', 'waiting_confirm', 'waiting_resume');
