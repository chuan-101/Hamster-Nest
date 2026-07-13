-- V4 Phase 2 · 审批执行回流表 approval_executions
-- 依据：开发清单 §6「Mac mini 新增审批监听器，复用 claimed/idempotency 防重范式」。
-- claim 即 INSERT：unique(approval_id) 保证同一审批只被一个执行器认领一次；
-- 状态与结果由执行方（service_role）维护，客户端只读（authenticated 仅 SELECT own）。

create table public.approval_executions (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null unique references public.approval_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  executor text not null,
  status text not null default 'claimed'
    check (status in ('claimed', 'running', 'succeeded', 'failed', 'stale_skipped')),
  claimed_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  exit_code integer,
  output_excerpt text,
  error_message text
);

comment on table public.approval_executions is
  '审批执行回流（V4 Phase 2）：监听器 claim 即插入，unique(approval_id) 防止同一审批执行两次；写入全走 service_role，客户端只读。';
comment on column public.approval_executions.executor is
  '执行方标识（如 mac_mini），多执行器时用于排查归属。';
comment on column public.approval_executions.status is
  'claimed → running → succeeded/failed；stale_skipped = 批准时间超出新鲜窗口，认领后跳过执行。';
comment on column public.approval_executions.output_excerpt is
  '执行输出摘录（截断），不含敏感密钥；完整输出留在执行方本地日志。';

alter table public.approval_executions enable row level security;

create policy "approval_executions_select_own"
  on public.approval_executions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- 事实回流表：不为 authenticated 开 INSERT/UPDATE/DELETE，写入全走 service_role。

create index approval_executions_user_claimed_at_idx
  on public.approval_executions (user_id, claimed_at desc);
