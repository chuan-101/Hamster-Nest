alter table public.rp_sessions
  add column if not exists worldbook_text text,
  add column if not exists settings jsonb not null default '{}'::jsonb;
