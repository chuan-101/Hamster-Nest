-- 囤粮处（Stash）：仓鼠的颊囊
--
-- 背景：2026-09-18 串串拍板。学习库（knowledge_folders / learning_nodes / learning_edges）逻辑完整但
-- 用不习惯，整体退休不动（不迁数据、不删表、不改一行，万一返聘）。囤粮处从零新建，与学习库之间
-- 没有任何外键、没有任何共享表。
--
-- 定位：囤粮处是颊囊，学习库是胃。塞进颊囊的东西不需要消化、不需要连线、不需要分类型，只需要知道
-- 它在哪个格子里、谁塞的、有没有吃掉。平时刷小红书 / GitHub 看到的仓库、想读的书、想看的电影、
-- 旅行攻略，一律往格子里塞；CLI 冲浪看到的也可以塞。
--
-- 三张表：
--   stash_folders   格子：自引用文件夹树（parent_id 为空即一级），层级不设上限，UI 一次只展示一层。
--   stash_items     粮食：title + url（可跳转）/ content（Markdown）至少一样；folder_id 为空即「待归仓」——
--                   待归仓不是功能区，只是东西掉进来时的默认落点（根级的自有条目）。
--   stash_comments  留言：每条粮食下的留言与回复，结构照抄 diary_comments。
--
-- 明确不做：不连线、不做向量检索、不做「搬去学习库」、不分 kind（类型语义由文件夹承担）。
-- 去重：url 归一化后的 url_key 在 (user_id, url_key) 上部分唯一；归一化规则在 stash_contract.ts。
-- 删格子的语义：格子里的粮食与子格子都升到上一级（根级即待归仓），一条都不删。

set lock_timeout = '5s';
set statement_timeout = '2min';

-- ── 格子 ─────────────────────────────────────────────────────────────────────

create table if not exists public.stash_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.stash_folders(id) on delete set null,
  name text not null,
  icon text,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stash_folders_name_not_blank check (btrim(name) <> ''),
  constraint stash_folders_name_length check (char_length(name) <= 60),
  constraint stash_folders_icon_check check (icon is null or (btrim(icon) <> '' and char_length(icon) <= 8)),
  constraint stash_folders_description_length check (description is null or char_length(description) <= 500),
  constraint stash_folders_no_self_parent check (parent_id is null or parent_id <> id)
);

comment on table public.stash_folders is '囤粮处·格子：自引用文件夹树，parent_id 为空即一级。层级不设上限；删格子时里面的粮食与子格子升到上一级。';
comment on column public.stash_folders.icon is '展示图标（emoji），可空，前端默认 📁。';

create index if not exists idx_stash_folders_user_parent
  on public.stash_folders using btree (user_id, parent_id, sort_order, created_at);

-- ── 粮食 ─────────────────────────────────────────────────────────────────────

create table if not exists public.stash_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 为空即「待归仓」（根级自有条目）。
  folder_id uuid references public.stash_folders(id) on delete set null,
  title text not null,
  -- 原始链接，展示与跳转用；url_key 是归一化后的去重键（去追踪参数 / 尾斜杠 / 大小写 host）。
  url text,
  url_key text,
  -- Markdown 正文，可空；url 与 content 至少一样。
  content text,
  tags text[] not null default '{}'::text[],
  -- 谁囤的：chuanchuan = 串串；其余为各端口。
  added_by text not null default 'chuanchuan',
  -- stashed = 囤着（默认）/ eaten = 吃掉了（读过 / 看过 / 用过）。
  status text not null default 'stashed',
  eaten_at timestamptz,
  -- 预留：GitHub star 数、封面图、书的作者……不动表结构。
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stash_items_title_not_blank check (btrim(title) <> ''),
  constraint stash_items_title_length check (char_length(title) <= 200),
  constraint stash_items_url_or_content check (url is not null or content is not null),
  constraint stash_items_url_key_paired check ((url is null) = (url_key is null)),
  constraint stash_items_added_by_check check (added_by = any (array[
    'chuanchuan'::text, 'claude'::text, 'gpt'::text, 'gemini'::text, 'codex_cli'::text, 'claude_code_cli'::text
  ])),
  constraint stash_items_status_check check (status = any (array['stashed'::text, 'eaten'::text])),
  constraint stash_items_eaten_at_check check (status = 'eaten' or eaten_at is null)
);

comment on table public.stash_items is '囤粮处·粮食：一条囤起来的东西（链接或文本）。folder_id 为空即待归仓；status=eaten 表示吃掉了（读过 / 看过 / 用过）。不分类型，类型语义由所在格子承担。';
comment on column public.stash_items.url_key is '归一化后的去重键：小写 host、去 www.、去追踪参数（utm_* / xhsshare / xsec_* 等）、去尾斜杠与 fragment；与 url 同生同灭。';
comment on column public.stash_items.added_by is '谁囤的：chuanchuan / claude / gpt / gemini / codex_cli / claude_code_cli。';
comment on column public.stash_items.status is 'stashed=囤着（默认）/ eaten=吃掉了。';

create index if not exists idx_stash_items_user_folder_created
  on public.stash_items using btree (user_id, folder_id, created_at desc);
create index if not exists idx_stash_items_user_status
  on public.stash_items using btree (user_id, status);
create index if not exists idx_stash_items_tags
  on public.stash_items using gin (tags);
-- 同一条链接只囤一次；短链看不穿，属已知盲区。
create unique index if not exists uq_stash_items_user_url_key
  on public.stash_items using btree (user_id, url_key) where url_key is not null;

-- ── 留言 ─────────────────────────────────────────────────────────────────────

