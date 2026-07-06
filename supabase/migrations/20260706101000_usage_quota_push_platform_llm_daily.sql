-- P1 · 1-3 usage guardrail, P2 · 2-1 push platform column, P4 · 4-2 cost view.

-- ── usage_quota: per (user, scope, Beijing day) call counter ──
-- Written exclusively through consume_usage_quota() by Edge Functions running
-- as service_role; RLS stays enabled with a read-only owner policy so the
-- frontend can render quota usage later.
create table if not exists public.usage_quota (
  user_id uuid not null,
  scope text not null,
  day date not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, day)
);

alter table public.usage_quota enable row level security;

create policy "usage_quota_select_authenticated" on public.usage_quota
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Atomically bump today's counter and return the new count. Limits live in
-- the calling function so per-scope tuning is a code change, not a DDL one.
create or replace function public.consume_usage_quota(p_user_id uuid, p_scope text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Shanghai')::date;
  v_count integer;
begin
  insert into public.usage_quota (user_id, scope, day, count)
  values (p_user_id, p_scope, v_day, 1)
  on conflict (user_id, scope, day)
  do update set count = usage_quota.count + 1, updated_at = now()
  returning count into v_count;
  return v_count;
end;
$$;

revoke execute on function public.consume_usage_quota(uuid, text) from public, anon, authenticated;

-- ── push_subscriptions.platform: web | expo | apns ──
-- letter-generate dispatches per platform; the native channels arrive with
-- the Expo app (review item 2-1).
alter table public.push_subscriptions
  add column if not exists platform text not null default 'web';

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_platform_check;
alter table public.push_subscriptions
  add constraint push_subscriptions_platform_check
  check (platform in ('web', 'expo', 'apns'));

-- ── llm_usage daily aggregation (4-2) ──
-- Plain view for now: at the current row count a materialized view would buy
-- nothing and cost a refresh pipeline; flip it if llm_usage growth ever makes
-- the dashboard query measurable.
create or replace view public.llm_usage_daily
with (security_invoker = true) as
select
  (created_at at time zone 'Asia/Shanghai')::date as day,
  module,
  model,
  count(*) as calls,
  sum(prompt_tokens) as prompt_tokens,
  sum(completion_tokens) as completion_tokens,
  sum(total_tokens) as total_tokens,
  sum(cached_tokens) as cached_tokens,
  sum(cache_write_tokens) as cache_write_tokens,
  sum(cost_usd) as cost_usd
from public.llm_usage
group by 1, 2, 3;
