-- Native Stash: preserve emoji compatibility; palette shared with lounge.
alter table public.stash_folders add column icon_color text not null default 'rose'
  constraint stash_folders_icon_color_check check (icon_color in ('rose','lilac','peach','sage'));
comment on column public.stash_folders.icon_color is '囤粮处图标配色：rose/lilac/peach/sage；与 App 客厅调色板一致。';

-- SECURITY INVOKER: RLS and explicit authenticated owner apply to every read.
create function public.stash_folder_counts()
returns table(folder_id uuid, total_count bigint, stashed_count bigint)
language sql stable security invoker set search_path = '' as $$
  select i.folder_id, count(*), count(*) filter (where i.status = 'stashed')
  from public.stash_items i where i.user_id = (select auth.uid()) group by i.folder_id;
$$;

-- Keyset pagination keeps large collections bounded; search covers bodies and tags
-- on the server, including items not downloaded by this device.
create function public.stash_search_items(
  p_folder_id uuid default null, p_search text default '', p_status text default null,
  p_before_time timestamptz default null, p_before_id uuid default null, p_limit integer default 41
) returns setof public.stash_items
language sql stable security invoker set search_path = '' as $$
  select i.* from public.stash_items i
  where i.user_id = (select auth.uid())
    and (p_status is null or i.status = p_status)
    and (case when btrim(coalesce(p_search,'')) = '' then i.folder_id is not distinct from p_folder_id
      else position(lower(btrim(p_search)) in lower(i.title)) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(i.content,''))) > 0
        or position(lower(btrim(p_search)) in lower(coalesce(i.url,''))) > 0
        or exists (select 1 from unnest(i.tags) tag where position(lower(btrim(p_search)) in lower(tag)) > 0)
      end)
    and (p_before_time is null or (i.created_at,i.id) < (p_before_time,p_before_id))
  order by i.created_at desc, i.id desc limit least(greatest(coalesce(p_limit,41),1),101);
$$;
revoke all on function public.stash_folder_counts() from public, anon;
revoke all on function public.stash_search_items(uuid,text,text,timestamptz,uuid,integer) from public, anon;
grant execute on function public.stash_folder_counts() to authenticated;
grant execute on function public.stash_search_items(uuid,text,text,timestamptz,uuid,integer) to authenticated;
