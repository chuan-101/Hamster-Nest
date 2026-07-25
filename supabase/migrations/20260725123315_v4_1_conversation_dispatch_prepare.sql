-- V4.1 W0 / 2.3a: authenticated, idempotent conversation dispatch preparation.
-- Production migration registration: 20260725123315.
--
-- The Edge Function invokes this RPC with the caller's JWT. SECURITY INVOKER
-- keeps RLS active while one database transaction claims the canonical user
-- message, responder reply, and (for CLI routes) command envelope.

set lock_timeout = '5s';
set statement_timeout = '2min';

create or replace function public.conversation_dispatch_prepare(
  p_session_id uuid,
  p_client_id uuid,
  p_content text,
  p_client_created_at timestamptz default now(),
  p_target_sender_keys text[] default null,
  p_retry_failed boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_session public.sessions%rowtype;
  v_participants jsonb;
  v_responder text;
  v_targets text[];
  v_user_message public.messages%rowtype;
  v_reply public.messages%rowtype;
  v_command public.syzygy_commands%rowtype;
  v_reply_id uuid;
  v_command_id uuid;
  v_user_inserted boolean := false;
  v_reply_inserted boolean := false;
  v_reply_claimed boolean := false;
  v_command_inserted boolean := false;
  v_command_requeued boolean := false;
  v_delivery_state text;
  v_delivery_attempt integer := 1;
  v_command_key text;
  v_target_role text;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'conversation_dispatch: authentication required';
  end if;

  if p_session_id is null or p_client_id is null then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: session_id and client_id are required';
  end if;

  if p_content is null or btrim(p_content) = '' then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: content must not be empty';
  end if;

  if char_length(p_content) > 20000 then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: content exceeds 20000 characters';
  end if;

  select *
  into v_session
  from public.sessions
  where id = p_session_id
    and user_id = v_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_dispatch: session not found';
  end if;

  if v_session.is_archived then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: archived session is read only';
  end if;

  if v_session.conversation_kind <> 'direct'
     or v_session.handler not in ('api', 'cli') then
    raise exception using
      errcode = '0A000',
      message = 'conversation_dispatch: group router is not enabled in W0';
  end if;

  v_participants := v_session.routing_config -> 'participants';
  if jsonb_typeof(v_participants) <> 'array'
     or jsonb_array_length(v_participants) < 2 then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: routing participants are invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_participants) as participant(value)
    where jsonb_typeof(participant.value) <> 'string'
       or btrim(participant.value #>> '{}') = ''
  ) then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: participant sender keys must be nonempty strings';
  end if;

  if not (v_participants ? 'chuanchuan') then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: chuanchuan must be a participant';
  end if;

  if p_target_sender_keys is null or cardinality(p_target_sender_keys) = 0 then
    v_responder := nullif(btrim(v_session.routing_config ->> 'default_responder'), '');
    v_targets := case when v_responder is null then null else array[v_responder] end;
  else
    if cardinality(p_target_sender_keys) <> 1
       or exists (
         select 1
         from unnest(p_target_sender_keys) as target(sender_key)
         where target.sender_key is null
            or btrim(target.sender_key) = ''
       ) then
      raise exception using
        errcode = '22023',
        message = 'conversation_dispatch: direct sessions require exactly one target sender';
    end if;

    v_responder := btrim(p_target_sender_keys[1]);
    v_targets := array[v_responder];
  end if;

  if v_responder is null
     or v_responder = 'chuanchuan'
     or not (v_participants ? v_responder) then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch: responder is not a valid participant';
  end if;

  insert into public.messages (
    user_id,
    session_id,
    role,
    content,
    meta,
    client_id,
    client_created_at,
    sender_key,
    target_sender_keys
  )
  values (
    v_user_id,
    v_session.id,
    'user',
    p_content,
    jsonb_build_object(
      'schema_version', 1,
      'source', 'conversation_dispatch'
    ),
    p_client_id,
    coalesce(p_client_created_at, now()),
    'chuanchuan',
    v_targets
  )
  on conflict (client_id) where client_id is not null
  do nothing
  returning *
  into v_user_message;

  v_user_inserted := found;

  if not v_user_inserted then
    select *
    into v_user_message
    from public.messages
    where client_id = p_client_id
      and user_id = v_user_id;

    if not found
       or v_user_message.session_id <> v_session.id
       or v_user_message.role <> 'user'
       or v_user_message.sender_key is distinct from 'chuanchuan'
       or v_user_message.content is distinct from p_content
       or v_user_message.target_sender_keys is distinct from v_targets then
      raise exception using
        errcode = '23505',
        message = 'conversation_dispatch: client_id was already used for a different message';
    end if;
  end if;

  insert into public.messages (
    user_id,
    session_id,
    role,
    content,
    meta,
    sender_key,
    reply_to_id
  )
  values (
    v_user_id,
    v_session.id,
    'assistant',
    '',
    jsonb_build_object(
      'schema_version', 1,
      'source', 'conversation_dispatch',
      'delivery_state', 'generating',
      'delivery_attempt', 1
    ),
    v_responder,
    v_user_message.id
  )
  on conflict (session_id, reply_to_id, sender_key)
    where role = 'assistant' and reply_to_id is not null
  do nothing
  returning *
  into v_reply;

  v_reply_inserted := found;
  v_reply_claimed := v_reply_inserted;
  if v_reply_inserted then
    v_reply_id := v_reply.id;
  end if;

  if not v_reply_inserted then
    select *
    into v_reply
    from public.messages
    where session_id = v_session.id
      and reply_to_id = v_user_message.id
      and sender_key = v_responder
      and role = 'assistant'
      and user_id = v_user_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'conversation_dispatch: responder reply claim could not be resolved';
    end if;

    v_reply_id := v_reply.id;
    v_delivery_state := coalesce(
      nullif(v_reply.meta ->> 'delivery_state', ''),
      case when btrim(v_reply.content) <> '' then 'completed' else 'failed' end
    );

    if v_delivery_state = 'failed' and p_retry_failed then
      v_delivery_attempt := case
        when coalesce(v_reply.meta ->> 'delivery_attempt', '') ~ '^[0-9]+$'
          then greatest((v_reply.meta ->> 'delivery_attempt')::integer + 1, 2)
        else 2
      end;

      update public.messages
      set
        content = '',
        meta = (
          jsonb_set(
            jsonb_set(
              coalesce(meta, '{}'::jsonb),
              '{delivery_state}',
              '"generating"'::jsonb,
              true
            ),
            '{delivery_attempt}',
            to_jsonb(v_delivery_attempt),
            true
          )
          - 'delivery_error'
          - 'delivery_error_code'
          - 'model'
        )
      where id = v_reply_id
        and user_id = v_user_id
        and coalesce(meta ->> 'delivery_state', 'failed') = 'failed'
      returning *
      into v_reply;

      v_reply_claimed := found;

      if not v_reply_claimed then
        select *
        into v_reply
        from public.messages
        where id = v_reply_id
          and user_id = v_user_id;
      end if;
    end if;
  end if;

  if v_session.handler = 'cli' then
    v_target_role := coalesce(
      nullif(btrim(v_session.routing_config ->> 'target_role'), ''),
      'codex_cli_syzygy'
    );

    if v_target_role not in ('codex_cli_syzygy', 'claude_code_cli_syzygy') then
      raise exception using
        errcode = '22023',
        message = 'conversation_dispatch: CLI target_role is not allowed';
    end if;

    v_command_key := format(
      'conversation:v1:%s:%s',
      v_user_message.id,
      v_responder
    );

    insert into public.syzygy_commands (
      user_id,
      command_type,
      payload,
      status,
      idempotency_key
    )
    values (
      v_user_id,
      'run_task',
      jsonb_build_object(
        'schema_version', 1,
        'source', 'conversation_dispatch',
        'target_role', v_target_role,
        'task_type', 'conversation_message',
        'task_content', p_content,
        'trigger_reason', 'user_message',
        'allow_wechat_notify', false,
        'session_id', v_session.id,
        'user_message_id', v_user_message.id,
        'reply_id', v_reply.id,
        'correlation_id', v_user_message.id,
        'responder_sender_key', v_responder,
        'idempotency_key', v_command_key
      ),
      'pending',
      v_command_key
    )
    on conflict (user_id, idempotency_key)
    do nothing
    returning *
    into v_command;

    v_command_inserted := found;
    if v_command_inserted then
      v_command_id := v_command.id;
    end if;

    if not v_command_inserted then
      select *
      into v_command
      from public.syzygy_commands
      where user_id = v_user_id
        and idempotency_key = v_command_key;

      if not found
         or v_command.command_type <> 'run_task'
         or v_command.payload ->> 'reply_id' is distinct from v_reply.id::text then
        raise exception using
          errcode = '23505',
          message = 'conversation_dispatch: CLI idempotency key conflict';
      end if;

      v_command_id := v_command.id;
      if p_retry_failed
         and v_reply_claimed
         and v_command.status = 'failed' then
        update public.syzygy_commands
        set
          status = 'pending',
          result = null,
          error_message = null,
          claimed_by = null,
          claimed_at = null,
          completed_at = null,
          updated_at = now()
        where id = v_command_id
          and user_id = v_user_id
          and status = 'failed'
        returning *
        into v_command;

        v_command_requeued := found;
        if not v_command_requeued then
          select *
          into v_command
          from public.syzygy_commands
          where id = v_command_id
            and user_id = v_user_id;
        end if;
      elsif p_retry_failed
            and v_reply_claimed
            and v_command.status = 'done' then
        update public.messages
        set meta = jsonb_set(
          jsonb_set(
            coalesce(meta, '{}'::jsonb),
            '{delivery_state}',
            '"failed"'::jsonb,
            true
          ),
          '{delivery_error_code}',
          '"CLI_COMMAND_ALREADY_DONE"'::jsonb,
          true
        )
        where id = v_reply_id
          and user_id = v_user_id
        returning *
        into v_reply;

        v_reply_claimed := false;
      end if;
    end if;
  end if;

  v_delivery_state := coalesce(
    nullif(v_reply.meta ->> 'delivery_state', ''),
    case when btrim(v_reply.content) <> '' then 'completed' else 'failed' end
  );
  v_delivery_attempt := case
    when coalesce(v_reply.meta ->> 'delivery_attempt', '') ~ '^[0-9]+$'
      then greatest((v_reply.meta ->> 'delivery_attempt')::integer, 1)
    else 1
  end;

  return jsonb_build_object(
    'schema_version', 1,
    'handler', v_session.handler,
    'responder_sender_key', v_responder,
    'target_sender_keys', to_jsonb(v_targets),
    'user_message', jsonb_build_object(
      'id', v_user_message.id,
      'created_at', v_user_message.created_at
    ),
    'reply', jsonb_build_object(
      'id', v_reply.id,
      'delivery_state', v_delivery_state,
      'delivery_attempt', v_delivery_attempt
    ),
    'command', case
      when v_session.handler = 'cli' then jsonb_build_object(
        'id', v_command.id,
        'status', v_command.status,
        'idempotency_key', v_command.idempotency_key
      )
      else null
    end,
    'should_execute', case
      when v_session.handler = 'api' then v_reply_claimed
      else v_command_inserted or v_command_requeued
    end,
    'was_duplicate', not v_user_inserted
  );
end
$function$;

comment on function public.conversation_dispatch_prepare(
  uuid,
  uuid,
  text,
  timestamptz,
  text[],
  boolean
) is
  'Authenticated SECURITY INVOKER claim for one canonical user message, responder reply, and optional CLI command.';

revoke all on function public.conversation_dispatch_prepare(
  uuid,
  uuid,
  text,
  timestamptz,
  text[],
  boolean
) from public, anon, service_role;

grant execute on function public.conversation_dispatch_prepare(
  uuid,
  uuid,
  text,
  timestamptz,
  text[],
  boolean
) to authenticated;
