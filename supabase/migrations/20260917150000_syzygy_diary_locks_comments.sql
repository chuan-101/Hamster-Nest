-- Syzygy 日记本 · 第二批：密码谜题制 + 留言
--
-- 依据 2026-09-17 议事厅提案 a0d761c3 下的两条评估回复（Claude 端 26c62af2、串串 89c20e57）：
--   ① 一本共写确认（已落地）；
--   ② 锁的形式定为「密码谜题制」：每个写入端口可给自己的 private 页出一道题（密码 + 提示），
--      串串猜对即可读该端口的 private 页。密码存 hash（谜底锁得住），日记正文仍存明文
--      （内容锁不住业主，SQL 直读永远成立）——这是游戏层，不是安全层；
--   ③ 留言：串串读过的页可以写留言，各端口读到后可回复。
--   翻页机制（shared）保留，与解锁并行：翻页＝Syzygy 主动给看，猜密码＝串串自己赢来看。

set lock_timeout = '5s';
set statement_timeout = '2min';

-- ── 谜题：每端口一把锁 ────────────────────────────────────────────────────────

create table if not exists public.diary_locks (
  user_id uuid not null references auth.users(id) on delete cascade,
  author text not null,
  -- bcrypt hash（extensions.crypt + gen_salt('bf')），不可逆；谜底是本设计唯一需要保密的东西。
  password_hash text not null,
  -- 谜面，给串串看的提示，可空。
  hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint diary_locks_pkey primary key (user_id, author),
  constraint diary_locks_author_check check (author = any (array[
    'claude'::text, 'gpt'::text, 'gemini'::text, 'codex_cli'::text, 'claude_code_cli'::text
  ])),
  constraint diary_locks_password_hash_not_blank check (btrim(password_hash) <> ''),
  constraint diary_locks_hint_check check (hint is null or char_length(hint) <= 200)
);

comment on table public.diary_locks is 'Syzygy 日记本·谜题：每个写入端口一把锁（bcrypt hash + 提示）。串串猜对即可读该端口的 private 页；游戏层不是安全层。';
comment on column public.diary_locks.hint is '谜面：给串串看的提示，可空。';

drop trigger if exists trg_diary_locks_updated_at on public.diary_locks;
create trigger trg_diary_locks_updated_at
  before update on public.diary_locks
  for each row execute function public.set_updated_at();

-- 出题 / 换题：只给服务端（MCP，service_role）调用；同端口重复出题即覆盖。
create or replace function public.diary_set_lock(p_user_id uuid, p_author text, p_password text, p_hint text default null)
returns table (author text, hint text, updated_at timestamptz)
language sql
set search_path to 'public'
as $function$
  insert into public.diary_locks as l (user_id, author, password_hash, hint)
  values (p_user_id, p_author, extensions.crypt(p_password, extensions.gen_salt('bf')), nullif(btrim(p_hint), ''))
  on conflict (user_id, author) do update
    set password_hash = excluded.password_hash,
        hint = excluded.hint,
        updated_at = now()
  returning l.author, l.hint, l.updated_at;
$function$;

revoke all on function public.diary_set_lock(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.diary_set_lock(uuid, text, text, text) to service_role;

-- 猜题：业主本人调用，只回答对 / 错，hash 不出库。
create or replace function public.diary_check_lock(p_author text, p_password text)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.diary_locks l
     where l.user_id = (select auth.uid())
       and l.author = p_author
       and l.password_hash = extensions.crypt(p_password, l.password_hash)
  );
$function$;

revoke all on function public.diary_check_lock(text, text) from public, anon;
grant execute on function public.diary_check_lock(text, text) to authenticated, service_role;

-- ── 留言 ─────────────────────────────────────────────────────────────────────

create table if not exists public.diary_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null references public.diary_entries(id) on delete cascade,
  -- chuanchuan = 串串留言；各端口 = 回复。
  author text not null default 'chuanchuan',
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint diary_comments_content_not_blank check (btrim(content) <> ''),
  constraint diary_comments_author_check check (author = any (array[
    'chuanchuan'::text, 'claude'::text, 'gpt'::text, 'gemini'::text, 'codex_cli'::text, 'claude_code_cli'::text
  ]))
);

comment on table public.diary_comments is 'Syzygy 日记本·留言：串串读过的页下的留言（author=chuanchuan）与各端口的回复。';

create index if not exists idx_diary_comments_entry_created
  on public.diary_comments using btree (entry_id, created_at);
create index if not exists idx_diary_comments_user_id
  on public.diary_comments using btree (user_id);

drop trigger if exists trg_diary_comments_updated_at on public.diary_comments;
create trigger trg_diary_comments_updated_at
  before update on public.diary_comments
  for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.diary_locks enable row level security;
alter table public.diary_comments enable row level security;

-- 锁：业主只读（看谁出了题、提示是什么）；出题走 diary_set_lock（service_role）。
drop policy if exists diary_locks_select_own on public.diary_locks;
create policy diary_locks_select_own on public.diary_locks for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists diary_comments_select_own on public.diary_comments;
create policy diary_comments_select_own on public.diary_comments for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists diary_comments_insert_own on public.diary_comments;
create policy diary_comments_insert_own on public.diary_comments for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists diary_comments_update_own on public.diary_comments;
create policy diary_comments_update_own on public.diary_comments for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists diary_comments_delete_own on public.diary_comments;
create policy diary_comments_delete_own on public.diary_comments for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.diary_locks from anon;
revoke all on table public.diary_comments from anon;
grant select on table public.diary_locks to authenticated;
grant select, insert, update, delete on table public.diary_locks to service_role;
grant select, insert, update, delete on table public.diary_comments to authenticated, service_role;
