-- 归档策略修正：从未有节点成功结算的终止 run 不再请求归档。
-- 这些 run 在客户端没有可打包的 task-space，继续下发会造成电平死循环。

update workflow_run r
   set archive_state = 'none', updated_at = now()
 where r.archive_state = 'pending' and r.state = 'done'
   and not exists (
     select 1 from run_node n where n.run_id = r.id and n.state = 'succeeded'
   );
