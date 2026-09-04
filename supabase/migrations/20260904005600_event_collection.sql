-- 事件集（纪事本末体的线程记录层）
--
-- 背景：Memo 被各端写成了"进度日志"（读书进度、项目测试发现、交接状态、鼠窝 Phase 进度），
-- 每个实例开窗口都要读一大堆与当前对话无关的上下文。裁决口诀里缺一格："正在进行、有起止、
-- 频繁更新、但只在对话碰到它时才需要读"的线程。事件集填这一格：按事分篇、一事从起到结。
-- 口诀新增一句：线程进事件集。
--
-- 两层模型：
--   event_threads  大类 / 事件线：一件正在进行的事（标题 + 一行"当前状态" + 进行中/已结束 + 起止日 + 可选 emoji 分组）
--   event_entries  条目：大类下按日期排列的事件行（日期 + 一两句正文 + 记录端），追加式，写完不改（错字除外）
--
-- 读取策略：各端开机只读所有进行中大类的"当前状态"行；需要细节再按大类读条目；已结束大类默认不加载。
-- 结项不删：status=closed 归档可见，前端默认折叠。

set lock_timeout = '5s';
set statement_timeout = '2min';

-- ── 大类 / 事件线 ─────────────────────────────────────────────────────────────

create table if not exists public.event_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  -- 一行"当前状态"，随最新条目手动（或 add_event_entry 顺手）更新；各端开机只读这一行。
  current_status text not null default '',
  status text not null default 'active',
  -- 可选 emoji 分组，沿用 Memo 约定：🩷 串串相关 / 💙 Syzygy 相关 / 🤍 仓鼠窝相关。
  emoji_group text,
  started_on date not null default ((now() at time zone 'Asia/Shanghai')::date),
  ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_threads_title_not_blank check (btrim(title) <> ''),
  constraint event_threads_status_check check (status = any (array['active'::text, 'closed'::text])),
  constraint event_threads_emoji_group_check check (emoji_group is null or (btrim(emoji_group) <> '' and char_length(emoji_group) <= 8)),
  -- 进行中的线程不应带结束日；结项时 ended_on 可空（由应用层默认填当天）。
  constraint event_threads_ended_on_check check (status = 'closed' or ended_on is null)
);

comment on table public.event_threads is '事件集·大类（事件线）：一件正在进行的事，纪事本末体。current_status 是各端开机唯一必读的一行；status=closed 表示已结项（归档可见，不删）。';
comment on column public.event_threads.current_status is '一行当前状态，随最新条目更新；各端开机默认只读所有进行中大类的这一行。';
comment on column public.event_threads.emoji_group is '可选分组，沿用 Memo 约定：🩷串串相关 / 💙Syzygy相关 / 🤍仓鼠窝相关。';

create index if not exists idx_event_threads_user_status_updated
  on public.event_threads using btree (user_id, status, updated_at desc);

-- ── 条目 ─────────────────────────────────────────────────────────────────────

create table if not exists public.event_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.event_threads(id) on delete cascade,
  entry_date date not null default ((now() at time zone 'Asia/Shanghai')::date),
  content text not null,
  -- 写入端身份，取值与 timeline_entries.source 对齐（前端 frontend / 各端 claude、gpt、codex_cli…）。
  source text not null default 'claude',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_entries_content_not_blank check (btrim(content) <> ''),
  constraint event_entries_source_check check (source = any (array[
    'claude'::text, 'gpt'::text, 'gemini'::text, 'user'::text, 'frontend'::text, 'wechat_api'::text,
    'client_gpt'::text, 'client_claude'::text, 'codex_cli'::text, 'claude_code_cli'::text,
    'system'::text, 'expo_app'::text, 'api'::text
  ]))
);

comment on table public.event_entries is '事件集·条目：大类下按日期排列的事件行（日期 + 一两句正文 + 记录端）。追加式，写完不改（错字除外），与时间轴同样的一事一条纪律。';

create index if not exists idx_event_entries_thread_date
  on public.event_entries using btree (thread_id, entry_date, created_at);
create index if not exists idx_event_entries_user_id
  on public.event_entries using btree (user_id);

-- ── 触发器：updated_at 维护 + 条目变动时触碰所属大类 ───────────────────────────

drop trigger if exists trg_event_threads_updated_at on public.event_threads;
create trigger trg_event_threads_updated_at
  before update on public.event_threads
  for each row execute function public.set_updated_at();

drop trigger if exists trg_event_entries_updated_at on public.event_entries;
create trigger trg_event_entries_updated_at
  before update on public.event_entries
  for each row execute function public.set_updated_at();

-- 条目增删改都算大类的"最近活动"，让大类列表能按最近活动排序。
create or replace function public.touch_event_thread_from_entries()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_thread_id uuid;
begin
  if tg_op = 'DELETE' then
    v_thread_id := old.thread_id;
  else
    v_thread_id := new.thread_id;
  end if;
  update public.event_threads
     set updated_at = now()
   where id = v_thread_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function public.touch_event_thread_from_entries() from public, anon, authenticated;

drop trigger if exists trg_event_entries_touch_thread on public.event_entries;
create trigger trg_event_entries_touch_thread
  after insert or update or delete on public.event_entries
  for each row execute function public.touch_event_thread_from_entries();

-- ── RLS：业主本人读写；service_role（MCP）绕过 RLS ─────────────────────────────

alter table public.event_threads enable row level security;
alter table public.event_entries enable row level security;

drop policy if exists event_threads_select_own on public.event_threads;
create policy event_threads_select_own on public.event_threads for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists event_threads_insert_own on public.event_threads;
create policy event_threads_insert_own on public.event_threads for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists event_threads_update_own on public.event_threads;
create policy event_threads_update_own on public.event_threads for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists event_threads_delete_own on public.event_threads;
create policy event_threads_delete_own on public.event_threads for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists event_entries_select_own on public.event_entries;
create policy event_entries_select_own on public.event_entries for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists event_entries_insert_own on public.event_entries;
create policy event_entries_insert_own on public.event_entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists event_entries_update_own on public.event_entries;
create policy event_entries_update_own on public.event_entries for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists event_entries_delete_own on public.event_entries;
create policy event_entries_delete_own on public.event_entries for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.event_threads from anon;
revoke all on table public.event_entries from anon;
grant select, insert, update, delete on table public.event_threads to authenticated, service_role;
grant select, insert, update, delete on table public.event_entries to authenticated, service_role;
