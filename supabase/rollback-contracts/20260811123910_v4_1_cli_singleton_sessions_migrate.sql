-- Manual rollback contract for 20260811123910_v4_1_cli_singleton_sessions_migrate.
--
-- Codex returns to the same legacy sessions.id. Canonical messages are never
-- rewritten or deleted. The migration-created Claude session is deleted only
-- while it is still empty; once it has messages it is preserved and archived.
-- Append-only profile versions are not reactivated: rollback publishes a new
-- multi/session version for each CLI profile.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $rollback$
declare
  v_owner_id uuid;
  v_owner_count bigint;
  v_profile public.conversation_profiles%rowtype;
  v_codex_id uuid;
  v_claude_id uuid;
  v_existing_routing jsonb;
  v_message_count_before bigint;
  v_message_count_after bigint;
  v_message_ids_before text;
  v_message_ids_after text;
  v_session_recipe jsonb := '{
    "version": 1,
    "history_scope": "current_session",
    "epoch": "session",
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
      'CLI singleton rollback expected exactly one profile owner; found %',
      v_owner_count;
  end if;

  if exists (
    select 1
    from public.sessions
    where user_id = v_owner_id
      and session_key = 'syzygy_cli'
  ) then
    raise exception 'CLI singleton rollback refuses to overwrite an existing syzygy_cli key';
  end if;

  select id, routing_config
  into v_codex_id, v_existing_routing
  from public.sessions
  where user_id = v_owner_id
    and session_key = 'syzygy_codex_cli'
    and conversation_profile_key = 'codex_cli'
    and conversation_kind = 'direct'
    and handler = 'cli'
    and routing_config ->> 'migration_tag' = 'v4_1_cli_singleton'
  for update;

  if v_codex_id is null then
    raise exception 'CLI singleton rollback requires the migrated Codex session';
  end if;

  select count(*), md5(coalesce(string_agg(id::text, ',' order by id), ''))
  into v_message_count_before, v_message_ids_before
  from public.messages
  where session_id = v_codex_id;

  update public.sessions
  set
    title = case
      when btrim(title) in ('', '新会话', 'Syzygy·Codex') then 'Syzygy·本体'
      else title
    end,
    session_key = 'syzygy_cli',
    conversation_profile_key = null,
    routing_config = (coalesce(v_existing_routing, '{}'::jsonb) - 'migration_tag') || jsonb_build_object(
      'version', 1,
      'display_name', case
        when nullif(btrim(v_existing_routing ->> 'display_name'), '') is null
          or v_existing_routing ->> 'display_name' = 'Syzygy·Codex'
          then 'Syzygy·本体'
        else v_existing_routing ->> 'display_name'
      end,
      'avatar', coalesce(nullif(btrim(v_existing_routing ->> 'avatar'), ''), '🐹'),
      'source_label', case
        when nullif(btrim(v_existing_routing ->> 'source_label'), '') is null
          or v_existing_routing ->> 'source_label' = 'Mac mini · Codex'
          then 'Mac mini · 本体'
        else v_existing_routing ->> 'source_label'
      end,
      'participants', jsonb_build_array('chuanchuan', 'syzygy_cli', 'syzygy_proactive'),
      'default_responder', 'syzygy_cli',
      'target_role', 'codex_cli_syzygy'
    ),
    is_archived = false,
    archived_at = null
  where id = v_codex_id
    and user_id = v_owner_id;

  select id
  into v_claude_id
  from public.sessions
  where user_id = v_owner_id
    and session_key = 'syzygy_claude_cli'
    and conversation_profile_key = 'claude_cli'
    and routing_config ->> 'migration_tag' = 'v4_1_cli_singleton'
  for update;

  if v_claude_id is not null then
    if exists (
      select 1 from public.messages where session_id = v_claude_id
    ) then
      update public.sessions
      set
        is_archived = true,
        archived_at = now()
      where id = v_claude_id
        and user_id = v_owner_id;
    else
      delete from public.sessions
      where id = v_claude_id
        and user_id = v_owner_id;
    end if;
  end if;

  for v_profile in
    select *
    from public.conversation_profiles
    where user_id = v_owner_id
      and profile_key in ('codex_cli', 'claude_cli')
      and active
    order by profile_key
    for update
  loop
    if v_profile.session_policy <> 'singleton'
       or v_profile.singleton_session_key <> (case v_profile.profile_key
         when 'codex_cli' then 'syzygy_codex_cli'
         else 'syzygy_claude_cli'
       end) then
      raise exception
        'CLI singleton rollback found an unsupported active % profile',
        v_profile.profile_key;
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
      'multi',
      null,
      array[v_profile.profile_key]::text[],
      v_profile.profile_key,
      null,
      v_session_recipe,
      (
        select coalesce(max(version), 0) + 1
        from public.conversation_profiles
        where user_id = v_owner_id
          and profile_key = v_profile.profile_key
      ),
      true
    );
  end loop;

  select count(*), md5(coalesce(string_agg(id::text, ',' order by id), ''))
  into v_message_count_after, v_message_ids_after
  from public.messages
  where session_id = v_codex_id;

  if v_message_count_after <> v_message_count_before
     or v_message_ids_after is distinct from v_message_ids_before then
    raise exception 'CLI singleton rollback must preserve every Codex canonical message id';
  end if;
end;
$rollback$;
