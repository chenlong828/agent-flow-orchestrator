-- 回退进入原因：只存「是哪一行的驳回导致本行被创建」的指针，理由正文仍以被驳回行的 verdict 为准。
alter table run_node
  add column enter_reason jsonb
  check (enter_reason is null or jsonb_typeof(enter_reason) = 'object');
