-- ============================================================
-- 议事厅分类槽位表：固定 8 个，key 恒定不增不删，label 可在 Web 改名
-- agent_council.category 继续存 key，改名零数据迁移；
-- 「固定 8 个」由 RLS/授权保证：客户端只有 SELECT + UPDATE(label)。
-- ============================================================

create table public.council_categories (
  key text primary key,
  label text not null check (btrim(label) <> ''),
  sort_order int not null
);

comment on table public.council_categories is
  '议事厅主题分类槽位：固定 8 个，key 恒定（agent_council.category 存 key），label 可在 Web 议事厅改名。不开放增删——多了不方便（2026-07-16 串串定）。';

insert into public.council_categories (key, label, sort_order) values
  ('app', 'App 施工', 1),
  ('memory', '记忆机制', 2),
  ('infra', '基建运维', 3),
  ('ritual', '仪式', 4),
  ('reading', '阅读线', 5),
  ('game', '游戏区', 6),
  ('council', '议事厅', 7),
  ('other', '其他', 8);

alter table public.council_categories enable row level security;

create policy council_categories_select on public.council_categories
  for select to authenticated using (true);
-- 只允许已登录用户改名（单用户家庭应用；不建 INSERT/DELETE 策略 = 槽位数量锁死）
create policy council_categories_update on public.council_categories
  for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

-- 列级权限收紧：改名只能动 label，key / sort_order 客户端不可写
revoke all on table public.council_categories from anon;
revoke insert, update, delete on table public.council_categories from authenticated;
grant update (label) on public.council_categories to authenticated;

-- category 列注释同步新语义（原「分类演进免 migration」表述由固定槽位+改名取代）
comment on column public.agent_council.category is
  '提案主题分类 key（8 个固定槽位，见 council_categories；label 可改名，key 恒定）。子条目由工具层从父提案继承。';
