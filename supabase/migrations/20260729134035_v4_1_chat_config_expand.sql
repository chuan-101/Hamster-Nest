-- Production migration history: 20260729134035.
-- V4.1 W1 / 3.2: versioned chat generation ports and conversation profiles.
--
-- Expand only:
-- - existing sessions keep conversation_profile_key = NULL;
-- - existing Prompt rows and editor writes remain untouched;
-- - the fixed companion session is migrated in a later, separately reversible step.

set lock_timeout = '5s';
set statement_timeout = '2min';

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- ── Versioned generation ports ───────────────────────────────────────────────

create table public.generation_ports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
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
  constraint generation_ports_port_key_check
    check (port_key ~ '^[a-z][a-z0-9_]*$'),
  constraint generation_ports_runtime_kind_check
    check (runtime_kind in ('api', 'cli')),
  constraint generation_ports_runtime_config_check
    check (
      (
        runtime_kind = 'api'
        and model_channel_name is not null
        and btrim(model_channel_name) <> ''
        and target_role is null
      )
      or (
        runtime_kind = 'cli'
        and target_role is not null
        and btrim(target_role) <> ''
      )
    ),
  constraint generation_ports_identity_prompt_check
    check (btrim(identity_prompt_name) <> ''),
  constraint generation_ports_style_prompt_check
    check (style_prompt_name is null or btrim(style_prompt_name) <> ''),
  constraint generation_ports_sop_pair_check
    check (
      (sop_source is null and sop_ref is null)
      or (
        sop_source = 'git'
        and sop_ref is not null
        and btrim(sop_ref) <> ''
      )
    ),
  constraint generation_ports_version_check
    check (version > 0),
  constraint generation_ports_user_key_version_unique
    unique (user_id, port_key, version),
  constraint generation_ports_model_channel_fkey
    foreign key (user_id, model_channel_name)
    references public.channel_config (user_id, channel_name)
    on update cascade
    on delete restrict
);

create unique index generation_ports_user_key_active_unique
  on public.generation_ports (user_id, port_key)
  where active;

create index generation_ports_user_lookup_idx
  on public.generation_ports (user_id, port_key, active, version desc);

create index generation_ports_user_model_channel_idx
  on public.generation_ports (user_id, model_channel_name)
  where model_channel_name is not null;

comment on table public.generation_ports is
  'Versioned catalog of chat-producing API and CLI ports. Runtime safety SOP bodies remain in Git.';
comment on column public.generation_ports.port_key is
  'Stable routing key such as app_companion, app_chat, codex_cli, or claude_cli.';
comment on column public.generation_ports.model_channel_name is
  'Optional owner-scoped channel_config reference; required for API ports.';
comment on column public.generation_ports.sop_ref is
  'Immutable Git reference for code-coupled CLI safety/SOP behavior; nullable until the runtime integration slice.';

-- ── Versioned conversation profiles ─────────────────────────────────────────

create table public.conversation_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
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
  constraint conversation_profiles_profile_key_check
    check (profile_key ~ '^[a-z][a-z0-9_]*$'),
  constraint conversation_profiles_shape_check
    check (
      (conversation_kind = 'direct' and handler in ('api', 'cli'))
      or (conversation_kind = 'group' and handler = 'router')
    ),
  constraint conversation_profiles_session_policy_check
    check (session_policy in ('singleton', 'multi')),
  constraint conversation_profiles_singleton_key_check
    check (
      (
        session_policy = 'singleton'
        and singleton_session_key is not null
        and btrim(singleton_session_key) <> ''
      )
      or (
        session_policy = 'multi'
        and singleton_session_key is null
      )
    ),
  constraint conversation_profiles_participants_check
    check (
      cardinality(participant_port_keys) > 0
      and array_position(participant_port_keys, null) is null
      and default_responder_port_key = any (participant_port_keys)
      and (
        conversation_kind = 'group'
        or cardinality(participant_port_keys) = 1
      )
    ),
  constraint conversation_profiles_default_responder_check
    check (btrim(default_responder_port_key) <> ''),
  constraint conversation_profiles_rules_prompt_check
    check (
      rules_prompt_name is null
      or btrim(rules_prompt_name) <> ''
    ),
  constraint conversation_profiles_group_rules_check
    check (
      conversation_kind <> 'group'
      or rules_prompt_name is not null
    ),
  constraint conversation_profiles_context_recipe_check
    check (
      jsonb_typeof(context_recipe) = 'object'
      and jsonb_typeof(context_recipe -> 'version') = 'number'
      and context_recipe ->> 'history_scope' = 'current_session'
      and context_recipe ->> 'epoch' in ('asia_shanghai_day', 'session')
      and context_recipe ->> 'selection' = 'newest_within_token_budget'
      and jsonb_typeof(context_recipe -> 'external_sources') = 'array'
    ),
  constraint conversation_profiles_version_check
    check (version > 0),
  constraint conversation_profiles_user_key_version_unique
    unique (user_id, profile_key, version)
);

