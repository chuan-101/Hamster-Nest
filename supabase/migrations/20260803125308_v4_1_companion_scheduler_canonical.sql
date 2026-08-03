-- V4.1 W1 / W3: canonical proactive companion publishing.
--
-- Local expand slice only:
-- - checkin_logs gains nullable canonical audit links for existing rows;
-- - one service-role-only RPC publishes one message, one event, and one audit row;
-- - the active app_companion profile/port/Prompt/model contract is revalidated
--   in the same transaction that publishes the canonical facts.

set lock_timeout = '5s';
set statement_timeout = '2min';

-- ── Durable checkin audit links ──────────────────────────────────────────────

alter table public.checkin_logs
  add column if not exists canonical_message_id uuid,
  add column if not exists canonical_event_id bigint,
  add column if not exists idempotency_key text,
  add column if not exists topic_fingerprint text,
  add column if not exists generation_audit jsonb not null default '{}'::jsonb;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'checkin_logs_canonical_message_fkey'
      and conrelid = 'public.checkin_logs'::regclass
  ) then
    alter table public.checkin_logs
      add constraint checkin_logs_canonical_message_fkey
      foreign key (canonical_message_id)
      references public.messages (id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'checkin_logs_canonical_event_fkey'
      and conrelid = 'public.checkin_logs'::regclass
  ) then
    alter table public.checkin_logs
      add constraint checkin_logs_canonical_event_fkey
      foreign key (canonical_event_id)
      references public.agent_events (id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'checkin_logs_idempotency_key_nonempty_check'
      and conrelid = 'public.checkin_logs'::regclass
  ) then
    alter table public.checkin_logs
      add constraint checkin_logs_idempotency_key_nonempty_check
      check (idempotency_key is null or btrim(idempotency_key) <> '')
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'checkin_logs_topic_fingerprint_nonempty_check'
      and conrelid = 'public.checkin_logs'::regclass
  ) then
    alter table public.checkin_logs
      add constraint checkin_logs_topic_fingerprint_nonempty_check
      check (topic_fingerprint is null or btrim(topic_fingerprint) <> '')
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'checkin_logs_generation_audit_object_check'
      and conrelid = 'public.checkin_logs'::regclass
  ) then
    alter table public.checkin_logs
      add constraint checkin_logs_generation_audit_object_check
      check (jsonb_typeof(generation_audit) = 'object')
      not valid;
  end if;
end
$constraints$;

alter table public.checkin_logs
  validate constraint checkin_logs_canonical_message_fkey,
  validate constraint checkin_logs_canonical_event_fkey,
  validate constraint checkin_logs_idempotency_key_nonempty_check,
  validate constraint checkin_logs_topic_fingerprint_nonempty_check,
  validate constraint checkin_logs_generation_audit_object_check;

