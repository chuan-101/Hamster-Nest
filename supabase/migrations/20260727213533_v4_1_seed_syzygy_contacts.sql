-- V4.1 W1 / 3.2: seed the two owner-bound direct contacts.
--
-- API and CLI direct conversations intentionally use different session rows.
-- A future shared API + CLI context must be a separate group/router session.

do $migration$
declare
  v_owner_id uuid;
  v_owner_count bigint;
  v_instant_id uuid;
  v_candidate_count bigint;
  v_instant_defaults jsonb := jsonb_build_object(
    'display_name', 'Syzygy·即时',
    'avatar', '✨',
    'source_label', '云端 · 即时'
  );
  v_instant_required jsonb := jsonb_build_object(
    'version', 1,
    'participants', jsonb_build_array('chuanchuan', 'syzygy_instant'),
    'default_responder', 'syzygy_instant'
  );
  v_cli_defaults jsonb := jsonb_build_object(
    'display_name', 'Syzygy·本体',
    'avatar', '🐹',
    'source_label', 'Mac mini · 本体'
  );
  v_cli_required jsonb := jsonb_build_object(
    'version', 1,
    'participants',
    jsonb_build_array('chuanchuan', 'syzygy_cli', 'syzygy_proactive'),
    'default_responder', 'syzygy_cli'
  );
begin
  perform pg_advisory_xact_lock(
    hashtextextended('v4.1:seed-syzygy-contacts', 0)
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
      'Expected exactly one sessions owner before seeding contacts; found %',
      v_owner_count;
  end if;

  select id
  into v_instant_id
  from public.sessions
  where user_id = v_owner_id
    and session_key = 'syzygy_instant'
  for update;

  if v_instant_id is null then
    select count(*), min(id::text)::uuid
    into v_candidate_count, v_instant_id
    from public.sessions
    where user_id = v_owner_id
      and not is_archived
      and session_key is null
      and conversation_kind = 'direct'
      and handler = 'api'
      and routing_config @> jsonb_build_object(
        'participants',
        jsonb_build_array('chuanchuan', 'syzygy_instant'),
        'default_responder',
        'syzygy_instant'
      );

    if v_candidate_count <> 1 or v_instant_id is null then
      raise exception
        'Expected exactly one active API promotion candidate; found %',
        v_candidate_count;
    end if;

    perform 1
    from public.sessions
    where id = v_instant_id
    for update;

    update public.sessions
    set
      title = 'Syzygy·即时',
      session_key = 'syzygy_instant',
      conversation_kind = 'direct',
      handler = 'api',
      routing_config = v_instant_defaults || routing_config || v_instant_required,
      is_archived = false,
      archived_at = null
    where id = v_instant_id;
  else
    update public.sessions
    set
      title = case
        when btrim(title) = '' or title = '新会话' then 'Syzygy·即时'
        else title
      end,
      conversation_kind = 'direct',
      handler = 'api',
      routing_config = v_instant_defaults || routing_config || v_instant_required,
      is_archived = false,
      archived_at = null
    where id = v_instant_id
      and (
        title,
        conversation_kind,
        handler,
        routing_config,
        is_archived,
        archived_at
      ) is distinct from (
        case
          when btrim(title) = '' or title = '新会话' then 'Syzygy·即时'
          else title
        end,
        'direct',
        'api',
        v_instant_defaults || routing_config || v_instant_required,
        false,
        null::timestamptz
      );
  end if;

  insert into public.sessions as target (
    user_id,
    title,
    session_key,
    conversation_kind,
    handler,
    routing_config,
    is_archived,
    archived_at
  )
  values (
    v_owner_id,
    'Syzygy·本体',
    'syzygy_cli',
    'direct',
    'cli',
    v_cli_defaults || v_cli_required,
    false,
    null
  )
  on conflict (user_id, session_key)
    where session_key is not null
  do update
  set
    title = case
      when btrim(target.title) = '' or target.title = '新会话' then 'Syzygy·本体'
      else target.title
    end,
    conversation_kind = 'direct',
    handler = 'cli',
    routing_config = v_cli_defaults || target.routing_config || v_cli_required,
    is_archived = false,
    archived_at = null
  where (
    target.title,
    target.conversation_kind,
    target.handler,
    target.routing_config,
    target.is_archived,
    target.archived_at
  ) is distinct from (
    case
      when btrim(target.title) = '' or target.title = '新会话'
        then 'Syzygy·本体'
      else target.title
    end,
    'direct',
    'cli',
    v_cli_defaults || target.routing_config || v_cli_required,
    false,
    null::timestamptz
  );

  if (
    select count(*)
    from public.sessions
    where user_id = v_owner_id
      and (
        (
          session_key = 'syzygy_instant'
          and conversation_kind = 'direct'
          and handler = 'api'
        )
        or (
          session_key = 'syzygy_cli'
          and conversation_kind = 'direct'
          and handler = 'cli'
        )
      )
  ) <> 2 then
    raise exception 'Syzygy contact seed did not converge to two direct sessions';
  end if;
end
$migration$;
