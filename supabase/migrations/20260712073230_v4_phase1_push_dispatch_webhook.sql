-- ============================================================
-- V4.0 Phase 1 · 5.3 push-dispatch 发送侧：
-- notification_events receipts 回查列 + pg_net + agent_events AFTER INSERT webhook
-- 密钥策略：webhook 密钥存 Vault（push_dispatch_secret），迁移文件零密钥内容。
-- ============================================================

-- 1. notification_events 增补 Expo ticket 关联与 receipts 回查标记（清单 5.3）
alter table public.notification_events add column ticket_id text;
alter table public.notification_events add column receipt_checked_at timestamptz;

comment on column public.notification_events.ticket_id is
  'Expo push ticket id，供 receipts 回查（清单 5.3）；仅 status=sent 行有值。';
comment on column public.notification_events.receipt_checked_at is
  'receipts 回查完成时间；null = 已发送但尚未回查。';

-- 回查扫描专用部分索引：只覆盖「已发送未回查」的窄集合
create index notification_events_receipt_pending_idx
  on public.notification_events (sent_at)
  where status = 'sent' and receipt_checked_at is null;

-- 2. pg_net：Database Webhook 所需（首次启用）
create extension if not exists pg_net;

-- 3. agent_events AFTER INSERT → push-dispatch Edge Function
--    密钥运行时从 Vault 读取；事件写入不因通知链路失败而回滚，
--    漏发由 Mac mini 对账 sweep 幂等补调（清单 5.3）。
create or replace function public.notify_push_dispatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'push_dispatch_secret'
   limit 1;
  if v_secret is null then
    raise warning 'notify_push_dispatch: vault secret push_dispatch_secret missing, skip';
    return new;
  end if;
  perform net.http_post(
    url := 'https://crfhiumxzmaszkapanrb.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-dispatch-secret', v_secret
    ),
    body := jsonb_build_object('record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );
  return new;
exception
  when others then
    raise warning 'notify_push_dispatch failed: %', sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_push_dispatch() from public;

create trigger agent_events_push_dispatch
  after insert on public.agent_events
  for each row
  execute function public.notify_push_dispatch();

-- 4. push-dispatch 函数侧密钥读取通道：service_role 专属 RPC。
--    密钥唯一存 Vault，函数运行时读取比对（timing-safe），轮换只改 Vault 一处；
--    Mac mini sweep 亦经此 RPC 取密钥后调用函数。零 anon / 零 authenticated。
create or replace function public.get_push_dispatch_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'push_dispatch_secret'
   limit 1;
$$;

revoke all on function public.get_push_dispatch_secret() from public, anon, authenticated;
grant execute on function public.get_push_dispatch_secret() to service_role;