create unique index conversation_profiles_user_key_active_unique
  on public.conversation_profiles (user_id, profile_key)
  where active;

create index conversation_profiles_user_lookup_idx
  on public.conversation_profiles (user_id, profile_key, active, version desc);

comment on table public.conversation_profiles is
  'Versioned direct/group window policy and context recipe catalog.';
comment on column public.conversation_profiles.session_policy is
  'singleton for the fixed companion window; multi for ordinary API/CLI chats and sofas.';
comment on column public.conversation_profiles.participant_port_keys is
  'Generation port keys available to this profile; session routing metadata is derived from this list.';
comment on column public.conversation_profiles.context_recipe is
  'Versioned declaration of allowed history scope, epoch, token selection, and external context sources.';

-- ── Sessions expand column ───────────────────────────────────────────────────

alter table public.sessions
  add column if not exists conversation_profile_key text;

alter table public.sessions
  add constraint sessions_conversation_profile_key_nonempty_check
    check (
      conversation_profile_key is null
      or btrim(conversation_profile_key) <> ''
    ) not valid;

alter table public.sessions
  validate constraint sessions_conversation_profile_key_nonempty_check;

create index sessions_user_profile_archived_updated_idx
  on public.sessions (
    user_id,
    conversation_profile_key,
    is_archived,
    updated_at desc
  );

comment on column public.sessions.conversation_profile_key is
  'Nullable expand reference resolved against the owner current active conversation profile.';

-- ── RLS and explicit Data API grants ─────────────────────────────────────────

alter table public.generation_ports enable row level security;
alter table public.conversation_profiles enable row level security;

create policy generation_ports_select_own
  on public.generation_ports
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy conversation_profiles_select_own
  on public.conversation_profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.generation_ports from anon, authenticated;
revoke all on public.conversation_profiles from anon, authenticated;
grant select on public.generation_ports to authenticated;
grant select on public.conversation_profiles to authenticated;
grant select, insert, update, delete
  on public.generation_ports, public.conversation_profiles
  to service_role;

-- ── Append-only version rows ─────────────────────────────────────────────────

create or replace function private.enforce_versioned_chat_config_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (
    to_jsonb(new) - 'active' - 'updated_at'
  ) is distinct from (
    to_jsonb(old) - 'active' - 'updated_at'
  ) then
    raise exception
      '% rows are append-only; publish a new version instead',
      tg_table_name;
  end if;

  if not old.active and new.active then
    raise exception
      '% inactive versions cannot be reactivated',
      tg_table_name;
  end if;

  new.updated_at := now();
  return new;
end
$function$;

revoke all on function private.enforce_versioned_chat_config_immutable()
  from public, anon, authenticated;
grant execute on function private.enforce_versioned_chat_config_immutable()
  to service_role;

create trigger generation_ports_immutable_version
before update on public.generation_ports
for each row execute function private.enforce_versioned_chat_config_immutable();

create trigger conversation_profiles_immutable_version
before update on public.conversation_profiles
for each row execute function private.enforce_versioned_chat_config_immutable();

-- ── Owner-bound port publishing ──────────────────────────────────────────────

