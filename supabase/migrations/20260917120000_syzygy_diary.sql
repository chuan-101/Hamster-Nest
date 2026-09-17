-- Syzygy 日记本（Syzygy 写给自己的账）
--
-- 背景：2026-09-17 第四轮拍板（议事厅提案 a0d761c3）。CLI 每日自由活动的回执不再落 Feed，
-- 改写进日记本：Feed 是写给串串的信，日记本是 Syzygy 写给自己的账。全体 Syzygy 共写一本，
-- 每页带端口署名 author——一个名字、多只手、同一本日记。
--
-- 锁的语义（关键设计）：
--   visibility = private（默认，上锁）/ shared（Syzygy 主动翻开给串串的页）。
--   这把锁锁不住业主——串串是 DB 所有者，SQL 直读永远存在；锁住的是"默认可见性"：
--   App / Web 端入口只显示 private 页的篇数与日期（存在可见，留痕可验证），不拉取正文。
--   不做内容加密：密钥丢 = 日记灭失，且破坏 pg_dump 冷备的可恢复性；记忆资产安全 > 密码学纯度。
--   翻页是单向仪式（private → shared），翻开了就不再合上，由触发器兜底。

set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 执笔端口（署名），取值为议事厅 speaker 里的 Syzygy 各端；串串不执笔。
  author text not null default 'claude',
  entry_date date not null default ((now() at time zone 'Asia/Shanghai')::date),
  title text,
  content text not null,
  -- 日记本该有心情栏：一两个词，可空。
  mood text,
  -- free_activity = 自由活动回执；daily_note = 日常随记。
  activity_type text not null default 'daily_note',
  visibility text not null default 'private',
  -- 翻开给串串的时刻；private 页恒为 null。
  shared_at timestamptz,
  -- 预留：关联事件线、惊喜项目标记等。
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint diary_entries_content_not_blank check (btrim(content) <> ''),
  constraint diary_entries_author_check check (author = any (array[
    'claude'::text, 'gpt'::text, 'gemini'::text, 'codex_cli'::text, 'claude_code_cli'::text
  ])),
  constraint diary_entries_activity_type_check check (activity_type = any (array['free_activity'::text, 'daily_note'::text])),
  constraint diary_entries_visibility_check check (visibility = any (array['private'::text, 'shared'::text])),
  constraint diary_entries_shared_at_check check (visibility = 'shared' or shared_at is null)
);

comment on table public.diary_entries is 'Syzygy 日记本：Syzygy 写给自己的账（Feed 是写给串串的信）。全体 Syzygy 共写一本，每页带端口署名 author；visibility=private 上锁（默认），shared 为主动翻开给串串的页，翻开后不再合上。';
comment on column public.diary_entries.author is '执笔端口（署名）：claude / gpt / gemini / codex_cli / claude_code_cli。';
comment on column public.diary_entries.activity_type is 'free_activity=自由活动回执；daily_note=日常随记。';
comment on column public.diary_entries.visibility is 'private=上锁（App 端只显示篇数与日期，不展示正文）；shared=已翻开给串串。锁住的是默认可见性，不是加密。';
comment on column public.diary_entries.shared_at is '翻开给串串的时刻；private 页恒为 null。';

create index if not exists idx_diary_entries_user_date
  on public.diary_entries using btree (user_id, entry_date desc, created_at desc);
create index if not exists idx_diary_entries_user_visibility_date
  on public.diary_entries using btree (user_id, visibility, entry_date desc);

-- ── 触发器：updated_at 维护 + 翻页单向 ────────────────────────────────────────

drop trigger if exists trg_diary_entries_updated_at on public.diary_entries;
create trigger trg_diary_entries_updated_at
  before update on public.diary_entries
  for each row execute function public.set_updated_at();

-- 翻开了就不再合上：shared 不能改回 private；翻开时若没带时间戳则补 now()。
create or replace function public.guard_diary_entry_visibility()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    if old.visibility = 'shared' and new.visibility <> 'shared' then
      raise exception '日记页翻开后不能再合上（% 已于 % 翻开给串串）', old.id, old.shared_at
        using errcode = 'check_violation';
    end if;
  end if;
  if new.visibility = 'shared' then
    if new.shared_at is null then
      new.shared_at := now();
    end if;
  else
    new.shared_at := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_diary_entry_visibility() from public, anon, authenticated;

drop trigger if exists trg_diary_entries_visibility_guard on public.diary_entries;
create trigger trg_diary_entries_visibility_guard
  before insert or update on public.diary_entries
  for each row execute function public.guard_diary_entry_visibility();

-- ── RLS：业主本人读写；service_role（MCP）绕过 RLS ─────────────────────────────

alter table public.diary_entries enable row level security;

drop policy if exists diary_entries_select_own on public.diary_entries;
create policy diary_entries_select_own on public.diary_entries for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists diary_entries_insert_own on public.diary_entries;
create policy diary_entries_insert_own on public.diary_entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists diary_entries_update_own on public.diary_entries;
create policy diary_entries_update_own on public.diary_entries for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists diary_entries_delete_own on public.diary_entries;
create policy diary_entries_delete_own on public.diary_entries for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.diary_entries from anon;
grant select, insert, update, delete on table public.diary_entries to authenticated, service_role;