create unique index if not exists checkin_logs_user_idempotency_unique
  on public.checkin_logs (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists checkin_logs_canonical_message_idx
  on public.checkin_logs (canonical_message_id)
  where canonical_message_id is not null;

create index if not exists checkin_logs_canonical_event_idx
  on public.checkin_logs (canonical_event_id)
  where canonical_event_id is not null;

comment on column public.checkin_logs.canonical_message_id is
  'Canonical proactive companion message produced by this checkin decision.';
comment on column public.checkin_logs.canonical_event_id is
  'Pushable agent event atomically paired with the canonical proactive message.';
comment on column public.checkin_logs.idempotency_key is
  'Stable scheduler retry key; companion:v1:<client UUID> for canonical publishes.';
comment on column public.checkin_logs.topic_fingerprint is
  'Non-content fingerprint used by the scheduler to avoid repetitive proactive topics.';
comment on column public.checkin_logs.generation_audit is
  'Resolved profile, port, Prompt, model, and context-window versions used for generation.';

-- ── One canonical proactive fact per client UUID ─────────────────────────────

create unique index if not exists agent_events_companion_proactive_published_unique
  on public.agent_events (user_id, event_type, entity_id)
  where event_type = 'companion_proactive_published'
    and entity_id is not null;

comment on index public.agent_events_companion_proactive_published_unique is
  'At most one pushable proactive companion event per canonical message.';

create or replace function public.conversation_companion_publish_proactive(
  p_user_id uuid,
  p_client_id uuid,
  p_content text,
  p_generated_at timestamptz,
  p_model text,
  p_input_summary text,
  p_raw_output text,
  p_tokens_used integer,
  p_topic_fingerprint text,
  p_generation_audit jsonb,
  p_importance text default 'normal'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_session public.sessions%rowtype;
  v_profile public.conversation_profiles%rowtype;
  v_port public.generation_ports%rowtype;
  v_identity_prompt public.prompt_templates%rowtype;
  v_style_prompt public.prompt_templates%rowtype;
  v_scenario_prompt public.prompt_templates%rowtype;
  v_message public.messages%rowtype;
  v_event public.agent_events%rowtype;
  v_checkin public.checkin_logs%rowtype;
  v_generated_at timestamptz := coalesce(p_generated_at, now());
  v_content text := coalesce(p_content, '');
  v_model text := btrim(coalesce(p_model, ''));
  v_topic_fingerprint text := btrim(coalesce(p_topic_fingerprint, ''));
  v_importance text := lower(btrim(coalesce(p_importance, 'normal')));
  v_idempotency_key text;
  v_active_model text;
  v_generation_audit jsonb;
  v_message_meta jsonb;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception using
      errcode = '42501',
      message = 'conversation_companion_publish_proactive: service role required';
  end if;

  if p_user_id is null or p_client_id is null then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: user_id and client_id are required';
  end if;

  if btrim(v_content) = '' or char_length(v_content) > 12000 then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: content must contain 1 to 12000 characters';
  end if;

  if v_model = ''
     or v_topic_fingerprint = ''
     or p_generation_audit is null
     or jsonb_typeof(p_generation_audit) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: model, topic fingerprint, and generation audit are required';
  end if;

  if p_tokens_used is not null and p_tokens_used < 0 then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: tokens_used must be nonnegative';
  end if;

  if v_importance not in ('low', 'normal', 'high', 'urgent') then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: invalid importance';
  end if;

  select *
  into v_profile
  from public.conversation_profiles
  where user_id = p_user_id
    and profile_key = 'app_companion'
    and active
    and conversation_kind = 'direct'
    and handler = 'api'
    and session_policy = 'singleton'
    and singleton_session_key = 'syzygy_companion';

  if not found
     or cardinality(v_profile.participant_port_keys) <> 1
     or v_profile.default_responder_port_key <> 'app_companion'
     or v_profile.participant_port_keys[1] <> 'app_companion' then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active app_companion profile contract not found';
  end if;

  if v_profile.context_recipe ->> 'history_scope' <> 'current_session'
     or v_profile.context_recipe ->> 'selection' <> 'newest_within_token_budget'
     or v_profile.context_recipe ->> 'epoch' <> 'asia_shanghai_day'
     or jsonb_typeof(v_profile.context_recipe -> 'external_sources') <> 'array' then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active context recipe is outside the V4.1 companion boundary';
  end if;

  select *
  into v_session
  from public.sessions
  where user_id = p_user_id
    and session_key = 'syzygy_companion'
    and conversation_profile_key = 'app_companion'
    and conversation_kind = 'direct'
    and handler = 'api'
    and not is_archived;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'conversation_companion_publish_proactive: canonical companion session not found';
  end if;

  if v_session.routing_config ->> 'default_responder' <> 'app_companion'
     or not coalesce(v_session.routing_config -> 'participants', '[]'::jsonb) ? 'chuanchuan'
     or not coalesce(v_session.routing_config -> 'participants', '[]'::jsonb) ? 'app_companion' then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: canonical companion routing contract is invalid';
  end if;

  select *
  into v_port
  from public.generation_ports
  where user_id = p_user_id
    and port_key = v_profile.default_responder_port_key
    and active
    and runtime_kind = 'api';

  if not found or v_port.model_channel_name is null then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active API generation port not found';
  end if;

  select active_model
  into v_active_model
  from public.channel_config
  where user_id = p_user_id
    and channel_name = v_port.model_channel_name;

  if not found or btrim(coalesce(v_active_model, '')) = '' then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active model channel not found';
  end if;

  select *
  into v_identity_prompt
  from public.prompt_templates
  where user_id = p_user_id
    and name = v_port.identity_prompt_name
    and active;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active identity Prompt not found';
  end if;

  if v_port.style_prompt_name is not null then
    select *
    into v_style_prompt
    from public.prompt_templates
    where user_id = p_user_id
      and name = v_port.style_prompt_name
      and active;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'conversation_companion_publish_proactive: active style Prompt not found';
    end if;
  end if;

  if p_generation_audit ->> 'scenario_prompt_name' not in ('checkin_day', 'checkin_night') then
    raise exception using
      errcode = '22023',
      message = 'conversation_companion_publish_proactive: invalid checkin scenario Prompt';
  end if;

  select *
  into v_scenario_prompt
  from public.prompt_templates
  where user_id = p_user_id
    and name = p_generation_audit ->> 'scenario_prompt_name'
    and active;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'conversation_companion_publish_proactive: active checkin scenario Prompt not found';
  end if;

  if p_generation_audit ->> 'model' is distinct from v_active_model
     or coalesce((p_generation_audit ->> 'profile_version')::integer, -1) <> v_profile.version
     or coalesce((p_generation_audit ->> 'port_version')::integer, -1) <> v_port.version
     or coalesce((p_generation_audit ->> 'identity_prompt_version')::integer, -1) <> v_identity_prompt.version
     or coalesce((p_generation_audit ->> 'scenario_prompt_version')::integer, -1) <> v_scenario_prompt.version
     or (
       v_style_prompt.id is null
       and p_generation_audit -> 'style_prompt_version' is not null
       and p_generation_audit -> 'style_prompt_version' <> 'null'::jsonb
     )
     or (
       v_style_prompt.id is not null
       and coalesce((p_generation_audit ->> 'style_prompt_version')::integer, -1) <> v_style_prompt.version
     ) then
    raise exception using
      errcode = '40001',
      message = 'conversation_companion_publish_proactive: generation contract changed before publish';
  end if;

  if v_model is distinct from v_active_model then
    raise exception using
      errcode = '40001',
      message = 'conversation_companion_publish_proactive: generated model no longer matches active model';
  end if;

  v_idempotency_key := 'companion:v1:' || p_client_id::text;
  v_generation_audit := jsonb_build_object(
    'schema_version', 1,
    'model', v_active_model,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'key', v_profile.profile_key,
      'version', v_profile.version,
      'context_recipe', v_profile.context_recipe
    ),
    'port', jsonb_build_object(
      'id', v_port.id,
      'key', v_port.port_key,
      'version', v_port.version,
      'model_channel_name', v_port.model_channel_name
    ),
    'prompts', jsonb_build_object(
      'identity', jsonb_build_object(
        'id', v_identity_prompt.id,
        'name', v_identity_prompt.name,
        'version', v_identity_prompt.version
      ),
      'style', case
        when v_style_prompt.id is null then null
        else jsonb_build_object(
          'id', v_style_prompt.id,
          'name', v_style_prompt.name,
          'version', v_style_prompt.version
        )
      end,
      'scenario', jsonb_build_object(
        'id', v_scenario_prompt.id,
        'name', v_scenario_prompt.name,
        'version', v_scenario_prompt.version
      )
    ),
    'context', coalesce(p_generation_audit -> 'context', '{}'::jsonb)
  );

  v_message_meta := jsonb_build_object(
    'schema_version', 1,
    'source', 'companion_scheduler',
    'delivery_state', 'completed',
    'generated_at', v_generated_at,
    'idempotency_key', v_idempotency_key,
    'topic_fingerprint', v_topic_fingerprint,
    'generation', v_generation_audit
  );

  insert into public.messages (
    user_id,
    session_id,
    role,
    sender_key,
    reply_to_id,
    target_sender_keys,
    content,
    client_id,
    client_created_at,
    meta
  )
  values (
    p_user_id,
    v_session.id,
    'assistant',
    'app_companion',
    null,
    null,
    v_content,
    p_client_id,
    v_generated_at,
    v_message_meta
  )
  on conflict (client_id) where client_id is not null
  do nothing
  returning *
  into v_message;

  if v_message.id is null then
    select *
    into v_message
    from public.messages
    where client_id = p_client_id;

    if not found
       or v_message.user_id is distinct from p_user_id
       or v_message.session_id is distinct from v_session.id
       or v_message.role is distinct from 'assistant'
       or v_message.sender_key is distinct from 'app_companion'
       or v_message.reply_to_id is not null
       or v_message.content is distinct from v_content
       or v_message.client_created_at is distinct from v_generated_at
       or v_message.meta is distinct from v_message_meta then
      raise exception using
        errcode = '23505',
        message = 'conversation_companion_publish_proactive: client_id was already used with a different publish contract';
    end if;
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
    'app_companion',
    'companion_proactive_published',
    'conversation_message',
    v_message.id,
    'Syzygy 来找你啦',
    jsonb_build_object(
      'schema_version', 1,
      'screen', 'conversation_detail',
      'params', jsonb_build_object('id', v_session.id),
      'url', format('/#/chat?session=%s', v_session.id),
      'session_id', v_session.id,
      'message_id', v_message.id,
      'sender_key', 'app_companion',
      'source', 'companion_scheduler'
    ),
    v_importance
  )
  on conflict (user_id, event_type, entity_id)
    where event_type = 'companion_proactive_published'
      and entity_id is not null
  do nothing
  returning *
  into v_event;

  if v_event.id is null then
    select *
    into v_event
    from public.agent_events
    where user_id = p_user_id
      and event_type = 'companion_proactive_published'
      and entity_id = v_message.id;
  end if;

  insert into public.checkin_logs (
    user_id,
    checkin_time,
    model,
    input_summary,
    raw_output,
    decision,
    tokens_used,
    canonical_message_id,
    canonical_event_id,
    idempotency_key,
    topic_fingerprint,
    generation_audit
  )
  values (
    p_user_id,
    v_generated_at,
    v_active_model,
    nullif(btrim(coalesce(p_input_summary, '')), ''),
    nullif(btrim(coalesce(p_raw_output, '')), ''),
    'sent',
    p_tokens_used,
    v_message.id,
    v_event.id,
    v_idempotency_key,
    v_topic_fingerprint,
    v_generation_audit
  )
  on conflict (user_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning *
  into v_checkin;

  if v_checkin.id is null then
    select *
    into v_checkin
    from public.checkin_logs
    where user_id = p_user_id
      and idempotency_key = v_idempotency_key;

    if not found
       or v_checkin.decision is distinct from 'sent'
       or v_checkin.canonical_message_id is distinct from v_message.id
       or v_checkin.canonical_event_id is distinct from v_event.id
       or v_checkin.model is distinct from v_active_model
       or v_checkin.topic_fingerprint is distinct from v_topic_fingerprint
       or v_checkin.generation_audit is distinct from v_generation_audit then
      raise exception using
        errcode = '23505',
        message = 'conversation_companion_publish_proactive: idempotency key was already used with a different audit contract';
    end if;
  end if;

  return jsonb_build_object(
    'schema_version', 1,
    'idempotency_key', v_idempotency_key,
    'message', jsonb_build_object(
      'id', v_message.id,
      'session_id', v_message.session_id,
      'client_id', v_message.client_id,
      'sender_key', v_message.sender_key,
      'created_at', v_message.created_at
    ),
    'event', jsonb_build_object(
      'id', v_event.id,
      'event_type', v_event.event_type
    ),
    'checkin_log', jsonb_build_object(
      'id', v_checkin.id,
      'decision', v_checkin.decision
    )
  );
end
$function$;

revoke all on function public.conversation_companion_publish_proactive(
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  text,
  text,
  integer,
  text,
  jsonb,
  text
) from public, anon, authenticated;

grant execute on function public.conversation_companion_publish_proactive(
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  text,
  text,
  integer,
  text,
  jsonb,
  text
) to service_role;

-- ── Migration assertions ─────────────────────────────────────────────────────

do $assertions$
begin
  if has_function_privilege(
    'anon',
    'public.conversation_companion_publish_proactive(uuid,uuid,text,timestamptz,text,text,text,integer,text,jsonb,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.conversation_companion_publish_proactive(uuid,uuid,text,timestamptz,text,text,text,integer,text,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'Companion proactive publisher must remain service-role only';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.conversation_companion_publish_proactive(uuid,uuid,text,timestamptz,text,text,text,integer,text,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'Service role cannot execute companion proactive publisher';
  end if;
end
$assertions$;
