-- The list and its featured entry change together under one optimistic revision.
create table public.home_anniversary_books (
  user_id uuid primary key references auth.users(id) on delete cascade,
  since date check (since between date '1000-01-01' and date '9999-12-31'),
  entries jsonb not null default '[]' check (jsonb_typeof(entries) = 'array'),
  featured_id uuid,
  revision uuid not null default gen_random_uuid(),
  check (featured_id is null or entries @> jsonb_build_array(jsonb_build_object('id', featured_id)))
);

alter table public.home_anniversary_books enable row level security;
revoke all on public.home_anniversary_books from public, anon, authenticated;
grant select, insert, update on public.home_anniversary_books to authenticated;
grant all on public.home_anniversary_books to service_role;
create policy anniversary_read on public.home_anniversary_books for select to authenticated
  using (user_id = (select auth.uid()));
create policy anniversary_insert on public.home_anniversary_books for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy anniversary_update on public.home_anniversary_books for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