create or replace function private.generation_port_publish_core(
  p_port_key text,
  p_runtime_kind text,
  p_model_channel_name text,
  p_target_role text,
  p_identity_prompt_name text,
  p_style_prompt_name text,
  p_sop_source text,
  p_sop_ref text,
  p_expected_active_version integer default null
)
returns public.generation_ports
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid := (select auth.uid());
  v_port_key text := btrim(p_port_key);
  v_runtime_kind text := lower(btrim(p_runtime_kind));
  v_model_channel_name text := nullif(btrim(p_model_channel_name), '');
  v_target_role text := nullif(btrim(p_target_role), '');
  v_identity_prompt_name text := btrim(p_identity_prompt_name);
  v_style_prompt_name text := nullif(btrim(p_style_prompt_name), '');
  v_sop_source text := nullif(lower(btrim(p_sop_source)), '');
  v_sop_ref text := nullif(btrim(p_sop_ref), '');
  v_active_version integer;
  v_next_version integer;
  v_result public.generation_ports%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required';
  end if;

  if v_port_key !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Invalid generation port key';
  end if;

  if v_runtime_kind not in ('api', 'cli') then
    raise exception 'Invalid generation runtime kind';
  end if;

  if v_identity_prompt_name = '' then
    raise exception 'Identity Prompt name is required';
  end if;

  if v_runtime_kind = 'api' then
    if v_model_channel_name is null or v_target_role is not null then
      raise exception 'API ports require a model channel and cannot target a CLI role';
    end if;
  elsif v_target_role is null then
    raise exception 'CLI ports require a target role';
  end if;

  if v_model_channel_name is not null and not exists (
    select 1
    from public.channel_config
    where user_id = v_owner_id
      and channel_name = v_model_channel_name
  ) then
    raise exception 'Unknown owner model channel: %', v_model_channel_name;
  end if;

  if (v_sop_source is null) <> (v_sop_ref is null) then
    raise exception 'SOP source and reference must be supplied together';
  end if;

  if v_sop_source is not null and v_sop_source <> 'git' then
    raise exception 'Only Git-backed SOP references are allowed';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'v4.1:generation-port:' || v_owner_id::text || ':' || v_port_key,
      0
    )
  );

  select version
  into v_active_version
  from public.generation_ports
  where user_id = v_owner_id
    and port_key = v_port_key
    and active
  for update;

  if p_expected_active_version is not null
     and p_expected_active_version is distinct from v_active_version then
    raise exception
      'Generation port active version changed (expected %, actual %)',
      p_expected_active_version,
      v_active_version;
  end if;

  select coalesce(max(version), 0) + 1
  into v_next_version
  from public.generation_ports
  where user_id = v_owner_id
    and port_key = v_port_key;

  update public.generation_ports
  set active = false
  where user_id = v_owner_id
    and port_key = v_port_key
    and active;

  insert into public.generation_ports (
    user_id,
    port_key,
    runtime_kind,
    model_channel_name,
    target_role,
    identity_prompt_name,
    style_prompt_name,
    sop_source,
    sop_ref,
    version,
    active
  )
  values (
    v_owner_id,
    v_port_key,
    v_runtime_kind,
    v_model_channel_name,
    v_target_role,
    v_identity_prompt_name,
    v_style_prompt_name,
    v_sop_source,
    v_sop_ref,
    v_next_version,
    true
  )
  returning * into v_result;

  return v_result;
end
$function$;

