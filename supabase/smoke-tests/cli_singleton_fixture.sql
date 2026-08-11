-- Minimal production-shaped fixture for the local dual-CLI singleton migration smoke.
-- This file is never part of forward migration history and contains only fake data.

create schema if not exists auth;
create schema if not exists private;

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
  title text not null default '',
  session_key text,
  conversation_profile_key text,
  conversation_kind text not null,
  handler text not null,
  routing_config jsonb not null default '{}'::jsonb,
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
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function private.enforce_versioned_chat_config_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (to_jsonb(new) - 'active' - 'updated_at') is distinct from
     (to_jsonb(old) - 'active' - 'updated_at') then
    raise exception '% rows are append-only', tg_table_name;
  end if;
  if not old.active and new.active then
    raise exception '% inactive versions cannot be reactivated', tg_table_name;
  end if;
  new.updated_at := now();
  return new;
end
$function$;

create trigger conversation_profiles_immutable_version
before update on public.conversation_profiles
for each row execute function private.enforce_versioned_chat_config_immutable();

alter table public.generation_ports enable row level security;
alter table public.conversation_profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;

create policy generation_ports_select_own
  on public.generation_ports for select to authenticated
  using ((select auth.uid()) = user_id);
create policy conversation_profiles_select_own
  on public.conversation_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy sessions_select_own
  on public.sessions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy messages_select_own
  on public.messages for select to authenticated
  using ((select auth.uid()) = user_id);

grant usage on schema public, auth to anon, authenticated, service_role;
grant select on public.generation_ports, public.conversation_profiles,
  public.sessions, public.messages to authenticated;
grant select, insert, update, delete on public.generation_ports,
  public.conversation_profiles, public.sessions, public.messages to service_role;

insert into public.generation_ports (
  id, user_id, port_key, runtime_kind, target_role,
  identity_prompt_name, style_prompt_name, version, active
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'codex_cli', 'cli', 'codex_cli_syzygy',
    'syzygy_base', 'codex_cli_reply_style', 1, true
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'claude_cli', 'cli', 'claude_code_cli_syzygy',
    'syzygy_base', 'claude_cli_reply_style', 1, true
  );

insert into public.conversation_profiles (
  id, user_id, profile_key, conversation_kind, handler, session_policy,
  singleton_session_key, participant_port_keys, default_responder_port_key,
  rules_prompt_name, context_recipe, version, active
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'codex_cli', 'direct', 'cli', 'multi', null,
    array['codex_cli'], 'codex_cli', null,
    '{"version":1,"history_scope":"current_session","epoch":"session","selection":"newest_within_token_budget","external_sources":[]}',
    1, true
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'claude_cli', 'direct', 'cli', 'multi', null,
    array['claude_cli'], 'claude_cli', null,
    '{"version":1,"history_scope":"current_session","epoch":"session","selection":"newest_within_token_budget","external_sources":[]}',
    1, true
  );

insert into public.sessions (
  id, user_id, title, session_key, conversation_profile_key,
  conversation_kind, handler, routing_config
)
values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Syzygy·本体', 'syzygy_cli', null, 'direct', 'cli',
  '{
    "version":1,
    "display_name":"Syzygy·本体",
    "avatar":"🐹",
    "source_label":"Mac mini · 本体",
    "participants":["chuanchuan","syzygy_cli","syzygy_proactive"],
    "default_responder":"syzygy_cli",
    "target_role":"codex_cli_syzygy"
  }'
);

insert into public.messages (
  id, user_id, session_id, role, sender_key, reply_to_id,
  target_sender_keys, content, meta, created_at
)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'user', 'chuanchuan', null, array['syzygy_cli'],
    '旧窗口里的问题。', '{}', '2026-08-08T12:00:00Z'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'assistant', 'syzygy_cli',
    '50000000-0000-4000-8000-000000000001', null,
    '旧窗口里的回答。', '{"delivery_state":"completed"}',
    '2026-08-08T12:00:01Z'
  );

create or replace function private.forbid_cli_smoke_message_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'CLI singleton migration must not mutate canonical messages';
end
$function$;

create trigger forbid_cli_smoke_message_mutation
before insert or update or delete on public.messages
for each row execute function private.forbid_cli_smoke_message_mutation();
