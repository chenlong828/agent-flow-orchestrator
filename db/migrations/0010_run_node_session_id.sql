-- 节点会话绑定：记录 client 在 P-02 结果里回传的 sessionId。
-- 可空：结果未回传、历史行与重启补结算均保持 null，不补写。
alter table run_node add column session_id text;
