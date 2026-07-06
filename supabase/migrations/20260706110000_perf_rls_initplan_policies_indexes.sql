-- P3 · performance batch (architecture review 3-1 / 3-2 / 3-3 / 3-4).
-- Source: Supabase performance advisor snapshot of 2026-07-06.

-- ── 3-2 · drop no-op "service role" policies ──
-- service_role bypasses RLS entirely, so a policy whose qual is
-- auth.role() = 'service_role' can never grant anything; its only effect is
-- an extra permissive-policy evaluation for every role on every query
-- (all 66 multiple_permissive_policies findings trace to these three).
drop policy if exists "Service role full access to memo entries" on public.memo_entries;
drop policy if exists "Service role full access to memo entry tags" on public.memo_entry_tags;
drop policy if exists "Service role full access to memo tags" on public.memo_tags;

-- ── 3-1 · wrap bare auth.*() calls in scalar subqueries ──
-- Bare auth.uid() in a policy is re-evaluated per row; (select auth.uid())
-- is evaluated once per statement (InitPlan). Rewrites every public-schema
-- policy still using the bare form (139 in the advisor snapshot); policies
-- already using the wrapped form deparse with "SELECT auth." and are skipped,
-- which also makes this block idempotent.
do $$
declare
  pol record;
  stmt text;
  fixed_qual text;
  fixed_check text;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (qual is not null and qual ~ 'auth\.(uid|role|jwt|email)\(\)' and qual !~ 'SELECT auth\.')
        or (with_check is not null and with_check ~ 'auth\.(uid|role|jwt|email)\(\)' and with_check !~ 'SELECT auth\.')
      )
  loop
    fixed_qual := null;
    fixed_check := null;

    if pol.qual is not null and pol.qual !~ 'SELECT auth\.' then
      fixed_qual := replace(replace(replace(replace(pol.qual,
        'auth.uid()', '(select auth.uid())'),
        'auth.role()', '(select auth.role())'),
        'auth.jwt()', '(select auth.jwt())'),
        'auth.email()', '(select auth.email())');
    end if;

    if pol.with_check is not null and pol.with_check !~ 'SELECT auth\.' then
      fixed_check := replace(replace(replace(replace(pol.with_check,
        'auth.uid()', '(select auth.uid())'),
        'auth.role()', '(select auth.role())'),
        'auth.jwt()', '(select auth.jwt())'),
        'auth.email()', '(select auth.email())');
    end if;

    stmt := format('alter policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    if fixed_qual is not null then
      stmt := stmt || format(' using (%s)', fixed_qual);
    end if;
    if fixed_check is not null then
      stmt := stmt || format(' with check (%s)', fixed_check);
    end if;

    execute stmt;
  end loop;
end $$;

-- ── 3-3 · covering indexes for the 15 unindexed foreign keys ──
create index if not exists idx_archive_categories_parent_user on public.archive_categories (parent_id, user_id);
create index if not exists idx_archives_category_user on public.archives (category_id, user_id);
create index if not exists idx_codex_control_user_id on public.codex_control (user_id);
create index if not exists idx_codex_tasks_user_id on public.codex_tasks (user_id);
create index if not exists idx_forum_replies_reply_to_reply_id on public.forum_replies (reply_to_reply_id);
create index if not exists idx_knowledge_folders_parent_id on public.knowledge_folders (parent_id);
create index if not exists idx_letter_conversations_conversation_id on public.letter_conversations (conversation_id);
create index if not exists idx_letters_conversation_id on public.letters (conversation_id);
create index if not exists idx_novel_books_user_id on public.novel_books (user_id);
create index if not exists idx_novel_chapters_user_id on public.novel_chapters (user_id);
create index if not exists idx_outbound_messages_user_id on public.outbound_messages (user_id);
create index if not exists idx_rp_story_groups_user_id on public.rp_story_groups (user_id);
create index if not exists idx_special_dates_user_id on public.special_dates (user_id);
create index if not exists idx_wallet_transactions_quest_id on public.wallet_transactions (quest_id);
create index if not exists idx_wiki_entries_user_id on public.wiki_entries (user_id);

-- ── 3-4 · drop the non-unique twin of each duplicate index pair ──
drop index if exists public.idx_daily_status_date_period;
drop index if exists public.idx_weekly_digest_week;
