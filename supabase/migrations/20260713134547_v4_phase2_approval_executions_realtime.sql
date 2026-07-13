-- V4 Phase 2 · approval_executions 加入 Realtime publication
-- App 审批详情页需要实时看到执行状态翻转（claimed → running → succeeded/failed）；
-- postgres_changes 走 WAL RLS，authenticated 仅能收到本人行（owner SELECT 策略）。
alter publication supabase_realtime add table public.approval_executions;
