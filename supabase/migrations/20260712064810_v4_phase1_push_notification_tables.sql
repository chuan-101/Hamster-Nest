-- ============================================================
-- V4.0 Phase 1 · 推送通知闭环：device_tokens / agent_events / notification_events
-- 依据：v4-expo-native-app-plan.md 附录 A（2026-07-11 第四审定稿版）之 Phase 1 范围；
--       approval_requests / agent_heartbeats / respond_to_approval RPC 属 Phase 2，不在本迁移。
-- 规范：docs/security-boundary.md（2026-07-06）加表守则——
--       出生即 RLS、零 anon 策略、authenticated 统一 (select auth.uid()) = user_id 谓词。
--       service_role 天然 bypassrls，不为其建策略。
-- ============================================================

-- 1. device_tokens：原生推送 token + 设备注册（与 push_subscriptions 的边界见主方案 6.2 裁定）
create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  platform text not null check (platform in ('ios','android','web')),
  device_name text,
  expo_push_token text not null,
  native_push_token text,
  app_version text,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

comment on table public.device_tokens is
  '原生推送地址 + 设备注册表（V4.0 新建）。Web Push 订阅继续走 push_subscriptions，V4.1+ 再评估统一。';
comment on column public.device_tokens.platform is
  'V4.0 只写 ios/android；web 仅为未来统一设备表预留，V4.0 不写 web 行。';

alter table public.device_tokens enable row level security;

create policy device_tokens_select_own on public.device_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy device_tokens_insert_own on public.device_tokens
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy device_tokens_update_own on public.device_tokens
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy device_tokens_delete_own on public.device_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- 2. agent_events：多端事件流（事实日志，仅追加；bigint 自增 id 供 last_seen_event_id 补账）
create table public.agent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  actor text not null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  importance text not null default 'normal'
    check (importance in ('low','normal','high','urgent')),
  created_at timestamptz not null default now()
);

comment on table public.agent_events is
  '多端事件流（事实日志）。V4.0 仅追加不删除，归档/保留策略 V4.1 议定；任何端写入即可能触发 push-dispatch 推送。';

create index agent_events_user_created_idx on public.agent_events (user_id, id desc);

alter table public.agent_events enable row level security;

create policy agent_events_select_own on public.agent_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy agent_events_insert_own on public.agent_events
  for insert to authenticated with check (user_id = (select auth.uid()));
-- 事实日志：不建 authenticated UPDATE/DELETE 策略；Agent 侧写入走 service_role。

-- 3. notification_events：通知尝试审计日志（queued/sent/failed/skipped 全记录）
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  agent_event_id bigint references public.agent_events(id),
  channel text not null check (channel in ('expo_push','wechat_bridge','email','local')),
  status text not null default 'queued'
    check (status in ('queued','sent','failed','skipped')),
  target text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notification_events is
  '通知尝试审计日志。客户端只读；写入全部由 service_role（push-dispatch / Mac mini 对账 sweep）完成。';

-- 对账 sweep 按 agent_event_id 反查漏发；FK 覆盖索引沿用 2026-07-06 惯例
create index notification_events_agent_event_idx on public.notification_events (agent_event_id);
create index notification_events_user_created_idx on public.notification_events (user_id, created_at desc);

alter table public.notification_events enable row level security;

create policy notification_events_select_own on public.notification_events
  for select to authenticated using (user_id = (select auth.uid()));
-- 只读给 authenticated；无 INSERT/UPDATE/DELETE 策略。

-- 4. Realtime：App 前台 postgres_changes 订阅 agent_events（approval_requests 随 Phase 2 加入）
alter publication supabase_realtime add table public.agent_events;
