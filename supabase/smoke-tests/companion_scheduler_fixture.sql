-- Minimal production-shaped fixture for the local companion scheduler migration smoke.
-- This file is never part of forward migration history and contains no production data.

create schema if not exists auth;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin bypassrls;
  end if;
end
$roles$;

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $function$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;

create table public.channel_config (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  channel_name text not null,
  active_model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel_name)
);

create table public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  category text not null,
  content text not null,
  version integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name, version)
);

create unique index prompt_templates_user_name_active_unique
  on public.prompt_templates (user_id, name)
  where active;

create table public.generation_ports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  port_key text not null,
  runtime_kind text not null,
  model_channel_name text,
  target_role text,
  identity_prompt_name text not null,
  style_prompt_name text,
  sop_source text,
  sop_ref text,
  version integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, port_key, version)
);

create unique index generation_ports_user_key_active_unique
  on public.generation_ports (user_id, port_key)
  where active;

create table public.conversation_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  profile_key text not null,
  conversation_kind text not null,
  handler text not null,
  session_policy text not null,
  singleton_session_key text,
  participant_port_keys text[] not null,
  default_responder_port_key text not null,
  rules_prompt_name text,
  context_recipe jsonb not null,
  version integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, profile_key, version)
);

create unique index conversation_profiles_user_key_active_unique
  on public.conversation_profiles (user_id, profile_key)
  where active;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_key text,
  conversation_profile_key text,
  conversation_kind text not null,
  handler text not null,
  routing_config jsonb not null default '{}'::jsonb,
  title text not null default '',
  override_model text,
  override_reasoning boolean,
  is_archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index sessions_user_id_session_key_unique
  on public.sessions (user_id, session_key)
  where session_key is not null;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null references public.sessions (id) on delete cascade,
  role text not null,
  sender_key text,
  reply_to_id uuid,
  target_sender_keys text[],
  content text not null default '',
  client_id uuid,
  client_created_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index messages_client_id_unique
  on public.messages (client_id)
  where client_id is not null;

create table public.agent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  actor text not null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  importance text not null default 'normal'
    check (importance in ('low', 'normal', 'high', 'urgent')),
  created_at timestamptz not null default now()
);

create table public.checkin_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  checkin_time timestamptz not null default now(),
  model text,
  input_summary text,
  raw_output text,
  decision text not null default 'sent',
  wechat_message_id text,
  tokens_used integer,
  error_detail text,
  created_at timestamptz not null default now()
);

alter table public.channel_config enable row level security;
alter table public.prompt_templates enable row level security;
alter table public.generation_ports enable row level security;
alter table public.conversation_profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.agent_events enable row level security;
alter table public.checkin_logs enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select, insert, update, delete
  on public.channel_config,
     public.prompt_templates,
     public.generation_ports,
     public.conversation_profiles,
     public.sessions,
     public.messages,
     public.agent_events,
     public.checkin_logs
  to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into public.channel_config (user_id, channel_name, active_model)
values (
  '10000000-0000-4000-8000-000000000001',
  'app_companion',
  'openai/local-smoke-model'
);

insert into public.prompt_templates (
  id,
  user_id,
  name,
  category,
  content,
  version,
  active
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'syzygy_base',
    'base',
    'Local identity Prompt',
    3,
    true
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'app_companion_reply_style',
    'style',
    'Local companion style Prompt',
    4,
    true
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'checkin_day',
    'scenario',
    'Local daytime checkin Prompt',
    5,
    true
  );

insert into public.generation_ports (
  id,
  user_id,
  port_key,
  runtime_kind,
  model_channel_name,
  identity_prompt_name,
  style_prompt_name,
  version,
  active
)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'app_companion',
  'api',
  'app_companion',
  'syzygy_base',
  'app_companion_reply_style',
  7,
  true
);

insert into public.conversation_profiles (
  id,
  user_id,
  profile_key,
  conversation_kind,
  handler,
  session_policy,
  singleton_session_key,
  participant_port_keys,
  default_responder_port_key,
  context_recipe,
  version,
  active
)
values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'app_companion',
  'direct',
  'api',
  'singleton',
  'syzygy_companion',
  array['app_companion'],
  'app_companion',
  '{
    "version": 1,
    "history_scope": "current_session",
    "epoch": "asia_shanghai_day",
    "selection": "newest_within_token_budget",
    "external_sources": []
  }'::jsonb,
  6,
  true
);

insert into public.sessions (
  id,
  user_id,
  session_key,
  conversation_profile_key,
  conversation_kind,
  handler,
  routing_config,
  title
)
values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'syzygy_companion',
  'app_companion',
  'direct',
  'api',
  '{
    "version": 2,
    "participants": ["chuanchuan", "app_companion"],
    "default_responder": "app_companion"
  }'::jsonb,
  'Syzygy'
);