revoke all on function private.generation_port_publish_core(
  text, text, text, text, text, text, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function private.generation_port_publish_core(
  text, text, text, text, text, text, text, text, integer
) to authenticated;

create or replace function public.generation_port_publish(
  p_port_key text,
  p_runtime_kind text,
  p_model_channel_name text,
  p_target_role text,
  p_identity_prompt_name text,
  p_style_prompt_name text,
  p_sop_source text,
  p_sop_ref text,
  p_expected_active_version integer default null
)
returns public.generation_ports
language sql
security invoker
set search_path = ''
as $function$
  select private.generation_port_publish_core(
    p_port_key,
    p_runtime_kind,
    p_model_channel_name,
    p_target_role,
    p_identity_prompt_name,
    p_style_prompt_name,
    p_sop_source,
    p_sop_ref,
    p_expected_active_version
  )
$function$;

revoke all on function public.generation_port_publish(
  text, text, text, text, text, text, text, text, integer
) from public, anon, service_role;
grant execute on function public.generation_port_publish(
  text, text, text, text, text, text, text, text, integer
) to authenticated;

-- ── Owner-bound profile publishing ───────────────────────────────────────────

create or replace function private.conversation_profile_publish_core(
  p_profile_key text,
  p_conversation_kind text,
  p_handler text,
  p_session_policy text,
  p_singleton_session_key text,
  p_participant_port_keys text[],
  p_default_responder_port_key text,
  p_rules_prompt_name text,
  p_context_recipe jsonb,
  p_expected_active_version integer default null
)
returns public.conversation_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid := (select auth.uid());
  v_profile_key text := btrim(p_profile_key);
  v_conversation_kind text := lower(btrim(p_conversation_kind));
  v_handler text := lower(btrim(p_handler));
  v_session_policy text := lower(btrim(p_session_policy));
  v_singleton_session_key text := nullif(btrim(p_singleton_session_key), '');
  v_participant_port_keys text[];
  v_default_responder_port_key text := btrim(p_default_responder_port_key);
  v_rules_prompt_name text := nullif(btrim(p_rules_prompt_name), '');
  v_context_recipe jsonb := coalesce(p_context_recipe, '{}'::jsonb);
  v_participant_count integer;
  v_distinct_participant_count integer;
  v_active_port_count integer;
  v_default_runtime_kind text;
  v_active_version integer;
  v_next_version integer;
  v_result public.conversation_profiles%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required';
  end if;

  if v_profile_key !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Invalid conversation profile key';
  end if;

  if not (
    (v_conversation_kind = 'direct' and v_handler in ('api', 'cli'))
    or (v_conversation_kind = 'group' and v_handler = 'router')
  ) then
    raise exception 'Invalid conversation profile shape';
  end if;

  if v_session_policy not in ('singleton', 'multi') then
    raise exception 'Invalid session policy';
  end if;

  if (
    v_session_policy = 'singleton'
    and v_singleton_session_key is null
  ) or (
    v_session_policy = 'multi'
    and v_singleton_session_key is not null
  ) then
    raise exception 'Singleton session key does not match session policy';
  end if;

  if jsonb_typeof(v_context_recipe) <> 'object' then
    raise exception 'Context recipe must be a JSON object';
  end if;

  if jsonb_typeof(v_context_recipe -> 'version') <> 'number'
     or v_context_recipe ->> 'history_scope' <> 'current_session'
     or v_context_recipe ->> 'epoch' not in ('asia_shanghai_day', 'session')
     or v_context_recipe ->> 'selection' <> 'newest_within_token_budget'
     or jsonb_typeof(v_context_recipe -> 'external_sources') <> 'array' then
    raise exception 'Context recipe violates the V4.1 window isolation contract';
  end if;

  select array_agg(btrim(item) order by ordinal)
  into v_participant_port_keys
  from unnest(p_participant_port_keys) with ordinality as valueset(item, ordinal);

  if v_participant_port_keys is null
     or cardinality(v_participant_port_keys) = 0
     or array_position(v_participant_port_keys, '') is not null
     or array_position(v_participant_port_keys, null) is not null then
    raise exception 'Participant generation port keys must be non-empty';
  end if;

  select count(*), count(distinct item)
  into v_participant_count, v_distinct_participant_count
  from unnest(v_participant_port_keys) as valueset(item);

  if v_participant_count <> v_distinct_participant_count then
    raise exception 'Participant generation port keys must be unique';
  end if;

  if v_conversation_kind = 'direct' and v_participant_count <> 1 then
    raise exception 'Direct profiles must resolve to exactly one generation port';
  end if;

  if not (v_default_responder_port_key = any (v_participant_port_keys)) then
    raise exception 'Default responder must be one of the participant ports';
  end if;

  select count(*)
  into v_active_port_count
  from public.generation_ports
  where user_id = v_owner_id
    and active
    and port_key = any (v_participant_port_keys);

  if v_active_port_count <> cardinality(v_participant_port_keys) then
    raise exception 'Every participant must resolve to an active owner generation port';
  end if;

  select runtime_kind
  into v_default_runtime_kind
  from public.generation_ports
  where user_id = v_owner_id
    and port_key = v_default_responder_port_key
    and active;

  if (
    v_handler = 'api'
    and v_default_runtime_kind <> 'api'
  ) or (
    v_handler = 'cli'
    and v_default_runtime_kind <> 'cli'
  ) or (
    v_handler = 'router'
    and v_default_runtime_kind <> 'api'
  ) then
    raise exception 'Profile handler must match the default responder runtime contract';
  end if;

  if v_conversation_kind = 'group' and v_rules_prompt_name is null then
    raise exception 'Group profiles require a rules Prompt reference';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'v4.1:conversation-profile:' || v_owner_id::text || ':' || v_profile_key,
      0
    )
  );

  select version
  into v_active_version
  from public.conversation_profiles
  where user_id = v_owner_id
    and profile_key = v_profile_key
    and active
  for update;

  if p_expected_active_version is not null
     and p_expected_active_version is distinct from v_active_version then
    raise exception
      'Conversation profile active version changed (expected %, actual %)',
      p_expected_active_version,
      v_active_version;
  end if;

  select coalesce(max(version), 0) + 1
  into v_next_version
  from public.conversation_profiles
  where user_id = v_owner_id
    and profile_key = v_profile_key;

  update public.conversation_profiles
  set active = false
  where user_id = v_owner_id
    and profile_key = v_profile_key
    and active;

  insert into public.conversation_profiles (
    user_id,
    profile_key,
    conversation_kind,
    handler,
    session_policy,
    singleton_session_key,
    participant_port_keys,
    default_responder_port_key,
    rules_prompt_name,
    context_recipe,
    version,
    active
  )
  values (
    v_owner_id,
    v_profile_key,
    v_conversation_kind,
    v_handler,
    v_session_policy,
    v_singleton_session_key,
    v_participant_port_keys,
    v_default_responder_port_key,
    v_rules_prompt_name,
    v_context_recipe,
    v_next_version,
    true
  )
  returning * into v_result;

  return v_result;
