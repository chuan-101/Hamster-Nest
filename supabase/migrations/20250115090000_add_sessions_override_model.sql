alter table if exists public.sessions
add column if not exists override_model text;
