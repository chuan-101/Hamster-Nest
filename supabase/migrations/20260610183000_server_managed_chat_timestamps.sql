-- Keep daily chat timestamps server-owned so client timezone math cannot poison sync cursors.

create or replace function public.set_sessions_updated_at_now()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_sessions_updated_at_now on public.sessions;
create trigger set_sessions_updated_at_now
before update on public.sessions
for each row
execute function public.set_sessions_updated_at_now();

create or replace function public.touch_session_updated_at_from_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session_id uuid;
begin
  target_session_id = coalesce(new.session_id, old.session_id);

  if target_session_id is not null then
    update public.sessions
    set updated_at = now()
    where id = target_session_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists touch_session_updated_at_after_messages on public.messages;
create trigger touch_session_updated_at_after_messages
after insert or update or delete on public.messages
for each row
execute function public.touch_session_updated_at_from_messages();
