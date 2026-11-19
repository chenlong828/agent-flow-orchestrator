-- 执行面结果信号与确认点续跑（v3 加法）。
-- result_signal：编排侧按节点下发的信号契约，opaque JSON；重派不变（S-05）。
-- resume_session_id：确认点续跑时复用同一 session；缺省表示新建 session。
alter table task
  add column result_signal jsonb
  check (result_signal is null or jsonb_typeof(result_signal) = 'object');

alter table task
  add column resume_session_id text
  check (resume_session_id is null or (char_length(resume_session_id) between 1 and 200));
