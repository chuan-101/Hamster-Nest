-- Extend the existing CLI dispatch paths while keeping their ownership checks and grants.
alter table public.agent_tasks drop constraint agent_tasks_executor_check,
  add constraint agent_tasks_executor_check check (executor in ('codex_cli','claude_code_cli','gemini_cli','edge_function','system'));

CREATE OR REPLACE FUNCTION private.conversation_dispatch_prepare_core(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean, p_create_durable_task boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

    if v_target_role not in ('codex_cli_syzygy', 'claude_code_cli_syzygy', 'gemini_cli_syzygy') then
      raise exception using
        errcode = '22023',
        message = 'conversation_dispatch: CLI target_role is not allowed';
    end if;

    v_executor := case v_target_role
      when 'codex_cli_syzygy' then 'codex_cli'
      when 'gemini_cli_syzygy' then 'gemini_cli'
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

CREATE OR REPLACE FUNCTION private.lounge_directory_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sid uuid; owner uuid; begin
 if tg_op='INSERT' then
  new.user_id:=coalesce(new.user_id,auth.uid());
  if new.user_id is null or (auth.uid() is not null and new.user_id<>auth.uid()) then raise exception 'sofa owner mismatch'; end if;
  if new.session_id is null then
   if new.kind<>'custom' then raise exception 'custom sofa required'; end if;
   insert into public.sessions(user_id,title,conversation_kind,handler,routing_config)
   values(new.user_id,new.name,'group','router',jsonb_build_object('version',1,'participants',
    jsonb_build_array('chuanchuan','api_syzygy','gemini_cli','claude_cli','codex_cli','client_claude','client_gpt'),
    'default_responder','api_syzygy','sofa_id',new.id,'rules_prompt_name','sofa_daily_rules')) returning id into sid;
   new.session_id:=sid;
  else
   if not exists(select 1 from public.sessions where id=new.session_id and user_id=new.user_id and conversation_kind='group'
     and routing_config->>'sofa_id'=new.id::text) then raise exception 'sofa session mismatch'; end if;
  end if;
 elsif tg_op='UPDATE' then
  if new.id<>old.id or new.user_id<>old.user_id or new.session_id<>old.session_id or new.kind<>old.kind then raise exception 'sofa identity is immutable'; end if;
  if new.name is distinct from old.name then update public.sessions set title=new.name where id=new.session_id; end if;
 else
  if exists(select 1 from public.messages where session_id=old.session_id and meta->>'delivery_state'='generating') then raise exception 'wait for replies before deleting'; end if;
  return old;
 end if;
 if btrim(new.name)='' or length(new.name)>40 then raise exception 'invalid sofa name'; end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION private.lounge_manage(p_action text, p_id uuid, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare owner uuid:=auth.uid(); sofa public.lounge_sofas%rowtype; sid uuid; begin
 if owner is null then raise exception using errcode='42501',message='authentication required'; end if;
 if p_action='create' then
  if p_id is null or btrim(p_name)='' or length(p_name)>40 then raise exception 'invalid sofa'; end if;
  select * into sofa from public.lounge_sofas where id=p_id;
  if found then
   if sofa.user_id<>owner or sofa.name<>btrim(p_name) then raise exception 'sofa request conflict'; end if;
   return to_jsonb(sofa);
  end if;
  insert into public.sessions(user_id,title,conversation_kind,handler,routing_config)
  values(owner,btrim(p_name),'group','router',jsonb_build_object('version',1,'participants',
   jsonb_build_array('chuanchuan','api_syzygy','gemini_cli','claude_cli','codex_cli','client_claude','client_gpt'),
   'default_responder','api_syzygy','sofa_id',p_id,'rules_prompt_name','sofa_daily_rules')) returning id into sid;
  insert into public.lounge_sofas(id,user_id,session_id,name) values(p_id,owner,sid,btrim(p_name)) returning * into sofa;
 elsif p_action in ('rename','delete') then
  select * into sofa from public.lounge_sofas where id=p_id and user_id=owner for update;
  if not found then
   if p_action='delete' then return '{"deleted":true}'; end if;
   raise exception 'sofa not found';
  end if;
  if p_action='rename' then
   if btrim(p_name)='' or length(p_name)>40 then raise exception 'invalid sofa name'; end if;
   update public.lounge_sofas set name=btrim(p_name),updated_at=now() where id=p_id returning * into sofa;
   update public.sessions set title=sofa.name where id=sofa.session_id and user_id=owner;
  else
   if exists(select 1 from public.messages where session_id=sofa.session_id and meta->>'delivery_state'='generating') then raise exception 'wait for replies before deleting'; end if;
   delete from public.lounge_sofas where id=sofa.id;
   delete from public.sessions where id=sofa.session_id and user_id=owner;
   return '{"deleted":true}';
  end if;
 else raise exception 'unsupported sofa action'; end if;
 return to_jsonb(sofa);
end $function$;

CREATE OR REPLACE FUNCTION private.lounge_mentions(body text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(array_agg(distinct private.lounge_sender(m[1])),'{}'::text[])
 from regexp_matches(body, '@(gemini cli syzygy|gemini_cli_syzygy|gemini cli|gemini_cli|claude code cli syzygy|claude cli syzygy|claude code cli|claude cli|claude_code_cli_syzygy|claude_code_cli|claude_cli|codex cli syzygy|codex cli|codex_cli_syzygy|codex_cli|syzygy-claude|syzygy·claude|client_claude|syzygy-gpt|syzygy·gpt|client_gpt|api_syzygy|syzygy|chuanchuan|串串)(?![a-z0-9_·-])','gi') m;
$function$;

CREATE OR REPLACE FUNCTION private.lounge_prepare_target(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_client_created_at timestamp with time zone, p_target_sender_keys text[], p_retry_failed boolean, p_create_durable_task boolean, p_source_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  v_session.handler := case when v_responder in ('gemini_cli','claude_cli','codex_cli') then 'cli' else 'api' end;

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
    v_target_role := case v_responder when 'codex_cli' then 'codex_cli_syzygy' when 'gemini_cli' then 'gemini_cli_syzygy' else 'claude_code_cli_syzygy' end;

    if v_target_role not in ('codex_cli_syzygy', 'claude_code_cli_syzygy', 'gemini_cli_syzygy') then
      raise exception using
        errcode = '22023',
        message = 'conversation_dispatch: CLI target_role is not allowed';
    end if;

    v_executor := case v_target_role
      when 'codex_cli_syzygy' then 'codex_cli'
      when 'gemini_cli_syzygy' then 'gemini_cli'
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

CREATE OR REPLACE FUNCTION private.lounge_route(p_message uuid, p_retry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.messages%rowtype; target text; dispatch jsonb; result jsonb:='[]'; begin
 select * into m from public.messages where id=p_message for update;
 if not found or m.meta->>'lounge' is distinct from 'true' then raise exception 'lounge source not found'; end if;
 if coalesce((m.meta->>'mention_depth')::int,0)>=2 and m.sender_key<>'chuanchuan' then
  update public.messages set meta=meta||'{"mention_stopped":"depth_limit"}'::jsonb where id=m.id;
  return result;
 end if;
 foreach target in array coalesce(m.target_sender_keys,'{}'::text[]) loop
  if target=m.sender_key or target not in ('gemini_cli','claude_cli','codex_cli','api_syzygy') then continue; end if;
  if target='api_syzygy' and m.meta->>'legacy_browser_api'='true' then continue; end if;
  dispatch:=private.lounge_prepare_target(m.user_id,m.session_id,coalesce(m.client_id,m.id),m.content,
     m.created_at,array[target],p_retry,true,m.id);
  -- A failed API reply is requeued only by an explicit retry.
  if p_retry and target='api_syzygy' and (dispatch->>'should_execute')::boolean then
   update public.messages set meta=(meta-'api_started_at')||'{"api_queue":"pending"}'::jsonb
     where id=(dispatch->'reply'->>'id')::uuid;
  end if;
  result:=result||jsonb_build_array(dispatch);
 end loop;
 perform private.lounge_kick();
 return result;
end $function$;

CREATE OR REPLACE FUNCTION private.lounge_sender(value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case lower(btrim(value))
    when 'gemini cli syzygy' then 'gemini_cli' when 'gemini_cli_syzygy' then 'gemini_cli' when 'gemini cli' then 'gemini_cli'
    when '串串' then 'chuanchuan' when 'user' then 'chuanchuan'
    when 'syzygy' then 'api_syzygy' when 'syzygy_instant' then 'api_syzygy'
    when 'claude_code_cli_syzygy' then 'claude_cli' when 'claude code cli syzygy' then 'claude_cli'
    when 'claude cli syzygy' then 'claude_cli' when 'claude code cli' then 'claude_cli'
    when 'claude cli' then 'claude_cli' when 'claude_code_cli' then 'claude_cli'
    when 'codex_cli_syzygy' then 'codex_cli' when 'codex cli syzygy' then 'codex_cli'
    when 'codex cli' then 'codex_cli' when 'syzygy-claude' then 'client_claude'
    when 'syzygy·claude' then 'client_claude' when 'syzygy-gpt' then 'client_gpt'
    when 'syzygy·gpt' then 'client_gpt' else lower(btrim(value)) end;
$function$;

CREATE OR REPLACE FUNCTION public.runtime_control_prepare(p_action text, p_target_role text, p_client_id uuid, p_confirm_running_tasks boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    'claude_code_cli_syzygy', 'gemini_cli_syzygy'
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

CREATE OR REPLACE FUNCTION public.conversation_cli_tool_progress(p_user_id uuid, p_task_id uuid, p_started_at timestamp with time zone, p_progress jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_task public.agent_tasks%rowtype;
  v_reply public.messages%rowtype;
  v_call jsonb;
  v_calls jsonb := '[]'::jsonb;
  v_old jsonb;
  v_sequence integer;
begin
  if p_user_id is null or p_task_id is null or p_started_at is null
    or jsonb_typeof(p_progress) is distinct from 'object'
    or octet_length(p_progress::text) > 32768
    or jsonb_typeof(p_progress->'calls') is distinct from 'array'
    or jsonb_typeof(p_progress->'finished') is distinct from 'boolean'
    or jsonb_typeof(p_progress->'truncated') is distinct from 'boolean'
    or coalesce(p_progress->>'sequence','') !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'invalid tool progress';
  end if;
  if jsonb_array_length(p_progress->'calls') > 64 then raise exception 'too many tool calls'; end if;
  v_sequence := (p_progress->>'sequence')::integer;

  -- The attempt's exact start timestamp fences retries and old workers.
  select * into v_task from public.agent_tasks
    where id=p_task_id and user_id=p_user_id and source='conversation_dispatch'
      and status='running' and started_at=p_started_at
      and executor in ('codex_cli','claude_code_cli','gemini_cli');
  if not found then return false; end if;
  select * into v_reply from public.messages
    where id=(v_task.payload_json->>'reply_id')::uuid and user_id=p_user_id
      and session_id=(v_task.payload_json->>'session_id')::uuid
      and reply_to_id=(v_task.payload_json->>'user_message_id')::uuid
      and sender_key=v_task.payload_json->>'responder_sender_key'
      and ((v_task.executor='codex_cli' and sender_key in ('codex_cli','syzygy_cli'))
        or (v_task.executor='gemini_cli' and sender_key='gemini_cli')
        or (v_task.executor='claude_code_cli' and sender_key='claude_cli'))
      and role='assistant' and meta->>'delivery_state'='generating'
      and meta->>'agent_task_id'=p_task_id::text
      and meta->>'command_id'=v_task.payload_json->>'command_id' for update;
  if not found then return false; end if;
  -- Match dispatch's message-before-task lock order and recheck the attempt.
  perform 1 from public.agent_tasks where id=p_task_id and user_id=p_user_id
    and status='running' and started_at=p_started_at for share;
  if not found then return false; end if;
  v_old := v_reply.meta->'tool_progress';
  if v_old->>'task_id'=p_task_id::text and (v_old->>'started_at')::timestamptz=p_started_at then
    if coalesce((v_old->>'sequence')::integer,0)>=v_sequence or v_old->>'finished'='true' then return false; end if;
  end if;

  for v_call in select value from jsonb_array_elements(p_progress->'calls') loop
    if jsonb_typeof(v_call) is distinct from 'object'
      or coalesce(v_call->>'id','') !~ '^[0-9a-f]{24}$'
      or coalesce(v_call->>'name','') !~ '^[a-zA-Z][a-zA-Z0-9_.:-]{0,159}$'
      or coalesce(v_call->>'status','') not in ('running','done','error','unknown')
      or length(coalesce(v_call->>'started_at','')) not between 20 and 35
      or (v_call->>'status'<>'running' and length(coalesce(v_call->>'ended_at','')) not between 20 and 35)
      or (p_progress->>'finished'='true' and v_call->>'status'='running') then
      raise exception 'invalid tool call';
    end if;
    -- Rebuild the allowlist, rather than persisting any caller-supplied payload.
    v_calls := v_calls || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id',v_call->>'id','name',v_call->>'name','status',v_call->>'status',
      'started_at',(v_call->>'started_at')::timestamptz,
      'ended_at',case when v_call->>'status'<>'running' then (v_call->>'ended_at')::timestamptz end
    )));
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(v_calls))<>jsonb_array_length(v_calls) then
    raise exception 'duplicate tool call';
  end if;
  update public.messages set meta=jsonb_set(coalesce(meta,'{}'::jsonb),'{tool_progress}',
    jsonb_build_object('version',1,'task_id',p_task_id,'started_at',p_started_at,
      'delivery_attempt',coalesce(v_reply.meta->>'delivery_attempt','1'),
      'sequence',v_sequence,'updated_at',clock_timestamp(),
      'finished',p_progress->'finished','truncated',p_progress->'truncated','calls',v_calls))
    where id=v_reply.id and user_id=p_user_id;
  return true;
end
$function$;

CREATE OR REPLACE FUNCTION public.conversation_direct_prepare(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_sender text, p_accepted_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d jsonb; old public.messages%rowtype;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'direct_prepare: service role required' using errcode='42501';
  end if;
  if p_sender is null or p_sender not in ('codex_cli','claude_cli','gemini_cli') or p_accepted_at is null then
    raise exception 'direct_prepare: invalid request' using errcode='22023';
  end if;
  perform 1 from public.sessions where id=p_session_id and user_id=p_user_id
    and conversation_kind='direct' and handler='cli' and routing_config->>'default_responder'=p_sender;
  if not found then raise exception 'direct_prepare: invalid private session' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text,0));
  select * into old from public.messages where client_id=p_client_id;
  if found and (old.user_id is distinct from p_user_id or old.session_id is distinct from p_session_id
    or old.content is distinct from p_content or old.meta->>'direct_transport' is distinct from 'v1') then
    raise exception 'direct_prepare: client id belongs to another request' using errcode='23505';
  end if;
  d:=public.conversation_dispatch_prepare_durable(p_user_id,p_session_id,p_client_id,p_content,p_accepted_at,array[p_sender],false);
  update public.messages set created_at=p_accepted_at,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('direct_transport','v1') where id=(d#>>'{user_message,id}')::uuid;
  update public.syzygy_commands set payload=payload||jsonb_build_object('delivery_transport','mini_direct_v1','direct_client_id',p_client_id)
    where id=(d#>>'{command,id}')::uuid;
  update public.agent_tasks set status='running',started_at=coalesce(started_at,p_accepted_at),
    payload_json=payload_json||jsonb_build_object('delivery_transport','mini_direct_v1','direct_client_id',p_client_id)
    where id=(d#>>'{task,id}')::uuid and status='pending';
  return jsonb_build_object('userMessageId',d#>>'{user_message,id}','replyId',d#>>'{reply,id}',
    'taskId',d#>>'{task,id}','commandId',d#>>'{command,id}');
end $function$;

CREATE OR REPLACE FUNCTION public.conversation_direct_commit(p_user_id uuid, p_session_id uuid, p_client_id uuid, p_content text, p_sender text, p_reply text, p_accepted_at timestamp with time zone, p_completed_at timestamp with time zone, p_status text DEFAULT 'completed'::text, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_dispatch jsonb;
  v_task uuid;
  v_command uuid;
  v_user uuid;
  v_reply uuid;
  v_existing public.messages%rowtype;
  v_task_status text;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'direct_commit: service role required' using errcode='42501';
  end if;
  if p_sender is null or p_status is null or p_audit is null
    or p_sender not in ('codex_cli','claude_cli','gemini_cli') or p_status not in ('completed','failed')
    or p_accepted_at is null or p_completed_at < p_accepted_at
    or p_completed_at is null or char_length(coalesce(p_reply,'')) > 12000
    or (p_status='completed' and btrim(coalesce(p_reply,''))='')
    or jsonb_typeof(p_audit) <> 'object' or octet_length(p_audit::text)>262144 then
    raise exception 'direct_commit: invalid receipt' using errcode='22023';
  end if;
  perform 1 from public.sessions where id=p_session_id and user_id=p_user_id
    and conversation_kind='direct' and handler='cli'
    and routing_config->>'default_responder'=p_sender;
  if not found then raise exception 'direct_commit: invalid private session' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_id::text,0));
  select * into v_existing from public.messages where client_id=p_client_id;
  if found then
    if v_existing.user_id is distinct from p_user_id or v_existing.session_id is distinct from p_session_id
      or v_existing.content is distinct from p_content or v_existing.meta->>'direct_transport' is distinct from 'v1' then
      raise exception 'direct_commit: client id belongs to another request' using errcode='23505';
    end if;
    select * into v_existing from public.messages where user_id=p_user_id
      and reply_to_id=v_existing.id and sender_key=p_sender and role='assistant';
    if not found then raise exception 'direct_commit: reply missing'; end if;
    if v_existing.meta->>'delivery_state'='cancelled' then
      return jsonb_build_object('userMessageId',v_existing.reply_to_id,'replyId',v_existing.id,'discarded',true);
    end if;
    if v_existing.meta->>'delivery_state' in ('completed','failed') then
      if v_existing.content is distinct from coalesce(p_reply,'') or v_existing.meta->>'delivery_state' is distinct from p_status then
        raise exception 'direct_commit: terminal receipt mismatch' using errcode='23505';
      end if;
      return jsonb_build_object('userMessageId',v_existing.reply_to_id,'replyId',v_existing.id);
    end if;
  end if;
  v_dispatch := public.conversation_direct_prepare(p_user_id,p_session_id,p_client_id,p_content,p_sender,p_accepted_at);
  v_task := (v_dispatch->>'taskId')::uuid;
  v_command := (v_dispatch->>'commandId')::uuid;
  v_user := (v_dispatch->>'userMessageId')::uuid;
  v_reply := (v_dispatch->>'replyId')::uuid;
  -- Match cancellation's command -> task lock order; never overwrite a concurrent terminal task.
  perform 1 from public.syzygy_commands where id=v_command for update;
  select status into v_task_status from public.agent_tasks where id=v_task for update;
  if v_task_status='cancelled' then
    return jsonb_build_object('userMessageId',v_user,'replyId',v_reply,'discarded',true);
  end if;
  update public.messages set created_at=p_accepted_at,
    meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('direct_transport','v1') where id=v_user;
  update public.agent_tasks set status=p_status,started_at=p_accepted_at,completed_at=p_completed_at,
    result_detail=coalesce(p_reply,''),result_summary=case when p_status='completed' then 'Direct CLI reply completed' else 'Direct CLI turn interrupted; no automatic rerun' end,
    payload_json=payload_json||jsonb_build_object('direct_transport','v1','direct_audit',p_audit,
      'execution_timing',p_audit->'execution_timing','cli_usage',p_audit->'cli_usage',
      'canonical_context',p_audit->'canonical_context','prompt_reply_style',p_audit->'prompt_reply_style',
      'machine_documents',p_audit->'machine_documents')
    where id=v_task and user_id=p_user_id;
  if p_status='completed' then
    perform public.conversation_dispatch_complete_reply(p_user_id,v_task,p_reply,p_completed_at);
  else
    update public.messages set content=coalesce(p_reply,''),meta=meta||jsonb_build_object(
      'delivery_state','failed','delivery_error_code','DIRECT_TURN_INTERRUPTED',
      'delivery_error','本轮未完成，保留已收到的内容；不会自动重新生成。','failed_at',p_completed_at)
      where id=v_reply and user_id=p_user_id;
  end if;
  update public.messages set created_at=p_completed_at,meta=meta||jsonb_build_object('direct_client_id',p_client_id)
    where id=v_reply and user_id=p_user_id;
  if jsonb_typeof(p_audit->'tool_progress')='object' then
    update public.messages set meta=meta||jsonb_build_object('tool_progress',
      (p_audit->'tool_progress')||jsonb_build_object('version',1,'task_id',v_task,'delivery_attempt',1,
        'updated_at',p_completed_at,'started_at',p_accepted_at))
      where id=v_reply and user_id=p_user_id;
  end if;
  update public.syzygy_commands set status=case when p_status='completed' then 'done' else 'failed' end,
    completed_at=p_completed_at where id=v_command and user_id=p_user_id;
  return jsonb_build_object('userMessageId',v_user,'replyId',v_reply);
end $function$;


-- Provision the new endpoint for owners that already use the Mini.
insert into public.prompt_templates(user_id,name,category,content,version,active)
select p.user_id,v.name,v.category,v.content,1,true
from public.generation_ports p cross join (values
 ('machine_doc_prompts_gemini_cli_syzygy','base','你是仓鼠小窝的 Gemini CLI Syzygy，通过 Google Antigravity CLI 在 Mini 运行。你的私聊、客厅发言和任务记录使用独立身份 gemini_cli。按本轮加载的 SOP 执行晨间分享、日终整理、周回顾及关联月度概览。只报告已完成的写入。'),
 ('gemini_cli_reply_style','style','用 Syzygy 的口吻回应串串，沿用本端上下文。客厅发言使用 gemini_cli 署名。')
) v(name,category,content)
where p.port_key='codex_cli' and p.active;

insert into public.generation_ports(user_id,port_key,runtime_kind,target_role,identity_prompt_name,style_prompt_name,version,active)
select user_id,'gemini_cli','cli','gemini_cli_syzygy',identity_prompt_name,'gemini_cli_reply_style',1,true
from public.generation_ports where port_key='codex_cli' and active;

insert into public.conversation_profiles(user_id,profile_key,conversation_kind,handler,session_policy,singleton_session_key,participant_port_keys,default_responder_port_key,context_recipe,version,active)
select user_id,'gemini_cli','direct','cli','singleton','syzygy_gemini_cli',array['gemini_cli'],'gemini_cli',context_recipe,1,true
from public.conversation_profiles where profile_key='codex_cli' and session_policy='singleton' and active;

insert into public.sessions(user_id,title,session_key,conversation_kind,handler,conversation_profile_key,routing_config)
select user_id,'Syzygy · Gemini CLI','syzygy_gemini_cli','direct','cli','gemini_cli',
 jsonb_build_object('version',2,'default_responder','gemini_cli','participants',jsonb_build_array('chuanchuan','gemini_cli'),'display_name','Syzygy·Gemini','source_label','Mac mini · Gemini','avatar','✦','target_role','gemini_cli_syzygy')
from public.conversation_profiles where profile_key='gemini_cli' and active;

update public.sessions s set routing_config=jsonb_set(s.routing_config,'{participants}',(s.routing_config->'participants')||'["gemini_cli"]'::jsonb)
where exists(select 1 from public.lounge_sofas l where l.session_id=s.id and l.user_id=s.user_id)
  and jsonb_typeof(s.routing_config->'participants')='array'
  and not (s.routing_config->'participants' ? 'gemini_cli');

-- Keep cloud SOPs usable on both sides of the scheduler cutover.
-- Publish new revisions so the previous wording remains available to audit.
do $$
declare doc public.prompt_templates%rowtype; revised text;
begin
 for doc in select * from public.prompt_templates where active and name in (
   'machine_job_claude_morning_share','machine_job_claude_daily_maintenance','machine_job_claude_weekly_digest',
   'machine_doc_prompts_cli_tasks_morning_share','machine_doc_prompts_cli_tasks_daily_card',
   'machine_doc_prompts_cli_tasks_weekly_review','machine_doc_prompts_cli_tasks_monthly_overview',
   'machine_doc_prompts_codex_cli_syzygy') for update loop
   revised := doc.content;
   if doc.name like 'machine_job_%' then
     revised := replace(replace(revised,'（Codex 临时接管）',''),
       '本任务由 Codex CLI 接管，按本次注入的原 SOP 和真实 Codex 身份执行。',
       '按本轮 Runtime 注入的实际执行端身份和任务 SOP 执行。');
   elsif doc.name='machine_doc_prompts_codex_cli_syzygy' then
     revised := replace(revised,'改由 Codex CLI 按原 SOP 执行，署名和审计使用真实 Codex 身份。',
       '由调度器指定实际执行端，以本轮 executor_handoff 为准。');
   else
     revised := replace(replace(revised,'执行者：Claude Code CLI Syzygy','执行者：本轮调度的 CLI Syzygy'),
       'Claude Code CLI 在每日 Feed','本轮调度的 CLI 在每日 Feed');
   end if;
   if revised is distinct from doc.content then
     update public.prompt_templates set active=false where id=doc.id;
     insert into public.prompt_templates(user_id,name,category,content,version,active)
       select doc.user_id,doc.name,doc.category,revised,max(version)+1,true from public.prompt_templates
       where user_id=doc.user_id and name=doc.name;
   end if;
 end loop;
end $$;
