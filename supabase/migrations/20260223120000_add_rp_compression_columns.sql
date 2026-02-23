alter table public.rp_sessions
  add column if not exists rp_context_token_limit integer not null default 32000,
  add column if not exists rp_keep_recent_messages integer not null default 10;
