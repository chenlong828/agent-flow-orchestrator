-- 收敛 workflow_run 表宽度：运行没有人工编辑（updated_by 不成立），
-- started_at 在创建时写入且此后不变（等于 created_at），最终消息与错误同属一次运行结果。
alter table workflow_run add column result jsonb;

update workflow_run
   set result = jsonb_build_object('finalMessage', final_message, 'error', error);

alter table workflow_run
  drop column final_message,
  drop column error,
  drop column started_at,
  drop column updated_by;
