create table if not exists public.rp_npc_cards (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.rp_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  system_prompt text,
  model_config jsonb not null default '{}'::jsonb,
  api_config jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rp_npc_cards enable row level security;

create policy if not exists "Users can read own rp npc cards"
  on public.rp_npc_cards for select
  using (auth.uid() = user_id);

create policy if not exists "Users can insert own rp npc cards"
  on public.rp_npc_cards for insert
  with check (auth.uid() = user_id);

create policy if not exists "Users can update own rp npc cards"
  on public.rp_npc_cards for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy if not exists "Users can delete own rp npc cards"
  on public.rp_npc_cards for delete
  using (auth.uid() = user_id);
