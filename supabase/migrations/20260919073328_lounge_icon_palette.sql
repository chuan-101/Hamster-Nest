alter table public.lounge_sofas add column icon_color text not null default 'rose'
 check(icon_color in ('rose','lilac','peach','sage'));

create or replace function private.lounge_set_appearance(p_id uuid,p_name text,p_icon text,p_color text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sofa public.lounge_sofas%rowtype;
begin
 if p_color is not null and p_color not in ('rose','lilac','peach','sage') then
  raise exception using errcode='22023',message='invalid sofa color';end if;
 -- Existing routine checks auth.uid(), owner, name and icon before any write.
 perform private.lounge_set_appearance(p_id,p_name,p_icon);
 update public.lounge_sofas set icon_color=coalesce(p_color,icon_color)
 where id=p_id and user_id=auth.uid() returning * into sofa;
 return to_jsonb(sofa);
end $$;
revoke all on function private.lounge_set_appearance(uuid,text,text,text) from public,anon;
grant execute on function private.lounge_set_appearance(uuid,text,text,text) to authenticated;
drop function public.lounge_set_appearance(uuid,text,text);
create function public.lounge_set_appearance(p_id uuid,p_name text,p_icon text,p_color text default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.lounge_set_appearance(p_id,p_name,p_icon,p_color); $$;
revoke all on function public.lounge_set_appearance(uuid,text,text,text) from public,anon;
grant execute on function public.lounge_set_appearance(uuid,text,text,text) to authenticated;
