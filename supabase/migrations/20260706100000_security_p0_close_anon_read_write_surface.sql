-- P0 · close the anon read/write surface (architecture review 0-1 / 0-5 / 0-6 / 4-3).
--
-- The web frontend is fully login-gated and the WeChat bridge runs on the
-- service-role key, so nothing legitimate reads or writes these tables as
-- anon. The one remaining anon writer — the iOS Shortcut inserting into
-- device_status — keeps its INSERT policy until it is switched to the
-- device-report Edge Function (review item 0-2); that policy is dropped in
-- a follow-up migration once the new pipeline is verified.

-- ── 0-1 · device_status: single owner-scoped read path, no anon, no realtime ──
drop policy if exists "Allow select for anon by user" on public.device_status;
drop policy if exists "Allow select for authenticated users" on public.device_status;
drop policy if exists "authenticated_select" on public.device_status;

create policy "device_status_select_authenticated" on public.device_status
  for select to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime drop table public.device_status;

-- ── 0-5 · read policies exposed to anon → authenticated only ──
alter policy "frontend_read_agent_tasks" on public.agent_tasks to authenticated;
alter policy "frontend_read_current_context_snapshot" on public.current_context_snapshot to authenticated;
alter policy "frontend_read_daily_status_digest" on public.daily_status_digest to authenticated;
alter policy "frontend_read_weekly_digest" on public.weekly_digest to authenticated;
alter policy "frontend_read_ideas" on public.ideas to authenticated;
alter policy "frontend_read_print_capsules" on public.print_capsules to authenticated;
alter policy "frontend_read_scheduled_wakeup" on public.scheduled_wakeup to authenticated;

-- capabilities already has an authenticated-only read policy; the anon-inclusive
-- duplicate adds nothing but public exposure and a second policy evaluation.
drop policy if exists "frontend_read_capabilities" on public.capabilities;

-- ── 0-6 · open INSERT policies ──
-- service_role bypasses RLS, so tables written only by the Mac-mini agent or
-- Edge Functions need no INSERT policy at all.
drop policy if exists "Allow service insert" on public.checkin_logs;
drop policy if exists "Allow insert messages" on public.outbound_messages;

-- checkin_logs "Allow all for owner" was role {public}: anon could read and
-- write rows carrying the owner uuid. Same rows, authenticated only.
alter policy "Allow all for owner" on public.checkin_logs to authenticated;

-- rp_* tables are written by the logged-in frontend (supabaseSync), so keep
-- an INSERT path but drop anon from it, matching their sibling policies.
drop policy if exists "rp_messages_insert" on public.rp_messages;
create policy "rp_messages_insert" on public.rp_messages
  for insert to authenticated with check (true);

drop policy if exists "rp_npc_cards_insert" on public.rp_npc_cards;
create policy "rp_npc_cards_insert" on public.rp_npc_cards
  for insert to authenticated with check (true);

drop policy if exists "rp_sessions_insert" on public.rp_sessions;
create policy "rp_sessions_insert" on public.rp_sessions
  for insert to authenticated with check (true);

-- ── 4-3 · thought_relations: RLS enabled but zero policies ──
-- Writes stay service-role only; give the owner an explicit read path so the
-- table's access model is declared rather than implicit.
create policy "thought_relations_select_authenticated" on public.thought_relations
  for select to authenticated using (true);