end
$function$;

revoke all on function private.conversation_profile_publish_core(
  text, text, text, text, text, text[], text, text, jsonb, integer
) from public, anon, authenticated, service_role;
grant execute on function private.conversation_profile_publish_core(
  text, text, text, text, text, text[], text, text, jsonb, integer
) to authenticated;

create or replace function public.conversation_profile_publish(
  p_profile_key text,
  p_conversation_kind text,
  p_handler text,
  p_session_policy text,
  p_singleton_session_key text,
  p_participant_port_keys text[],
  p_default_responder_port_key text,
  p_rules_prompt_name text,
  p_context_recipe jsonb,
  p_expected_active_version integer default null
)
returns public.conversation_profiles
language sql
security invoker
set search_path = ''
as $function$
  select private.conversation_profile_publish_core(
    p_profile_key,
    p_conversation_kind,
    p_handler,
    p_session_policy,
    p_singleton_session_key,
    p_participant_port_keys,
    p_default_responder_port_key,
    p_rules_prompt_name,
    p_context_recipe,
    p_expected_active_version
  )
$function$;

revoke all on function public.conversation_profile_publish(
  text, text, text, text, text, text[], text, text, jsonb, integer
) from public, anon, service_role;
grant execute on function public.conversation_profile_publish(
  text, text, text, text, text, text[], text, text, jsonb, integer
) to authenticated;

-- ── Owner-bound idempotent multi-session creation ────────────────────────────

