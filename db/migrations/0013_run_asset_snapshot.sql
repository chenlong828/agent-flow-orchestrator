-- 运行终态脱钩：终态 run 不再用外键钉住工作流/Harness/专家。
-- 活跃引用仍为 workflow_id / harness_id / run_node.expert_id（ON DELETE RESTRICT），
-- 历史展示改用 workflow_ref_id / harness_ref_id / *_name / graph_snapshot。
--
-- 顺序：先加列并回填名字，再清终态活跃外键，最后收紧 not null 与 check。

alter table workflow_run add column workflow_ref_id uuid;
alter table workflow_run add column harness_ref_id uuid;
alter table workflow_run add column workflow_name text;
alter table workflow_run add column harness_name text;
alter table run_node add column expert_name text;

update workflow_run r
   set workflow_ref_id = w.id,
       workflow_name = w.name
  from workflow w
 where w.id = r.workflow_id;

update workflow_run r
   set harness_ref_id = h.id,
       harness_name = h.name
  from harness h
 where h.id = r.harness_id;

update run_node rn
   set expert_name = e.name
  from expert e
 where e.id = rn.expert_id;

-- 先去掉 NOT NULL，才能把终态 run 的活跃外键置空。
alter table workflow_run alter column workflow_id drop not null;
alter table workflow_run alter column harness_id drop not null;

-- 终态 run 脱钩：名字已回填，活跃外键置空。
update workflow_run
   set workflow_id = null,
       harness_id = null
 where state = 'done';

update run_node rn
   set expert_id = null
  from workflow_run r
 where rn.run_id = r.id
   and r.state = 'done'
   and rn.expert_id is not null;

alter table workflow_run alter column workflow_ref_id set not null;
alter table workflow_run alter column harness_ref_id set not null;
alter table workflow_run alter column workflow_name set not null;
alter table workflow_run alter column harness_name set not null;

alter table workflow_run add constraint workflow_run_history_detached
  check (state <> 'done' or (workflow_id is null and harness_id is null));

create index workflow_run_workflow_ref_idx on workflow_run (workflow_ref_id, created_at desc);
create index workflow_run_harness_idx on workflow_run (harness_id) where harness_id is not null;
create index run_node_expert_id_idx on run_node (expert_id) where expert_id is not null;
