-- Manual rollback contract for 20260801123513_v4_1_companion_session_migrate.
--
-- This rollback restores the legacy address and display metadata on the same
-- sessions.id. It never deletes or rewrites canonical messages, including any
-- messages created after the forward migration.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $rollback$
declare
  v_owner_id uuid;
  v_owner_count bigint;
  v_session_id uuid;
  v_existing_routing jsonb;
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
      'Companion rollback expected exactly one sessions owner; found %',
      v_owner_count;
  end if;

  if exists (
    select 1
    from public.sessions
    where user_id = v_owner_id
      and session_key = 'syzygy_instant'
  ) then
    raise exception 'Companion rollback refuses to overwrite an existing syzygy_instant key';
  end if;

  select id, routing_config
  into v_session_id, v_existing_routing
  from public.sessions
  where user_id = v_owner_id
    and session_key = 'syzygy_companion'
    and conversation_profile_key = 'app_companion'
    and conversation_kind = 'direct'
    and handler = 'api'
  for update;

  if v_session_id is null then
    raise exception 'Companion rollback requires exactly the migrated companion session';
  end if;

  update public.sessions
  set
    title = case
      when btrim(title) in ('', '新会话', 'Syzygy·陪伴') then 'Syzygy·即时'
      else title
    end,
    session_key = 'syzygy_instant',
    conversation_profile_key = null,
    routing_config = coalesce(v_existing_routing, '{}'::jsonb) || jsonb_build_object(
      'version', 1,
      'display_name', case
        when nullif(btrim(v_existing_routing ->> 'display_name'), '') is null
          or v_existing_routing ->> 'display_name' = 'Syzygy·陪伴'
          then 'Syzygy·即时'
        else v_existing_routing ->> 'display_name'
      end,
      'avatar', coalesce(
        nullif(btrim(v_existing_routing ->> 'avatar'), ''),
        '✨'
      ),
      'source_label', case
        when nullif(btrim(v_existing_routing ->> 'source_label'), '') is null
          or v_existing_routing ->> 'source_label' = '云端 · 陪伴'
          then '云端 · 即时'
        else v_existing_routing ->> 'source_label'
      end,
      'participants', jsonb_build_array('chuanchuan', 'syzygy_instant'),
      'default_responder', 'syzygy_instant'
    )
  where id = v_session_id
    and user_id = v_owner_id;

  if not found then
    raise exception 'Companion rollback did not update the target session';
  end if;
end
$rollback$;
