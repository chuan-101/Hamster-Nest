-- Only new human-facing content is enqueued. No historical backfill or body in push payloads.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table app_private.feed_notification_outbox (
  feed_id uuid primary key references public.agent_feed_items(id) on delete cascade,
  queued_at timestamptz not null default now(),
  processed_at timestamptz,
  event_id bigint references public.agent_events(id),
  outcome text check (outcome in ('sent_to_dispatch', 'skipped'))
);
alter table app_private.feed_notification_outbox enable row level security;
revoke all on app_private.feed_notification_outbox from public, anon, authenticated;
create index feed_notification_pending_idx on app_private.feed_notification_outbox (queued_at)
  where processed_at is null;

-- Row locks serialize cron/trigger races. Existing push-dispatch supplies device routing,
-- receipts, quota and Beijing quiet hours; feed content never enters the lock-screen payload.
create or replace function public.dispatch_feed_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  pushed_id bigint;
  delivered integer := 0;
begin
  for candidate in
    select q.feed_id, f.user_id, f.type, f.status, f.content, f.expires_at
    from app_private.feed_notification_outbox q
    join public.agent_feed_items f on f.id = q.feed_id
    where q.processed_at is null and f.visible_from <= now()
    order by q.queued_at
    limit 100
    for update of q skip locked
  loop
    if candidate.type not in ('morning_share', 'daily_card')
      or candidate.status <> 'unread'
      or length(btrim(coalesce(candidate.content, ''))) = 0
      or candidate.expires_at <= now() then
      update app_private.feed_notification_outbox set processed_at = now(), outcome = 'skipped'
        where feed_id = candidate.feed_id;
      continue;
    end if;
    insert into public.agent_events
      (user_id, actor, event_type, entity_type, entity_id, title, payload, importance)
    values (
      candidate.user_id, 'system', 'feed_content_published', 'agent_feed_item', candidate.feed_id,
      case when candidate.type = 'morning_share' then 'Syzygy 的晨间分享已送达' else 'Syzygy 的日总结已送达' end,
      jsonb_build_object('screen', 'feed', 'params', jsonb_build_object('id', candidate.feed_id), 'url', '/#/agent-feed'),
      'high'
    ) returning id into pushed_id;
    update app_private.feed_notification_outbox set processed_at = now(), event_id = pushed_id, outcome = 'sent_to_dispatch'
      where feed_id = candidate.feed_id;
    delivered := delivered + 1;
  end loop;
  return delivered;
end;
$$;
revoke all on function public.dispatch_feed_notifications() from public, anon, authenticated;

create or replace function public.enqueue_feed_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.type not in ('morning_share', 'daily_card') or new.status <> 'unread'
    or length(btrim(coalesce(new.content, ''))) = 0 then return new; end if;
  -- Editing an already published letter, read/archive actions and historical updates are silent.
  if tg_op = 'UPDATE' and old.type in ('morning_share', 'daily_card')
    and length(btrim(coalesce(old.content, ''))) > 0 then return new; end if;
  insert into app_private.feed_notification_outbox (feed_id) values (new.id) on conflict do nothing;
  perform public.dispatch_feed_notifications();
  return new;
end;
$$;
revoke all on function public.enqueue_feed_notification() from public, anon, authenticated;
create trigger agent_feed_content_notification after insert or update of content, type on public.agent_feed_items
  for each row execute function public.enqueue_feed_notification();

-- Scheduled visibility survives App termination and does not need a Mini service restart.
create extension if not exists pg_cron;
select cron.schedule('feed-content-notifications', '* * * * *', 'select public.dispatch_feed_notifications();');
