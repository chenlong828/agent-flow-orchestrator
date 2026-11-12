-- 执行面任务携带 task-space 路径（v3）：由运行编排在入队时冻结，重派不变。

alter table task add column task_space_path text not null default ''
  check (task_space_path = '' or left(task_space_path, 1) = '/');
