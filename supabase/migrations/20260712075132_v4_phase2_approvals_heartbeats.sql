-- ============================================================
-- V4.0 Phase 2 · 审批与执行回流：approval_requests / respond_to_approval RPC / agent_heartbeats
-- 依据：v4-expo-native-app-plan.md 附录 A（2026-07-11 第四审定稿版）之 Phase 2 范围。
-- 安全要点（第四审 F 系列裁定，不得削弱）：
--   * approval_requests 是敏感表（写入权即执行权）：authenticated 只开 SELECT，
--     不开 INSERT / 裸 UPDATE / DELETE；审批只由 Agent（service_role）发起；
--   * 串串的响应必须走 respond_to_approval RPC——SECURITY DEFINER + 固定
--     search_path + 校验 auth.uid() / pending / 过期，原子写 responded_at；
--   * RPC 默认 REVOKE PUBLIC，仅 GRANT authenticated。
-- ============================================================

-- 1. approval_requests：运行时轻审批
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source_actor text not null,
  title text not null,
  description text,
  proposed_action jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired','cancelled')),
  response_note text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

comment on table public.approval_requests is
  '运行时轻审批（敏感表：写入权即执行权）。Agent 经 service_role 发起；客户端只读，响应走 respond_to_approval RPC。';

-- 审批列表按 (user, status, 时间) 查询
create index approval_requests_user_status_idx
  on public.approval_requests (user_id, status, created_at desc);

alter table public.approval_requests enable row level security;

create policy approval_requests_select_own on public.approval_requests
  for select to authenticated using (user_id = (select auth.uid()));
-- 不给 authenticated INSERT/UPDATE/DELETE：客户端不可修改 proposed_action 等敏感列。

-- 2. respond_to_approval：审批响应唯一入口
create or replace function public.respond_to_approval(
  p_id uuid,
  p_decision text,
  p_note text default null
) returns public.approval_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.approval_requests;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision';
  end if;

  update public.approval_requests
     set status = p_decision,
         response_note = coalesce(p_note, response_note),
         responded_at = now()
   where id = p_id
     and user_id = (select auth.uid())
     and status = 'pending'
     and (expires_at is null or expires_at > now())
  returning * into v_row;

  if not found then
    raise exception 'approval not pending, expired, or not found';
  end if;

  return v_row;
end;
$$;

-- 施工评审修正（2026-07-12）：Supabase 默认权限会给 anon 直接授 EXECUTE（不经 PUBLIC），
-- 附录 A 仅 revoke from public 不足以挡 anon，必须显式撤销。
revoke execute on function public.respond_to_approval(uuid, text, text) from public, anon;
grant execute on function public.respond_to_approval(uuid, text, text) to authenticated;

-- 3. agent_heartbeats：多端 Syzygy 心跳（高频更新走轮询/节流，不进 realtime publication）
create table public.agent_heartbeats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  agent_id text not null,
  agent_type text not null,
  status text not null
    check (status in ('online','idle','working','waiting_approval','failed','offline')),
  last_task text,
  metadata jsonb not null default '{}'::jsonb,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, agent_id)
);

comment on table public.agent_heartbeats is
  '多端 Syzygy 心跳（Presence 数据源）。expo_app/web 以 authenticated 上报自身心跳；CLI 各端走 service_role。高频 UPDATE，客户端轮询 30–60s，不订阅。';

alter table public.agent_heartbeats enable row level security;

create policy agent_heartbeats_select_own on public.agent_heartbeats
  for select to authenticated using (user_id = (select auth.uid()));
create policy agent_heartbeats_upsert_own on public.agent_heartbeats
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy agent_heartbeats_update_own on public.agent_heartbeats
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 4. Realtime：App 前台 postgres_changes 订阅 approval_requests（agent_events 已在 Phase 1 登记）
alter publication supabase_realtime add table public.approval_requests;
