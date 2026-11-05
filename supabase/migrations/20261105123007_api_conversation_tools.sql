-- API-only preferences and durable execution receipts. Existing CLI routes are unchanged.
create table public.api_conversation_tools (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled_tools text[] not null default '{}',
  updated_at timestamptz not null default now()
);
create table public.api_tool_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  reply_id uuid not null references public.messages(id) on delete cascade,
  fingerprint text not null,
  tool_id text not null,
  status text not null check (status in ('running','completed','failed','unknown')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(reply_id,fingerprint)
);
create table public.api_model_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  reply_id uuid not null references public.messages(id) on delete cascade,
  attempt integer not null,
  round integer not null,
  model text,
  status text not null check(status in ('pending','completed','failed')),
  usage jsonb,
  created_at timestamptz not null default now(),
  unique(reply_id,attempt,round)
);
alter table public.api_conversation_tools enable row level security;
alter table public.api_tool_executions enable row level security;
alter table public.api_model_calls enable row level security;
create policy api_tools_owner_read on public.api_conversation_tools for select to authenticated using(user_id=(select auth.uid()));
create policy api_executions_owner_read on public.api_tool_executions for select to authenticated using(user_id=(select auth.uid()));
create policy api_calls_owner_read on public.api_model_calls for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.api_conversation_tools,public.api_tool_executions,public.api_model_calls from public,anon,authenticated;
grant select on public.api_conversation_tools,public.api_tool_executions,public.api_model_calls to authenticated;
grant all on public.api_conversation_tools,public.api_tool_executions,public.api_model_calls to service_role;
create index api_tools_owner_idx on public.api_conversation_tools(user_id);
create index api_executions_session_idx on public.api_tool_executions(session_id);
create index api_executions_owner_idx on public.api_tool_executions(user_id);
create index api_calls_owner_date_idx on public.api_model_calls(user_id,created_at);
create index api_calls_session_idx on public.api_model_calls(session_id);

create function public.api_conversation_usage(p_session uuid) returns jsonb
language sql stable security invoker set search_path=public as $$
  with scopes as (select 'session' as scope union all select 'today'),
  totals as (
    select s.scope, count(c.id) as calls,
      coalesce(sum(case when jsonb_typeof(c.usage->'cost')='number' then (c.usage->>'cost')::numeric else 0 end),0) as cost_usd,
      count(c.id) filter(where c.usage->'cost' is null or jsonb_typeof(c.usage->'cost')<>'number') as unknown_calls,
      coalesce(sum((c.usage->>'prompt_tokens')::bigint),0) as prompt_tokens,
      coalesce(sum((c.usage->>'completion_tokens')::bigint),0) as completion_tokens,
      coalesce(sum(coalesce(c.usage#>>'{prompt_tokens_details,cached_tokens}',c.usage->>'cache_read_input_tokens')::bigint),0) as cached_tokens,
      coalesce(sum(coalesce(c.usage#>>'{prompt_tokens_details,cache_write_tokens}',c.usage->>'cache_creation_input_tokens')::bigint),0) as cache_write_tokens
    from scopes s left join public.api_model_calls c on c.user_id=(select auth.uid()) and
      ((s.scope='session' and c.session_id=p_session) or
       (s.scope='today' and c.created_at >= (date_trunc('day',now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')))
    group by s.scope
  ) select jsonb_object_agg(scope,to_jsonb(totals)-'scope') from totals;
$$;
revoke all on function public.api_conversation_usage(uuid) from public,anon;
grant execute on function public.api_conversation_usage(uuid) to authenticated;