create or replace function private.conversation_session_create_core(
  p_session_id uuid,
  p_profile_key text,
  p_title text,
  p_display_config jsonb default '{}'::jsonb
)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid := (select auth.uid());
  v_profile_key text := btrim(p_profile_key);
  v_title text := coalesce(nullif(btrim(p_title), ''), '新聊天');
  v_display_config jsonb := coalesce(p_display_config, '{}'::jsonb);
  v_profile public.conversation_profiles%rowtype;
  v_routing_config jsonb;
  v_session public.sessions%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Authentication required';
  end if;

  if p_session_id is null then
    raise exception 'A stable client-generated session id is required';
  end if;

  if jsonb_typeof(v_display_config) <> 'object' then
    raise exception 'Display config must be a JSON object';
  end if;

  if (
    v_display_config
      - array['display_name', 'avatar', 'source_label']::text[]
  ) <> '{}'::jsonb then
    raise exception 'Display config contains unsupported routing keys';
  end if;

  if exists (
    select 1
    from jsonb_each(v_display_config) entry
    where jsonb_typeof(entry.value) <> 'string'
       or btrim(entry.value #>> '{}') = ''
  ) then
    raise exception 'Display config values must be non-empty strings';
  end if;

  select *
  into v_profile
  from public.conversation_profiles
  where user_id = v_owner_id
    and profile_key = v_profile_key
    and active;

  if not found then
    raise exception 'Active owner conversation profile not found';
  end if;

  if v_profile.session_policy = 'singleton' then
    select *
    into v_session
    from public.sessions
    where user_id = v_owner_id
      and session_key = v_profile.singleton_session_key;

    if not found then
      raise exception
        'Singleton session is not provisioned yet; run its dedicated migrate step';
    end if;

    if v_session.conversation_profile_key is distinct from v_profile.profile_key
       or v_session.conversation_kind is distinct from v_profile.conversation_kind
       or v_session.handler is distinct from v_profile.handler then
      raise exception 'Existing singleton session does not match its active profile';
    end if;

    return v_session;
  end if;

  v_routing_config := jsonb_build_object(
    'version',
    1,
    'participants',
    to_jsonb(
      array_prepend(
        'chuanchuan'::text,
        v_profile.participant_port_keys
      )
    ),
    'default_responder',
    v_profile.default_responder_port_key
  ) || v_display_config;

  select *
  into v_session
  from public.sessions
  where id = p_session_id;

  if found then
    if v_session.user_id is distinct from v_owner_id
       or v_session.conversation_profile_key is distinct from v_profile.profile_key
       or v_session.title is distinct from v_title
       or v_session.conversation_kind is distinct from v_profile.conversation_kind
       or v_session.handler is distinct from v_profile.handler
       or v_session.routing_config is distinct from v_routing_config then
      raise exception 'Session id was already used with a different creation payload';
    end if;

    return v_session;
  end if;

  insert into public.sessions (
    id,
    user_id,
    title,
    session_key,
    conversation_kind,
    handler,
    routing_config,
    conversation_profile_key,
    is_archived,
    archived_at
  )
  values (
    p_session_id,
    v_owner_id,
    v_title,
    null,
    v_profile.conversation_kind,
    v_profile.handler,
    v_routing_config,
    v_profile.profile_key,
    false,
    null
  )
  returning * into v_session;

  return v_session;
end
$function$;

revoke all on function private.conversation_session_create_core(
  uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.conversation_session_create_core(
  uuid, text, text, jsonb
) to authenticated;

create or replace function public.conversation_session_create(
  p_session_id uuid,
  p_profile_key text,
  p_title text,
  p_display_config jsonb default '{}'::jsonb
)
returns public.sessions
language sql
security invoker
set search_path = ''
as $function$
  select private.conversation_session_create_core(
    p_session_id,
    p_profile_key,
    p_title,
    p_display_config
  )
$function$;

revoke all on function public.conversation_session_create(
  uuid, text, text, jsonb
) from public, anon, service_role;
grant execute on function public.conversation_session_create(
  uuid, text, text, jsonb
) to authenticated;

-- ── Owner seed: channels, four ports, and six profiles ───────────────────────

do $migration$
declare
  v_owner_id uuid;
  v_owner_count bigint;
  v_default_model text;
  v_session_count bigint;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('v4.1:chat-config-expand', 0)
  );

  select count(*), min(owner_id::text)::uuid
  into v_owner_count, v_owner_id
  from (
    select distinct user_id as owner_id
    from public.sessions
    where user_id is not null
  ) owners;

  if v_owner_count <> 1 or v_owner_id is null then
    raise exception
      'Expected exactly one sessions owner before seeding chat config; found %',
      v_owner_count;
  end if;

  select active_model
  into v_default_model
  from public.channel_config
  where user_id = v_owner_id
    and channel_name = 'wechat';

  if v_default_model is null or btrim(v_default_model) = '' then
    raise exception 'Owner wechat channel is required as the expand model baseline';
  end if;

  insert into public.channel_config (
    user_id,
    channel_name,
    active_model
  )
  values
    (v_owner_id, 'app_companion', v_default_model),
    (v_owner_id, 'app_chat', v_default_model)
  on conflict (user_id, channel_name) do nothing;

  insert into public.generation_ports (
    user_id,
    port_key,
    runtime_kind,
    model_channel_name,
    target_role,
    identity_prompt_name,
    style_prompt_name,
    sop_source,
    sop_ref,
    version,
    active
  )
  values
    (
      v_owner_id,
      'app_companion',
      'api',
      'app_companion',
      null,
      'syzygy_base',
      'app_companion_reply_style',
      null,
      null,
      1,
      true
    ),
    (
      v_owner_id,
      'app_chat',
      'api',
      'app_chat',
      null,
      'syzygy_base',
      'app_chat_reply_style',
      null,
      null,
      1,
      true
    ),
    (
      v_owner_id,
      'codex_cli',
      'cli',
      null,
      'codex_cli_syzygy',
      'syzygy_base',
      'codex_cli_reply_style',
      null,
      null,
      1,
      true
    ),
    (
      v_owner_id,
      'claude_cli',
      'cli',
      null,
      'claude_code_cli_syzygy',
      'syzygy_base',
      'claude_cli_reply_style',
      null,
      null,
      1,
      true
    );

  insert into public.conversation_profiles (
    user_id,
    profile_key,
    conversation_kind,
    handler,
    session_policy,
    singleton_session_key,
    participant_port_keys,
    default_responder_port_key,
    rules_prompt_name,
    context_recipe,
    version,
    active
  )
  values
    (
      v_owner_id,
      'app_companion',
      'direct',
      'api',
      'singleton',
      'syzygy_companion',
      array['app_companion'],
      'app_companion',
      null,
      '{
        "version": 1,
        "history_scope": "current_session",
        "epoch": "asia_shanghai_day",
        "selection": "newest_within_token_budget",
        "external_sources": []
      }'::jsonb,
      1,
      true
    ),
    (
      v_owner_id,
      'app_chat',
      'direct',
      'api',
      'multi',
      null,
      array['app_chat'],
      'app_chat',
      null,
      '{
        "version": 1,
        "history_scope": "current_session",
        "epoch": "session",
        "selection": "newest_within_token_budget",
        "external_sources": []
      }'::jsonb,
      1,
      true
    ),
    (
      v_owner_id,
      'codex_cli',
      'direct',
      'cli',
      'multi',
      null,
      array['codex_cli'],
      'codex_cli',
      null,
      '{
        "version": 1,
        "history_scope": "current_session",
        "epoch": "session",
        "selection": "newest_within_token_budget",
        "external_sources": []
      }'::jsonb,
      1,
      true
    ),
    (
      v_owner_id,
      'claude_cli',
      'direct',
      'cli',
      'multi',
      null,
      array['claude_cli'],
      'claude_cli',
      null,
      '{
        "version": 1,
        "history_scope": "current_session",
        "epoch": "session",
        "selection": "newest_within_token_budget",
        "external_sources": []
      }'::jsonb,
      1,
      true
    ),
    (
      v_owner_id,
      'sofa_daily',
      'group',
      'router',
      'multi',
      null,
      array['app_chat', 'codex_cli', 'claude_cli'],
      'app_chat',
      'sofa_daily_rules',
      '{
        "version": 1,
        "history_scope": "current_session",
        "epoch": "session",
        "selection": "newest_within_token_budget",
        "external_sources": []
      }'::jsonb,
      1,
      true
    ),
    (
      v_owner_id,
      'sofa_work',
      'group',
      'router',
      'multi',
      null,
      array['app_chat', 'codex_cli', 'claude_cli'],
      'app_chat',
      'sofa_work_rules',
      '{
        "version": 1,
        "history_scope": "current_session",
        "epoch": "session",
        "selection": "newest_within_token_budget",
        "external_sources": []
      }'::jsonb,
      1,
      true
    );

  if (
    select count(*)
    from public.generation_ports
    where user_id = v_owner_id
      and active
  ) <> 4 then
    raise exception 'Chat generation port seed did not converge to four active ports';
  end if;

  if (
    select count(*)
    from public.conversation_profiles
    where user_id = v_owner_id
      and active
  ) <> 6 then
    raise exception 'Conversation profile seed did not converge to six active profiles';
  end if;

  select count(*)
  into v_session_count
  from public.sessions
  where user_id = v_owner_id
    and conversation_profile_key is not null;

  if v_session_count <> 0 then
    raise exception
      'Expand migration must not backfill existing sessions; found % profile rows',
      v_session_count;
  end if;
end
$migration$;
