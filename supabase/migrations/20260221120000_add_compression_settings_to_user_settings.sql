alter table public.user_settings
  add column if not exists compression_enabled boolean not null default true,
  add column if not exists compression_trigger_ratio double precision not null default 0.65,
  add column if not exists compression_keep_recent_messages integer not null default 20,
  add column if not exists summarizer_model text;
