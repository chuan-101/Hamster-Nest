-- V4.1 W3 / dual-CLI Phase 2A: converge Codex and Claude on one durable
-- canonical conversation window each.
--
-- This migration is intentionally data-only:
-- - the legacy Codex sessions.id and every existing messages.id stay stable;
-- - the two CLI profiles are published as new append-only singleton versions;
-- - Claude receives one idempotently provisioned empty canonical session;
-- - no grants, RLS policies, functions, columns, or tables are changed.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $migration$
declare
  v_owner_id uuid;
  v_owner_count bigint;
  v_profile public.conversation_profiles%rowtype;
  v_port_count bigint;
  v_legacy_codex_id uuid;
  v_canonical_codex_id uuid;
  v_codex_id uuid;
  v_claude_id uuid;
  v_existing_routing jsonb;
  v_message_count_before bigint;
  v_message_count_after bigint;
  v_message_ids_before text;
  v_message_ids_after text;
  v_daily_recipe jsonb := '{
    "version": 1,
    "history_scope": "current_session",
    "epoch": "asia_shanghai_day",
    "selection": "newest_within_token_budget",
    "external_sources": []
  }'::jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('v4.1:cli-singleton-sessions-migrate', 0)
  );

  select count(*), min(owner_id::text)::uuid
  into v_owner_count, v_owner_id
  from (
    select distinct user_id as owner_id
    from public.conversation_profiles
    where profile_key in ('codex_cli', 'claude_cli')
  ) owners;

  if v_owner_count <> 1 or v_owner_id is null then
    raise exception
      'CLI singleton migration expected exactly one profile owner; found %',
      v_owner_count;
  end if;

  select count(*)
  into v_port_count
  from public.generation_ports
  where user_id = v_owner_id
    and active
    and (
      (
        port_key = 'codex_cli'
        and runtime_kind = 'cli'
        and target_role = 'codex_cli_syzygy'
      )
      or (
        port_key = 'claude_cli'
        and runtime_kind = 'cli'
        and target_role = 'claude_code_cli_syzygy'
      )
    );

  if v_port_count <> 2 then
    raise exception
      'CLI singleton migration requires both active CLI generation ports; found %',
      v_port_count;
  end if;

  for v_profile in
    select *
    from public.conversation_profiles
    where user_id = v_owner_id
      and profile_key in ('codex_cli', 'claude_cli')
      and active
    order by profile_key
  loop
    if v_profile.id is null
       or v_profile.conversation_kind <> 'direct'
       or v_profile.handler <> 'cli'
       or v_profile.participant_port_keys <> array[v_profile.profile_key]::text[]
       or v_profile.default_responder_port_key <> v_profile.profile_key
       or v_profile.rules_prompt_name is not null
       or v_profile.context_recipe ->> 'history_scope' <> 'current_session'
       or v_profile.context_recipe ->> 'selection' <> 'newest_within_token_budget'
       or v_profile.context_recipe -> 'external_sources' <> '[]'::jsonb
       or not (
         (
           v_profile.session_policy = 'multi'
           and v_profile.singleton_session_key is null
           and v_profile.context_recipe ->> 'epoch' = 'session'
         )
         or (
           v_profile.session_policy = 'singleton'
           and v_profile.singleton_session_key = (case v_profile.profile_key
             when 'codex_cli' then 'syzygy_codex_cli'
             else 'syzygy_claude_cli'
           end)
           and v_profile.context_recipe = v_daily_recipe
         )
       ) then
      raise exception
        'CLI singleton migration found an unsupported active % profile contract',
        coalesce(v_profile.profile_key, '(missing)');
    end if;
  end loop;

  select id
  into v_legacy_codex_id
  from public.sessions
  where user_id = v_owner_id
    and session_key = 'syzygy_cli';

  select id
  into v_canonical_codex_id
  from public.sessions
  where user_id = v_owner_id
    and session_key = 'syzygy_codex_cli';

  if v_legacy_codex_id is not null
     and v_canonical_codex_id is not null
     and v_legacy_codex_id <> v_canonical_codex_id then
    raise exception
      'CLI singleton migration refuses to merge two Codex session ids (% and %)',
      v_legacy_codex_id,
      v_canonical_codex_id;
  end if;

  v_codex_id := coalesce(v_canonical_codex_id, v_legacy_codex_id);
  if v_codex_id is null then
    raise exception
      'CLI singleton migration requires syzygy_cli or the already-migrated syzygy_codex_cli session';
  end if;

  if exists (
    select 1
    from public.sessions
    where user_id = v_owner_id
      and conversation_profile_key in ('codex_cli', 'claude_cli')
      and id <> v_codex_id
      and session_key is distinct from 'syzygy_claude_cli'
      and not is_archived
  ) then
    raise exception
      'CLI singleton migration refuses unexpected active CLI profile sessions';
  end if;

  select count(*), md5(coalesce(string_agg(id::text, ',' order by id), ''))
  into v_message_count_before, v_message_ids_before
  from public.messages
  where session_id = v_codex_id;

  for v_profile in
    select *
    from public.conversation_profiles
    where user_id = v_owner_id
      and profile_key in ('codex_cli', 'claude_cli')
      and active
    order by profile_key
    for update
  loop
    if v_profile.session_policy = 'singleton'
       and v_profile.singleton_session_key = (case v_profile.profile_key
         when 'codex_cli' then 'syzygy_codex_cli'
         else 'syzygy_claude_cli'
       end)
       and v_profile.context_recipe = v_daily_recipe then
      continue;
    end if;

    update public.conversation_profiles
    set active = false
    where id = v_profile.id
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
      v_profile.profile_key,
      'direct',
      'cli',
      'singleton',
      case v_profile.profile_key
        when 'codex_cli' then 'syzygy_codex_cli'
        else 'syzygy_claude_cli'
      end,
      array[v_profile.profile_key]::text[],
      v_profile.profile_key,
      null,
      v_daily_recipe,
      (
        select coalesce(max(version), 0) + 1
        from public.conversation_profiles
        where user_id = v_owner_id
          and profile_key = v_profile.profile_key
      ),
      true
    );
  end loop;

  select routing_config
  into v_existing_routing
  from public.sessions
  where id = v_codex_id
    and user_id = v_owner_id
    and conversation_kind = 'direct'
    and handler = 'cli'
  for update;

  if not found then
    raise exception 'CLI singleton Codex target must remain an owner direct CLI session';
  end if;

  update public.sessions
  set
    title = case
      when btrim(title) in ('', '新会话', 'Syzygy·本体') then 'Syzygy·Codex'
      else title
    end,
    session_key = 'syzygy_codex_cli',
    conversation_profile_key = 'codex_cli',
    conversation_kind = 'direct',
    handler = 'cli',
    routing_config = coalesce(v_existing_routing, '{}'::jsonb) || jsonb_build_object(
      'version', 2,
      'migration_tag', 'v4_1_cli_singleton',
      'display_name', case
        when nullif(btrim(v_existing_routing ->> 'display_name'), '') is null
          or v_existing_routing ->> 'display_name' = 'Syzygy·本体'
          then 'Syzygy·Codex'
        else v_existing_routing ->> 'display_name'
      end,
      'avatar', coalesce(nullif(btrim(v_existing_routing ->> 'avatar'), ''), '🐹'),
      'source_label', case
        when nullif(btrim(v_existing_routing ->> 'source_label'), '') is null
          or v_existing_routing ->> 'source_label' = 'Mac mini · 本体'
          then 'Mac mini · Codex'
        else v_existing_routing ->> 'source_label'
      end,
      'participants', jsonb_build_array('chuanchuan', 'codex_cli'),
      'default_responder', 'codex_cli',
      'target_role', 'codex_cli_syzygy'
    ),
    is_archived = false,
    archived_at = null
  where id = v_codex_id
    and user_id = v_owner_id;

  insert into public.sessions (
    user_id,
    title,
    session_key,
    conversation_profile_key,
    conversation_kind,
    handler,
    routing_config,
    is_archived,
    archived_at
  )
  values (
    v_owner_id,
    'Syzygy·Claude',
    'syzygy_claude_cli',
    'claude_cli',
    'direct',
    'cli',
    jsonb_build_object(
      'version', 2,
      'migration_tag', 'v4_1_cli_singleton',
      'display_name', 'Syzygy·Claude',
      'avatar', '🐹',
      'source_label', 'Mac mini · Claude',
      'participants', jsonb_build_array('chuanchuan', 'claude_cli'),
      'default_responder', 'claude_cli',
      'target_role', 'claude_code_cli_syzygy'
    ),
    false,
    null
  )
  on conflict (user_id, session_key) where session_key is not null
  do nothing;

  select id
  into v_claude_id
  from public.sessions
  where user_id = v_owner_id
    and session_key = 'syzygy_claude_cli'
    and conversation_profile_key = 'claude_cli'
    and conversation_kind = 'direct'
    and handler = 'cli'
    and not is_archived
    and routing_config ->> 'migration_tag' = 'v4_1_cli_singleton'
    and routing_config ->> 'default_responder' = 'claude_cli'
    and routing_config ->> 'target_role' = 'claude_code_cli_syzygy';

  if v_claude_id is null then
    raise exception 'CLI singleton migration did not converge the Claude session';
  end if;

  select count(*), md5(coalesce(string_agg(id::text, ',' order by id), ''))
  into v_message_count_after, v_message_ids_after
  from public.messages
  where session_id = v_codex_id;

  if v_message_count_after <> v_message_count_before
     or v_message_ids_after is distinct from v_message_ids_before then
    raise exception
      'CLI singleton migration must preserve every Codex canonical message id';
  end if;

  if (
    select count(*)
    from public.conversation_profiles
    where user_id = v_owner_id
      and active
      and (
        (
          profile_key = 'codex_cli'
          and session_policy = 'singleton'
          and singleton_session_key = 'syzygy_codex_cli'
          and default_responder_port_key = 'codex_cli'
          and context_recipe = v_daily_recipe
        )
        or (
          profile_key = 'claude_cli'
          and session_policy = 'singleton'
          and singleton_session_key = 'syzygy_claude_cli'
          and default_responder_port_key = 'claude_cli'
          and context_recipe = v_daily_recipe
        )
      )
  ) <> 2 then
    raise exception 'CLI singleton migration did not converge both active profiles';
  end if;

  if exists (
    select 1
    from public.sessions
    where user_id = v_owner_id
      and session_key = 'syzygy_cli'
  ) then
    raise exception 'Legacy syzygy_cli key remained after CLI singleton migration';
  end if;
end;
$migration$;