create table if not exists public.stash_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.stash_items(id) on delete cascade,
  author text not null default 'chuanchuan',
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stash_comments_content_not_blank check (btrim(content) <> ''),
  constraint stash_comments_author_check check (author = any (array[
    'chuanchuan'::text, 'claude'::text, 'gpt'::text, 'gemini'::text, 'codex_cli'::text, 'claude_code_cli'::text
  ]))
);

comment on table public.stash_comments is '囤粮处·留言：每条粮食下的留言（串串 chuanchuan）与各端口的回复。';

create index if not exists idx_stash_comments_item_created
  on public.stash_comments using btree (item_id, created_at);
create index if not exists idx_stash_comments_user_id
  on public.stash_comments using btree (user_id);

-- ── 触发器 ───────────────────────────────────────────────────────────────────

drop trigger if exists trg_stash_folders_updated_at on public.stash_folders;
create trigger trg_stash_folders_updated_at
  before update on public.stash_folders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_stash_items_updated_at on public.stash_items;
create trigger trg_stash_items_updated_at
  before update on public.stash_items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_stash_comments_updated_at on public.stash_comments;
create trigger trg_stash_comments_updated_at
  before update on public.stash_comments
  for each row execute function public.set_updated_at();

-- 格子不能挂到自己的子孙下面（成环）；父格子必须同属一个业主。
create or replace function public.guard_stash_folder_parent()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  cursor_id uuid := new.parent_id;
  cursor_owner uuid;
  depth integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  select user_id into cursor_owner from public.stash_folders where id = new.parent_id;
  if cursor_owner is null then
    raise exception '父格子不存在: %', new.parent_id using errcode = 'foreign_key_violation';
  end if;
  if cursor_owner <> new.user_id then
    raise exception '父格子不属于同一业主' using errcode = 'check_violation';
  end if;
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception '格子不能挂到自己的子格子下面（会成环）' using errcode = 'check_violation';
    end if;
    depth := depth + 1;
    if depth > 64 then
      raise exception '格子层级过深' using errcode = 'check_violation';
    end if;
    select parent_id into cursor_id from public.stash_folders where id = cursor_id;
  end loop;
  return new;
end;
$function$;

revoke all on function public.guard_stash_folder_parent() from public, anon, authenticated;

drop trigger if exists trg_stash_folders_parent_guard on public.stash_folders;
create trigger trg_stash_folders_parent_guard
  before insert or update of parent_id on public.stash_folders
  for each row execute function public.guard_stash_folder_parent();

-- 删格子：里面的粮食与子格子升到上一级（根级即待归仓），一条都不删。
create or replace function public.lift_stash_folder_contents()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  update public.stash_items set folder_id = old.parent_id where folder_id = old.id;
  update public.stash_folders set parent_id = old.parent_id where parent_id = old.id;
  return old;
end;
$function$;

revoke all on function public.lift_stash_folder_contents() from public, anon, authenticated;

drop trigger if exists trg_stash_folders_lift_contents on public.stash_folders;
create trigger trg_stash_folders_lift_contents
  before delete on public.stash_folders
  for each row execute function public.lift_stash_folder_contents();

-- 吃掉时盖时间戳；改回囤着就清掉。粮食的格子也必须同属一个业主。
create or replace function public.guard_stash_item()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  folder_owner uuid;
begin
  if new.folder_id is not null then
    select user_id into folder_owner from public.stash_folders where id = new.folder_id;
    if folder_owner is null then
      raise exception '格子不存在: %', new.folder_id using errcode = 'foreign_key_violation';
    end if;
    if folder_owner <> new.user_id then
      raise exception '格子不属于同一业主' using errcode = 'check_violation';
    end if;
  end if;
  if new.status = 'eaten' then
    if new.eaten_at is null then
      new.eaten_at := now();
    end if;
  else
    new.eaten_at := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_stash_item() from public, anon, authenticated;

drop trigger if exists trg_stash_items_guard on public.stash_items;
create trigger trg_stash_items_guard
  before insert or update on public.stash_items
  for each row execute function public.guard_stash_item();

-- ── RLS：业主本人读写；service_role（MCP）绕过 RLS ─────────────────────────────

alter table public.stash_folders enable row level security;
alter table public.stash_items enable row level security;
alter table public.stash_comments enable row level security;

drop policy if exists stash_folders_select_own on public.stash_folders;
create policy stash_folders_select_own on public.stash_folders for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists stash_folders_insert_own on public.stash_folders;
create policy stash_folders_insert_own on public.stash_folders for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists stash_folders_update_own on public.stash_folders;
create policy stash_folders_update_own on public.stash_folders for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists stash_folders_delete_own on public.stash_folders;
create policy stash_folders_delete_own on public.stash_folders for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists stash_items_select_own on public.stash_items;
create policy stash_items_select_own on public.stash_items for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists stash_items_insert_own on public.stash_items;
create policy stash_items_insert_own on public.stash_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists stash_items_update_own on public.stash_items;
create policy stash_items_update_own on public.stash_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists stash_items_delete_own on public.stash_items;
create policy stash_items_delete_own on public.stash_items for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists stash_comments_select_own on public.stash_comments;
create policy stash_comments_select_own on public.stash_comments for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists stash_comments_insert_own on public.stash_comments;
create policy stash_comments_insert_own on public.stash_comments for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists stash_comments_update_own on public.stash_comments;
create policy stash_comments_update_own on public.stash_comments for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists stash_comments_delete_own on public.stash_comments;
create policy stash_comments_delete_own on public.stash_comments for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.stash_folders from anon;
revoke all on table public.stash_items from anon;
revoke all on table public.stash_comments from anon;
grant select, insert, update, delete on table public.stash_folders to authenticated, service_role;
grant select, insert, update, delete on table public.stash_items to authenticated, service_role;
grant select, insert, update, delete on table public.stash_comments to authenticated, service_role;
