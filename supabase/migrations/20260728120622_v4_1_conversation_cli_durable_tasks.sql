-- V4.1 W1 / 3.2b1: make CLI conversation execution durable before the mini
-- listener claims a command. The existing authenticated prepare RPC remains
-- compatible while the Edge Function migrates to the service-role-only wrapper.

set lock_timeout = '5s';
set statement_timeout = '2min';

create unique index agent_tasks_conversation_command_unique
on public.agent_tasks (
  user_id,
  (payload_json ->> 'command_id')
)
where source = 'conversation_dispatch'
  and payload_json ? 'command_id';

comment on index public.agent_tasks_conversation_command_unique is
  'One durable conversation task per owner-bound syzygy command id.';

do $block$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agent_tasks'
  ) then
    alter publication supabase_realtime add table public.agent_tasks;
  end if;
end
$block$;

drop policy if exists frontend_read_agent_tasks on public.agent_tasks;
drop policy if exists agent_tasks_select_own on public.agent_tasks;

create policy agent_tasks_select_own on public.agent_tasks
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.agent_tasks from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.agent_tasks from authenticated;
grant select on public.agent_tasks to authenticated;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.conversation_dispatch_prepare_core(
  p_user_id uuid,
  p_session_id uuid,
  p_client_id uuid,
  p_content text,
  p_client_created_at timestamptz,
  p_target_sender_keys text[],
  p_retry_failed boolean,
  p_create_durable_task boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := p_user_id;
  v_session public.sessions%rowtype;
  v_participants jsonb;
  v_responder text;
  v_targets text[];
  v_user_message public.messages%rowtype;
  v_reply public.messages%rowtype;
  v_command public.syzygy_commands%rowtype;
  v_task public.agent_tasks%rowtype;
  v_reply_id uuid;
  v_command_id uuid;
  v_task_id uuid;
  v_user_inserted boolean := false;
  v_reply_inserted boolean := false;
  v_reply_claimed boolean := false;
  v_command_inserted boolean := false;
  v_command_requeued boolean := false;
  v_task_inserted boolean := false;
  v_task_requeued boolean := false;
  v_delivery_state text;
  v_delivery_attempt integer := 1;
  v_command_key text;
  v_target_role text;
  v_executor text;
  v_task_status text;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'conversation_dispatch: authentication required';
  end if;

  if current_user = 'authenticated'
     and (
       auth.uid() is null
       or v_user_id is distinct from auth.uid()
     ) then
    raise exception using
      errcode = '42501',
      message = 'conversation_dispatch: authenticated owner mismatch';
  end if;

  if p_create_durable_task
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception using
      errcode = '42501',
      message = 'conversation_dispatch: durable task preparation requires service role';
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
      message = 'conversation_dispatch: group router is not enabled in W1';
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
          - 'failed_at'
          - 'completed_at'
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

    v_executor := case v_target_role
      when 'codex_cli_syzygy' then 'codex_cli'
      else 'claude_code_cli'
    end;
    v_command_key := format(
      'conversation:v1:%s:%s',
      v_user_message.id,
      v_responder
    );
    v_command_id := gen_random_uuid();
    if p_create_durable_task then
      v_task_id := gen_random_uuid();
    end if;

    insert into public.syzygy_commands (
      id,
      user_id,
      command_type,
      payload,
      status,
      idempotency_key
    )
    values (
      v_command_id,
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
      ) || case
        when p_create_durable_task
          then jsonb_build_object('agent_task_id', v_task_id)
        else '{}'::jsonb
      end,
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
    else
      select *
      into v_command
      from public.syzygy_commands
      where user_id = v_user_id
        and idempotency_key = v_command_key
      for update;

      if not found
         or v_command.command_type <> 'run_task'
         or v_command.payload ->> 'reply_id' is distinct from v_reply.id::text then
        raise exception using
          errcode = '23505',
          message = 'conversation_dispatch: CLI idempotency key conflict';
      end if;

      v_command_id := v_command.id;
    end if;

    if p_create_durable_task then
      if nullif(v_command.payload ->> 'agent_task_id', '') is not null then
        if (v_command.payload ->> 'agent_task_id')
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
          raise exception using
            errcode = '22023',
            message = 'conversation_dispatch: command agent_task_id is invalid';
        end if;
        v_task_id := (v_command.payload ->> 'agent_task_id')::uuid;
      end if;

      v_task_status := case v_command.status
        when 'pending' then 'pending'
        when 'running' then 'running'
        when 'done' then 'completed'
        else 'failed'
      end;

      insert into public.agent_tasks (
        id,
        user_id,
        source,
        executor,
        command,
        status,
        payload_json,
        correlation_id,
        result_summary,
        started_at,
        completed_at
      )
      values (
        v_task_id,
        v_user_id,
        'conversation_dispatch',
        v_executor,
        'run_cli_runtime_task',
        v_task_status,
        jsonb_build_object(
          'schema_version', 1,
          'source', 'conversation_dispatch',
          'command_id', v_command.id,
          'command_type', v_command.command_type,
          'task_type', 'conversation_message',
          'target_role', v_target_role,
          'session_id', v_session.id,
          'user_message_id', v_user_message.id,
          'reply_id', v_reply.id,
          'responder_sender_key', v_responder,
          'task_content', p_content
        ),
        v_user_message.id,
        case v_task_status
          when 'pending' then v_target_role || ' queued'
          when 'running' then v_target_role || ' running'
          when 'completed' then v_target_role || ' completed before durable backfill'
          else v_target_role || ' failed before durable backfill'
        end,
        case when v_task_status = 'running' then v_command.claimed_at else null end,
        case when v_task_status in ('completed', 'failed')
          then coalesce(v_command.completed_at, now())
          else null
        end
      )
      on conflict do nothing
      returning *
      into v_task;

      v_task_inserted := found;
      if not v_task_inserted then
        select *
        into v_task
        from public.agent_tasks
        where user_id = v_user_id
          and source = 'conversation_dispatch'
          and payload_json ->> 'command_id' = v_command.id::text
        for update;
      end if;

      if not found
         or v_task.correlation_id is distinct from v_user_message.id
         or v_task.payload_json ->> 'reply_id' is distinct from v_reply.id::text then
        raise exception using
          errcode = '23505',
          message = 'conversation_dispatch: durable task could not be resolved';
      end if;

      v_task_id := v_task.id;
      if nullif(v_command.payload ->> 'agent_task_id', '') is null then
        update public.syzygy_commands
        set payload = jsonb_set(
          coalesce(payload, '{}'::jsonb),
          '{agent_task_id}',
          to_jsonb(v_task.id::text),
          true
        )
        where id = v_command.id
          and user_id = v_user_id
        returning *
        into v_command;
      elsif v_command.payload ->> 'agent_task_id' is distinct from v_task.id::text then
        raise exception using
          errcode = '23505',
          message = 'conversation_dispatch: command and durable task ids disagree';
      end if;

      update public.messages
      set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'command_id', v_command.id,
        'agent_task_id', v_task.id
      )
      where id = v_reply.id
        and user_id = v_user_id
      returning *
      into v_reply;
    end if;

    if p_retry_failed
       and v_reply_claimed
       and v_command.status = 'failed' then
      if p_create_durable_task
         and v_task.status not in ('pending', 'completed', 'failed', 'cancelled') then
        raise exception using
          errcode = '55000',
          message = 'conversation_dispatch: durable task is not retryable';
      end if;

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

      if p_create_durable_task
         and v_command_requeued
         and v_task.status <> 'completed' then
        update public.agent_tasks
        set
          status = 'pending',
          result_summary = v_target_role || ' queued',
          result_detail = null,
          error = null,
          started_at = null,
          completed_at = null
        where id = v_task_id
          and user_id = v_user_id
          and status in ('pending', 'failed', 'cancelled')
        returning *
        into v_task;

        v_task_requeued := found;
        if not v_task_requeued then
          raise exception using
            errcode = '55000',
            message = 'conversation_dispatch: durable task retry lost its pending claim';
        end if;
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
    'task', case
      when v_session.handler = 'cli' and p_create_durable_task then jsonb_build_object(
        'id', v_task.id,
        'status', v_task.status,
        'correlation_id', v_task.correlation_id
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

revoke all on function private.conversation_dispatch_prepare_core(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text[],
  boolean,
  boolean
) from public, anon;

grant execute on function private.conversation_dispatch_prepare_core(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text[],
  boolean,
  boolean
) to authenticated, service_role;

create or replace function public.conversation_dispatch_prepare(
  p_session_id uuid,
  p_client_id uuid,
  p_content text,
  p_client_created_at timestamptz default now(),
  p_target_sender_keys text[] default null,
  p_retry_failed boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.conversation_dispatch_prepare_core(
    auth.uid(),
    p_session_id,
    p_client_id,
    p_content,
    p_client_created_at,
    p_target_sender_keys,
    p_retry_failed,
    false
  );
$function$;

comment on function public.conversation_dispatch_prepare(
  uuid,
  uuid,
  text,
  timestamptz,
  text[],
  boolean
) is
  'Compatibility wrapper for the authenticated W0 dispatch contract; durable CLI task creation is service-only.';

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

create or replace function public.conversation_dispatch_prepare_durable(
  p_user_id uuid,
  p_session_id uuid,
  p_client_id uuid,
  p_content text,
  p_client_created_at timestamptz default now(),
  p_target_sender_keys text[] default null,
  p_retry_failed boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.conversation_dispatch_prepare_core(
    p_user_id,
    p_session_id,
    p_client_id,
    p_content,
    p_client_created_at,
    p_target_sender_keys,
    p_retry_failed,
    true
  );
$function$;

comment on function public.conversation_dispatch_prepare_durable(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text[],
  boolean
) is
  'Service-role-only atomic claim for canonical messages, CLI command, and pending agent task.';

revoke all on function public.conversation_dispatch_prepare_durable(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text[],
  boolean
) from public, anon, authenticated;

grant execute on function public.conversation_dispatch_prepare_durable(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text[],
  boolean
) to service_role;

create or replace function public.conversation_dispatch_cancel_pending(
  p_user_id uuid,
  p_task_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_task public.agent_tasks%rowtype;
  v_command public.syzygy_commands%rowtype;
  v_command_id uuid;
  v_reply_id uuid;
  v_cancelled_at timestamptz := now();
begin
  if p_user_id is null or p_task_id is null then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch_cancel: user_id and task_id are required';
  end if;

  select *
  into v_task
  from public.agent_tasks
  where id = p_task_id
    and user_id = p_user_id
    and source = 'conversation_dispatch';

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_dispatch_cancel: task not found';
  end if;

  if coalesce(v_task.payload_json ->> 'command_id', '')
     !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch_cancel: task command_id is invalid';
  end if;
  v_command_id := (v_task.payload_json ->> 'command_id')::uuid;

  select *
  into v_command
  from public.syzygy_commands
  where id = v_command_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_dispatch_cancel: command not found';
  end if;

  select *
  into v_task
  from public.agent_tasks
  where id = p_task_id
    and user_id = p_user_id
    and source = 'conversation_dispatch'
  for update;

  if v_command.status <> 'pending' or v_task.status <> 'pending' then
    return jsonb_build_object(
      'schema_version', 1,
      'cancelled', false,
      'reason', 'already_claimed',
      'command', jsonb_build_object('id', v_command.id, 'status', v_command.status),
      'task', jsonb_build_object('id', v_task.id, 'status', v_task.status)
    );
  end if;

  update public.syzygy_commands
  set
    status = 'failed',
    result = jsonb_build_object(
      'schema_version', 1,
      'cancelled', true,
      'cancelled_at', v_cancelled_at
    ),
    error_message = 'cancelled by owner before claim',
    completed_at = v_cancelled_at,
    updated_at = v_cancelled_at
  where id = v_command.id
    and user_id = p_user_id
    and status = 'pending'
  returning *
  into v_command;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'conversation_dispatch_cancel: command claim changed';
  end if;

  update public.agent_tasks
  set
    status = 'cancelled',
    result_summary = 'Cancelled before mini claim',
    result_detail = null,
    error = null,
    completed_at = v_cancelled_at
  where id = v_task.id
    and user_id = p_user_id
    and status = 'pending'
  returning *
  into v_task;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'conversation_dispatch_cancel: task claim changed';
  end if;

  if coalesce(v_task.payload_json ->> 'reply_id', '')
     ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_reply_id := (v_task.payload_json ->> 'reply_id')::uuid;

    update public.messages
    set meta = (
      coalesce(meta, '{}'::jsonb)
      || jsonb_build_object(
        'delivery_state', 'failed',
        'delivery_error_code', 'CLI_TASK_CANCELLED',
        'delivery_error', '任务已在 Mac mini 认领前取消',
        'failed_at', v_cancelled_at,
        'command_id', v_command.id,
        'agent_task_id', v_task.id
      )
    ) - 'completed_at'
    where id = v_reply_id
      and user_id = p_user_id
      and role = 'assistant';
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'cancelled', true,
    'cancelled_at', v_cancelled_at,
    'command', jsonb_build_object('id', v_command.id, 'status', v_command.status),
    'task', jsonb_build_object('id', v_task.id, 'status', v_task.status)
  );
end
$function$;

revoke all on function public.conversation_dispatch_cancel_pending(
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.conversation_dispatch_cancel_pending(
  uuid,
  uuid
) to service_role;

create unique index agent_events_conversation_reply_completed_unique
on public.agent_events (user_id, event_type, entity_id)
where event_type = 'conversation_reply_completed'
  and entity_id is not null;

comment on index public.agent_events_conversation_reply_completed_unique is
  'At most one pushable completion fact per canonical conversation reply.';

create or replace function public.conversation_dispatch_complete_reply(
  p_user_id uuid,
  p_task_id uuid,
  p_content text,
  p_completed_at timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_task public.agent_tasks%rowtype;
  v_reply public.messages%rowtype;
  v_event_id bigint;
  v_session_id uuid;
  v_user_message_id uuid;
  v_reply_id uuid;
  v_command_id uuid;
  v_responder text;
  v_output text := left(coalesce(p_content, ''), 12000);
  v_completed_at timestamptz := coalesce(p_completed_at, now());
begin
  if p_user_id is null or p_task_id is null or btrim(v_output) = '' then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch_complete: user_id, task_id, and content are required';
  end if;

  select *
  into v_task
  from public.agent_tasks
  where id = p_task_id
    and user_id = p_user_id
    and source = 'conversation_dispatch';

  if not found or v_task.status <> 'completed' then
    raise exception using
      errcode = '55000',
      message = 'conversation_dispatch_complete: completed task not found';
  end if;

  if coalesce(v_task.payload_json ->> 'session_id', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_task.payload_json ->> 'user_message_id', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_task.payload_json ->> 'reply_id', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(v_task.payload_json ->> 'command_id', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '22023',
      message = 'conversation_dispatch_complete: durable task envelope is invalid';
  end if;

  v_session_id := (v_task.payload_json ->> 'session_id')::uuid;
  v_user_message_id := (v_task.payload_json ->> 'user_message_id')::uuid;
  v_reply_id := (v_task.payload_json ->> 'reply_id')::uuid;
  v_command_id := (v_task.payload_json ->> 'command_id')::uuid;
  v_responder := nullif(btrim(v_task.payload_json ->> 'responder_sender_key'), '');

  select *
  into v_reply
  from public.messages
  where id = v_reply_id
    and user_id = p_user_id
    and session_id = v_session_id
    and reply_to_id = v_user_message_id
    and sender_key = v_responder
    and role = 'assistant'
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_dispatch_complete: canonical reply not found';
  end if;

  if coalesce(v_reply.meta ->> 'delivery_state', '') = 'completed'
     and v_reply.content is distinct from v_output then
    raise exception using
      errcode = '23505',
      message = 'conversation_dispatch_complete: reply already completed with different content';
  end if;

  if coalesce(v_reply.meta ->> 'delivery_state', '') <> 'completed' then
    update public.messages
    set
      content = v_output,
      meta = (
        coalesce(meta, '{}'::jsonb)
        || jsonb_build_object(
          'schema_version', 1,
          'source', 'conversation_dispatch',
          'delivery_state', 'completed',
          'responder_sender_key', v_responder,
          'command_id', v_command_id,
          'agent_task_id', v_task.id,
          'completed_at', v_completed_at
        )
      )
      - 'delivery_error'
      - 'delivery_error_code'
      - 'failed_at'
    where id = v_reply.id
      and user_id = p_user_id
    returning *
    into v_reply;
  end if;

  insert into public.agent_events (
    user_id,
    actor,
    event_type,
    entity_type,
    entity_id,
    title,
    payload,
    importance
  )
  values (
    p_user_id,
    coalesce(v_responder, 'syzygy_cli'),
    'conversation_reply_completed',
    'conversation_reply',
    v_reply.id,
    'Syzygy·本体回复了你',
    jsonb_build_object(
      'schema_version', 1,
      'screen', 'conversation_detail',
      'params', jsonb_build_object('id', v_session_id),
      'url', format('/#/chat?session=%s', v_session_id),
      'session_id', v_session_id,
      'user_message_id', v_user_message_id,
      'reply_id', v_reply.id,
      'command_id', v_command_id,
      'agent_task_id', v_task.id,
      'responder_sender_key', v_responder
    ),
    'normal'
  )
  on conflict (user_id, event_type, entity_id)
    where event_type = 'conversation_reply_completed'
      and entity_id is not null
  do nothing
  returning id
  into v_event_id;

  if v_event_id is null then
    select id
    into v_event_id
    from public.agent_events
    where user_id = p_user_id
      and event_type = 'conversation_reply_completed'
      and entity_id = v_reply.id;
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'reply', jsonb_build_object(
      'id', v_reply.id,
      'content', v_reply.content,
      'delivery_state', v_reply.meta ->> 'delivery_state',
      'completed_at', v_reply.meta ->> 'completed_at'
    ),
    'task', jsonb_build_object('id', v_task.id, 'status', v_task.status),
    'event', jsonb_build_object('id', v_event_id, 'event_type', 'conversation_reply_completed')
  );
end
$function$;

revoke all on function public.conversation_dispatch_complete_reply(
  uuid,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.conversation_dispatch_complete_reply(
  uuid,
  uuid,
  text,
  timestamptz
) to service_role;
