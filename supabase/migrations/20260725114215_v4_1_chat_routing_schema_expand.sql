-- V4.1 W0 / 2.2: expand-only chat routing contract.
-- Existing App/Web clients must keep working until conversation-dispatch replaces
-- direct message inserts, so sender_key remains nullable during the expand window.

set lock_timeout = '5s';
set statement_timeout = '2min';

-- ── sessions: stable machine identity + routing mode ──────────────────────────

alter table public.sessions
  add column if not exists session_key text,
  add column if not exists conversation_kind text,
  add column if not exists handler text,
  add column if not exists routing_config jsonb;

update public.sessions
set
  conversation_kind = coalesce(conversation_kind, 'direct'),
  handler = coalesce(handler, 'api'),
  routing_config = coalesce(
    routing_config,
    '{
      "version": 1,
      "participants": ["chuanchuan", "syzygy_instant"],
      "default_responder": "syzygy_instant"
    }'::jsonb
  )
where conversation_kind is null
   or handler is null
   or routing_config is null;

alter table public.sessions
  alter column conversation_kind set default 'direct',
  alter column conversation_kind set not null,
  alter column handler set default 'api',
  alter column handler set not null,
  alter column routing_config set default '{
    "version": 1,
    "participants": ["chuanchuan", "syzygy_instant"],
    "default_responder": "syzygy_instant"
  }'::jsonb,
  alter column routing_config set not null;

alter table public.sessions
  add constraint sessions_session_key_nonempty_check
    check (session_key is null or btrim(session_key) <> '') not valid,
  add constraint sessions_conversation_handler_check
    check (
      (conversation_kind = 'direct' and handler in ('api', 'cli'))
      or (conversation_kind = 'group' and handler = 'router')
    ) not valid,
  add constraint sessions_routing_config_object_check
    check (jsonb_typeof(routing_config) = 'object') not valid;

alter table public.sessions
  validate constraint sessions_session_key_nonempty_check,
  validate constraint sessions_conversation_handler_check,
  validate constraint sessions_routing_config_object_check;

create unique index sessions_user_id_session_key_unique
  on public.sessions (user_id, session_key)
  where session_key is not null;

comment on column public.sessions.session_key is
  'Stable machine key. Display names live in routing_config and may change independently.';
comment on column public.sessions.conversation_kind is
  'Routing shape: direct or group.';
comment on column public.sessions.handler is
  'Server-side handler: api/cli for direct sessions, router for group sessions.';
comment on column public.sessions.routing_config is
  'Versioned routing metadata: participant sender keys, default responder, and display hints.';

-- ── messages: stable sender + typed reply/target intent ───────────────────────

alter table public.messages
  add column if not exists sender_key text,
  add column if not exists reply_to_id uuid,
  add column if not exists target_sender_keys text[];

update public.messages
set sender_key = case
  when role = 'user' then 'chuanchuan'
  when role = 'assistant' then 'syzygy_instant'
  else coalesce(
    nullif(
      trim(both '_' from regexp_replace(lower(role), '[^a-z0-9]+', '_', 'g')),
      ''
    ),
    'unknown'
  )
end
where sender_key is null;

alter table public.messages
  add constraint messages_sender_key_nonempty_check
    check (sender_key is null or btrim(sender_key) <> '') not valid,
  add constraint messages_reply_to_id_not_self_check
    check (reply_to_id is null or reply_to_id <> id) not valid,
  add constraint messages_session_id_id_unique
    unique (session_id, id),
  add constraint messages_reply_same_session_fkey
    foreign key (session_id, reply_to_id)
    references public.messages (session_id, id)
    on update cascade
    on delete restrict
    deferrable initially immediate
    not valid;

alter table public.messages
  validate constraint messages_sender_key_nonempty_check,
  validate constraint messages_reply_to_id_not_self_check,
  validate constraint messages_reply_same_session_fkey;

create index messages_reply_to_id_idx
  on public.messages (reply_to_id);

create unique index messages_assistant_reply_responder_unique
  on public.messages (session_id, reply_to_id, sender_key)
  where role = 'assistant' and reply_to_id is not null;

comment on column public.messages.sender_key is
  'Stable sender identity within routing_config.participants; nullable only during the legacy-client expand window.';
comment on column public.messages.reply_to_id is
  'Typed reply target constrained to a message in the same session.';
comment on column public.messages.target_sender_keys is
  'Explicit responder targets resolved against routing_config.participants by conversation-dispatch.';

-- ── current context: deterministic owner/type upsert target ───────────────────

do $$
begin
  if exists (
    select 1
    from public.current_context_snapshot
    group by user_id, snapshot_type
    having count(*) > 1
  ) then
    raise exception
      'current_context_snapshot contains duplicate (user_id, snapshot_type) rows';
  end if;
end
$$;

create unique index current_context_snapshot_user_type_unique
  on public.current_context_snapshot (user_id, snapshot_type);

-- ── Realtime: foreground accelerator only; clients still reconcile on resume ─

do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'supabase_realtime publication does not exist';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end
$$;
