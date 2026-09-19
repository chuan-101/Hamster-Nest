-- Stable ordering: now() is a transaction timestamp, so a source and all its
-- reply placeholders used to tie and were sorted randomly by UUID.
create or replace function private.lounge_message_clock() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent_time timestamptz;
begin
 if new.meta->>'lounge'='true' then
  select created_at into parent_time from public.messages where id=new.reply_to_id and session_id=new.session_id;
  new.created_at:=greatest(clock_timestamp(),parent_time+interval '1 microsecond');
 end if;
 return new;
end $$;
revoke all on function private.lounge_message_clock() from public,anon,authenticated;
create trigger lounge_message_clock before insert on public.messages
 for each row execute function private.lounge_message_clock();

-- Repair only tied/inverted lounge replies, retaining original timestamps for audit.
with recursive ordering as (
 select id,created_at as fixed_at from public.messages m
 where meta->>'lounge'='true' and (reply_to_id is null or not exists(select 1 from public.messages p where p.id=m.reply_to_id and p.meta->>'lounge'='true'))
 union all
 select m.id,greatest(m.created_at,p.fixed_at+interval '1 microsecond') from public.messages m join ordering p on m.reply_to_id=p.id
 where m.meta->>'lounge'='true'
)
update public.messages m set created_at=o.fixed_at,
 meta=m.meta||jsonb_build_object('original_created_at',m.created_at)
from ordering o where o.id=m.id and o.fixed_at<>m.created_at;
update public.lounge_messages l set created_at=m.created_at from public.messages m
 where l.id=m.id and m.meta->>'lounge'='true' and l.created_at<>m.created_at;

alter table public.lounge_sofas add column icon text not null default 'sofa'
 check(icon in ('sofa','coffee','sparkles','cloud','terminal','code','heart','moon'));
update public.lounge_sofas set icon=case when kind='work' then 'terminal' else 'sofa' end;

create or replace function private.lounge_set_appearance(p_id uuid,p_name text,p_icon text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); sofa public.lounge_sofas%rowtype;
begin
 if owner is null then raise exception using errcode='42501',message='authentication required';end if;
 if p_name is null or btrim(p_name)='' or length(p_name)>40 or p_icon is null
 or p_icon not in ('sofa','coffee','sparkles','cloud','terminal','code','heart','moon') then
  raise exception using errcode='22023',message='invalid sofa appearance';end if;
 select * into sofa from public.lounge_sofas where id=p_id and user_id=owner for update;
 if not found then raise exception using errcode='P0002',message='sofa not found';end if;
 update public.lounge_sofas set name=btrim(p_name),icon=p_icon,updated_at=now() where id=sofa.id returning * into sofa;
 update public.sessions set title=sofa.name where id=sofa.session_id and user_id=owner;
 return to_jsonb(sofa);
end $$;
revoke all on function private.lounge_set_appearance(uuid,text,text) from public,anon;
grant execute on function private.lounge_set_appearance(uuid,text,text) to authenticated;
create or replace function public.lounge_set_appearance(p_id uuid,p_name text,p_icon text) returns jsonb
language sql security invoker set search_path='' as $$ select private.lounge_set_appearance(p_id,p_name,p_icon); $$;
revoke all on function public.lounge_set_appearance(uuid,text,text) from public,anon;
grant execute on function public.lounge_set_appearance(uuid,text,text) to authenticated;

create or replace function private.lounge_prepare_target(
  p_user_id uuid,
  p_session_id uuid,
  p_client_id uuid,
  p_content text,
  p_client_created_at timestamptz,
  p_target_sender_keys text[],
  p_retry_failed boolean,
  p_create_durable_task boolean,
  p_source_message_id uuid
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

  if v_session.conversation_kind <> 'group'
     or v_session.handler <> 'router' then
    raise exception using
      errcode = '0A000',
      message = 'conversation_dispatch: expected a lounge group';
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

  select * into v_user_message from public.messages
    where id=p_source_message_id and user_id=v_user_id and session_id=v_session.id;
  if not found or v_user_message.content is distinct from p_content then
    raise exception 'lounge source mismatch';
  end if;
  v_session.handler := case when v_responder in ('claude_cli','codex_cli') then 'cli' else 'api' end;

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
      'delivery_attempt', 1, 'lounge', true,
      'mention_depth', coalesce((v_user_message.meta->>'mention_depth')::int,0)+1,
      'api_queue', case when v_session.handler='api' then 'pending' else null end
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
    v_target_role := case v_responder when 'codex_cli' then 'codex_cli_syzygy' else 'claude_code_cli_syzygy' end;

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
        'trigger_reason', case when v_user_message.sender_key='chuanchuan' then 'user_message' else 'lounge_mention' end,
        'conversation_kind', 'group',
        'source_sender_key', v_user_message.sender_key,
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
    'was_duplicate', not (case when v_session.handler='api' then v_reply_claimed else v_command_inserted or v_command_requeued end),
    'reply_reused', not v_reply_inserted,
    'execution_disposition', case
      when v_command_requeued or (v_reply_claimed and not v_reply_inserted) then 'requeued'
      when v_reply_inserted then 'queued'
      else 'already_dispatched' end
  );
end
$function$;
