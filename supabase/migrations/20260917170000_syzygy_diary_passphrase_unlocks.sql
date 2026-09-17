-- Syzygy 日记本 · 第三批：暗号制（宽松匹配）+ 解锁记忆
--
-- 串串 2026-09-17 试用反馈：①GPT 端的暗号"输对了"却打不开；②Claude 端把暗号设成中文，
-- 网页的密码框输不了中文；③对上一次以后不该每次再输。
--
-- 处理：
--   暗号不是密码，是对暗号。出题与核对两边统一做规范化：NFKC 全半角归一 → 去首尾空白 →
--   连续空白压成一个 → 小写。中文、空格、大小写、全半角都不再是坑；旧 hash 按原文兜底核对，
--   已出的题不用重出。
--   解锁记在服务端 diary_unlocks（每端口一行）：一次对上，处处有效（网页 / App 共用）；
--   端口换题（diary_locks.updated_at 变新）后自动失效，要重新对。

set lock_timeout = '5s';
set statement_timeout = '2min';

-- ── 暗号规范化 ───────────────────────────────────────────────────────────────

create or replace function public.diary_normalize_passphrase(p_text text)
returns text
language sql
immutable
strict
set search_path to 'public'
as $function$
  select lower(regexp_replace(btrim(normalize(p_text, NFKC)), '\s+', ' ', 'g'));
$function$;

comment on function public.diary_normalize_passphrase(text) is '日记本暗号规范化：NFKC → 去首尾空白 → 连续空白压一 → 小写。出题与核对两边共用。';

revoke all on function public.diary_normalize_passphrase(text) from public, anon;
grant execute on function public.diary_normalize_passphrase(text) to authenticated, service_role;

-- 出题 / 换题：hash 规范化后的暗号。
create or replace function public.diary_set_lock(p_user_id uuid, p_author text, p_password text, p_hint text default null)
returns table (author text, hint text, updated_at timestamptz)
language sql
set search_path to 'public'
as $function$
  insert into public.diary_locks as l (user_id, author, password_hash, hint)
  values (
    p_user_id,
    p_author,
    extensions.crypt(nullif(public.diary_normalize_passphrase(p_password), ''), extensions.gen_salt('bf')),
    nullif(btrim(p_hint), '')
  )
  on conflict (user_id, author) do update
    set password_hash = excluded.password_hash,
        hint = excluded.hint,
        updated_at = now()
  returning l.author, l.hint, l.updated_at;
$function$;

revoke all on function public.diary_set_lock(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.diary_set_lock(uuid, text, text, text) to service_role;

-- ── 解锁记忆：每端口一行 ─────────────────────────────────────────────────────

create table if not exists public.diary_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  author text not null,
  unlocked_at timestamptz not null default now(),
  constraint diary_unlocks_pkey primary key (user_id, author),
  constraint diary_unlocks_author_check check (author = any (array[
    'claude'::text, 'gpt'::text, 'gemini'::text, 'codex_cli'::text, 'claude_code_cli'::text
  ]))
);

comment on table public.diary_unlocks is 'Syzygy 日记本·解锁记忆：串串对上某端口暗号的时刻。unlocked_at >= diary_locks.updated_at 视为仍然解开；端口换题后自动失效。';

alter table public.diary_unlocks enable row level security;

drop policy if exists diary_unlocks_select_own on public.diary_unlocks;
create policy diary_unlocks_select_own on public.diary_unlocks for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists diary_unlocks_insert_own on public.diary_unlocks;
create policy diary_unlocks_insert_own on public.diary_unlocks for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists diary_unlocks_update_own on public.diary_unlocks;
create policy diary_unlocks_update_own on public.diary_unlocks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists diary_unlocks_delete_own on public.diary_unlocks;
create policy diary_unlocks_delete_own on public.diary_unlocks for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.diary_unlocks from anon;
grant select, insert, update, delete on table public.diary_unlocks to authenticated, service_role;

-- ── 对暗号：规范化核对 + 旧 hash 原文兜底；对上即记一次解锁 ─────────────────

create or replace function public.diary_check_lock(p_author text, p_password text)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
declare
  v_user uuid := (select auth.uid());
  v_hash text;
  v_ok boolean;
begin
  if v_user is null or p_password is null then
    return false;
  end if;
  select l.password_hash into v_hash
    from public.diary_locks l
   where l.user_id = v_user and l.author = p_author;
  if v_hash is null then
    return false;
  end if;
  v_ok := coalesce(v_hash = extensions.crypt(public.diary_normalize_passphrase(p_password), v_hash), false)
       or coalesce(v_hash = extensions.crypt(btrim(p_password), v_hash), false);
  if v_ok then
    insert into public.diary_unlocks (user_id, author, unlocked_at)
    values (v_user, p_author, now())
    on conflict (user_id, author) do update set unlocked_at = now();
  end if;
  return v_ok;
end;
$function$;

revoke all on function public.diary_check_lock(text, text) from public, anon;
grant execute on function public.diary_check_lock(text, text) to authenticated, service_role;

-- ── 锁的状态：谁出了题、提示、是否已解开 ──────────────────────────────────────

create or replace function public.diary_lock_status()
returns table (author text, hint text, updated_at timestamptz, unlocked boolean, unlocked_at timestamptz)
language sql
stable
set search_path to 'public'
as $function$
  select l.author,
         l.hint,
         l.updated_at,
         coalesce(u.unlocked_at >= l.updated_at, false) as unlocked,
         case when u.unlocked_at >= l.updated_at then u.unlocked_at end as unlocked_at
    from public.diary_locks l
    left join public.diary_unlocks u on u.user_id = l.user_id and u.author = l.author
   where l.user_id = (select auth.uid())
   order by l.author;
$function$;

revoke all on function public.diary_lock_status() from public, anon;
grant execute on function public.diary_lock_status() to authenticated, service_role;
