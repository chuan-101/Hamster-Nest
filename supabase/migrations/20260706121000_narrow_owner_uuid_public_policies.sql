-- P0 follow-up: three more tables with the checkin_logs anti-pattern.
--
-- Full-schema sweep after closing the review-doc list found quests,
-- wallet_transactions and wechat_messages still carrying ALL policies for
-- role {public} whose qual is the hardcoded owner uuid — which lets anon
-- read AND write owner rows (wechat_messages = full chat history).
-- Same fix as checkin_logs: same rows, authenticated only. service_role
-- writers (mini-agent) bypass RLS and are unaffected.

alter policy "Allow all for owner" on public.quests to authenticated;
alter policy "Allow all for owner" on public.wallet_transactions to authenticated;
alter policy "Allow all for authenticated user" on public.wechat_messages to authenticated;
