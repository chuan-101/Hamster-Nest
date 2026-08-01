-- V4.1 W1 / 3.2: migrate the fixed API companion in place.
--
-- This is deliberately data-only:
-- - the sessions.id remains stable;
-- - canonical messages are never moved or rewritten;
-- - no grants, RLS policies, functions, or schema objects are changed.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $migration$
declare
  v_owner_id uuid;
  v_owner_count bigint;
  v_legacy_session_id uuid;
  v_companion_session_id uuid;
  v_session_id uuid;
  v_profile_count bigint;
  v_message_count_before bigint;
  v_message_count_after bigint;
  v_message_ids_before text;
  v_message_ids_after text;
  v_existing_routing jsonb;
  v_display_name text;
  v_source_label text;
  v_avatar text;
  v_required_routing jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('v4.1:companion-session-migrate', 0)
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
      'Expected exactly one sessions owner before companion migration; found %',
      v_owner_count;
  end if;

  select count(*)
  into v_profile_count
  from public.conversation_profiles
  where user_id = v_owner_id
    and profile_key = 'app_companion'
    and active
    and conversation_kind = 'direct'
    and handler = 'api'
    and session_policy = 'singleton'
    and singleton_session_key = 'syzygy_companion'
    and participant_port_keys = array['app_companion']::text[]
    and default_responder_port_key = 'app_companion'
    and context_recipe @> '{
      "version": 1,
      "history_scope": "current_session",
      "epoch": "asia_shanghai_day",
      "selection": "newest_within_token_budget",
      "external_sources": []
    }'::jsonb;

  if v_profile_count <> 1 then
    raise exception
      'Companion migration requires exactly one active app_companion singleton profile; found %',
      v_profile_count;
  end if;

  select id
  into v_legacy_session_id
  from public.sessions
  where user_id = v_owner_id
    and session_key = 'syzygy_instant';

  select id
  into v_companion_session_id
  from public.sessions
  where user_id = v_owner_id
    and session_key = 'syzygy_companion';

  if v_legacy_session_id is not null
     and v_companion_session_id is not null
     and v_legacy_session_id <> v_companion_session_id then
    raise exception
      'Companion migration refuses to merge two different session ids (% and %)',
      v_legacy_session_id,
      v_companion_session_id;
  end if;

  v_session_id := coalesce(v_companion_session_id, v_legacy_session_id);
  if v_session_id is null then
    raise exception
      'Companion migration requires syzygy_instant or the already-migrated syzygy_companion session';
  end if;

  select routing_config
  into v_existing_routing
  from public.sessions
  where id = v_session_id
    and user_id = v_owner_id
    and conversation_kind = 'direct'
    and handler = 'api'
  for update;

  if not found then
    raise exception
      'Companion migration target must remain an owner direct API session';
  end if;

  v_existing_routing := coalesce(v_existing_routing, '{}'::jsonb);
  v_display_name := case
    when nullif(btrim(v_existing_routing ->> 'display_name'), '') is null
      or v_existing_routing ->> 'display_name' = 'Syzygy·即时'
      then 'Syzygy·陪伴'
    else v_existing_routing ->> 'display_name'
  end;
  v_source_label := case
    when nullif(btrim(v_existing_routing ->> 'source_label'), '') is null
      or v_existing_routing ->> 'source_label' = '云端 · 即时'
      then '云端 · 陪伴'
    else v_existing_routing ->> 'source_label'
  end;
  v_avatar := coalesce(
    nullif(btrim(v_existing_routing ->> 'avatar'), ''),
    '✨'
  );
  v_required_routing := jsonb_build_object(
    'version', 2,
    'display_name', v_display_name,
    'avatar', v_avatar,
    'source_label', v_source_label,
    'participants', jsonb_build_array(
      'chuanchuan',
      'app_companion',
      'syzygy_proactive'
    ),
    'default_responder', 'app_companion'
  );

  select
    count(*),
    md5(coalesce(string_agg(id::text, ',' order by id), ''))
  into v_message_count_before, v_message_ids_before
  from public.messages
  where session_id = v_session_id;

  update public.sessions
  set
    title = case
      when btrim(title) in ('', '新会话', 'Syzygy·即时') then 'Syzygy·陪伴'
      else title
    end,
    session_key = 'syzygy_companion',
    conversation_profile_key = 'app_companion',
    conversation_kind = 'direct',
    handler = 'api',
    routing_config = v_existing_routing || v_required_routing,
    is_archived = false,
    archived_at = null
  where id = v_session_id
    and user_id = v_owner_id
    and (
      title,
      session_key,
      conversation_profile_key,
      conversation_kind,
      handler,
      routing_config,
      is_archived,
      archived_at
    ) is distinct from (
      case
        when btrim(title) in ('', '新会话', 'Syzygy·即时') then 'Syzygy·陪伴'
        else title
      end,
      'syzygy_companion',
      'app_companion',
      'direct',
      'api',
      v_existing_routing || v_required_routing,
      false,
      null::timestamptz
    );

  select
    count(*),
    md5(coalesce(string_agg(id::text, ',' order by id), ''))
  into v_message_count_after, v_message_ids_after
  from public.messages
  where session_id = v_session_id;

  if v_message_count_after <> v_message_count_before
     or v_message_ids_after is distinct from v_message_ids_before then
    raise exception
      'Companion migration must preserve every canonical message id';
  end if;

  if (
    select count(*)
    from public.sessions
    where user_id = v_owner_id
      and id = v_session_id
      and session_key = 'syzygy_companion'
      and conversation_profile_key = 'app_companion'
      and conversation_kind = 'direct'
      and handler = 'api'
      and not is_archived
      and routing_config ->> 'default_responder' = 'app_companion'
      and routing_config -> 'participants' = '[
        "chuanchuan",
        "app_companion",
        "syzygy_proactive"
      ]'::jsonb
  ) <> 1 then
    raise exception 'Companion migration did not converge to the fixed window contract';
  end if;

  if exists (
    select 1
    from public.sessions
    where user_id = v_owner_id
      and session_key = 'syzygy_instant'
  ) then
    raise exception 'Legacy syzygy_instant key remained after companion migration';
  end if;
end
$migration$;
