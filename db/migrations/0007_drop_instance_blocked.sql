-- 失败即终态、不自动重派，实例不需要「摘除」这层兜底：
-- blocked 会在跨 run 时静默拦截（任务永远 queued、界面无提示、unblock 无 REST 面），
-- 因此状态闭集收敛为 active / retired，存量 blocked 一律恢复为 active。

update instance set state = 'active' where state = 'blocked';

alter table instance drop constraint instance_state_check;
-- 同时连带删除 instance_check 与 instance_block_reason_check（只依赖该列）。
alter table instance drop column block_reason;
alter table instance add constraint instance_state_check check (state in ('active', 'retired'));
