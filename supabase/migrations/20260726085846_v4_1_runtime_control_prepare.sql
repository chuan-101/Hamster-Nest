-- Version aligned with the production migration history recorded by Supabase.
create or replace function public.runtime_control_prepare(
  p_action text,
  p_target_role text,
  p_client_id uuid,
  p_confirm_running_tasks boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_target_role text := lower(btrim(coalesce(p_target_role, '')));
  v_idempotency_key text;
  v_payload jsonb;
  v_command public.syzygy_commands%rowtype;
  v_was_duplicate boolean := false;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  if v_action not in ('wake', 'sleep') then
    raise exception using
      errcode = '22023',
      message = 'action must be wake or sleep';
  end if;

  if v_target_role not in (
    'codex_cli_syzygy',
    'claude_code_cli_syzygy'
  ) then
    raise exception using
      errcode = '22023',
      message = 'target_role is not allowed';
  end if;

  if p_client_id is null then
    raise exception using
      errcode = '22023',
      message = 'client_id is required';
  end if;

  if v_action = 'wake' and coalesce(p_confirm_running_tasks, false) then
    raise exception using
      errcode = '22023',
      message = 'confirm_running_tasks is only valid for sleep';
  end if;

  v_idempotency_key := 'runtime-control:v1:' || p_client_id::text;
  v_payload := jsonb_build_object(
    'schema_version', 1,
    'source', 'runtime_control',
    'action', v_action,
    'target_role', v_target_role,
    'client_id', p_client_id::text,
    'idempotency_key', v_idempotency_key,
    'confirm_running_tasks', coalesce(p_confirm_running_tasks, false)
  );

  insert into public.syzygy_commands (
    user_id,
    command_type,
    status,
    payload,
    idempotency_key
  )
  values (
    v_user_id,
    v_action,
    'pending',
    v_payload,
    v_idempotency_key
  )
  on conflict (user_id, idempotency_key)
  do nothing
  returning *
  into v_command;

  if v_command.id is null then
    v_was_duplicate := true;

    select *
    into v_command
    from public.syzygy_commands
    where user_id = v_user_id
      and idempotency_key = v_idempotency_key;
  end if;

  if v_command.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'runtime control command was not found';
  end if;

  if v_command.command_type is distinct from v_action
    or v_command.payload -> 'schema_version' is distinct from '1'::jsonb
    or v_command.payload ->> 'source' is distinct from 'runtime_control'
    or v_command.payload ->> 'action' is distinct from v_action
    or v_command.payload ->> 'target_role' is distinct from v_target_role
    or v_command.payload ->> 'client_id' is distinct from p_client_id::text
    or v_command.payload ->> 'idempotency_key' is distinct from v_idempotency_key
    or v_command.payload -> 'confirm_running_tasks'
      is distinct from to_jsonb(coalesce(p_confirm_running_tasks, false))
  then
    raise exception using
      errcode = '23505',
      message = 'runtime control idempotency key collision';
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'was_duplicate', v_was_duplicate,
    'command', jsonb_build_object(
      'id', v_command.id,
      'action', v_action,
      'target_role', v_target_role,
      'status', v_command.status,
      'idempotency_key', v_command.idempotency_key,
      'confirm_running_tasks', coalesce(p_confirm_running_tasks, false),
      'created_at', v_command.created_at,
      'claimed_at', v_command.claimed_at,
      'completed_at', v_command.completed_at,
      'error_message', v_command.error_message
    )
  );
end;
$function$;

revoke all on function public.runtime_control_prepare(
  text,
  text,
  uuid,
  boolean
) from public, anon, service_role;

grant execute on function public.runtime_control_prepare(
  text,
  text,
  uuid,
  boolean
) to authenticated;
