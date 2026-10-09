-- Native wallet: owner-scoped reads and atomic, replayable mutations.
-- Existing Web/MCP signatures remain compatible. No historical balances are rewritten.
alter policy "Allow all for owner" on public.quests to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "Allow all for owner" on public.wallet_transactions to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create schema if not exists wallet_private;
revoke all on schema wallet_private from public, anon;
grant usage on schema wallet_private to authenticated;
create table wallet_private.requests (
  user_id uuid not null,
  request_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table wallet_private.requests enable row level security;
create policy own_receipts on wallet_private.requests for select to authenticated
  using ((select auth.uid()) = user_id);
create policy insert_own_receipts on wallet_private.requests for insert to authenticated
  with check ((select auth.uid()) = user_id);
revoke all on wallet_private.requests from public, anon, authenticated;
grant select, insert on wallet_private.requests to authenticated;

-- Serialize all supported balance writers before reading a balance or locking a quest.
create or replace function public.complete_quest(
  p_quest_id uuid, p_note text default null,
  p_user_id uuid default '94dd24be-e136-45bb-836b-6820c09c4292'::uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare q public.quests%rowtype;
begin
  if p_user_id is null or (current_user <> 'service_role' and auth.uid() is distinct from p_user_id) then
    raise exception '无权操作这个钱包' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet:' || p_user_id::text, 0));
  select * into q from public.quests where id = p_quest_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('success',false,'error','心愿不存在'); end if;
  if q.status <> 'open' then return jsonb_build_object('success',false,'error','心愿已完成或已取消'); end if;
  update public.quests set status = 'completed', completed_at = now(), completed_note = nullif(btrim(p_note),'')
    where id = q.id and user_id = p_user_id;
  if q.reward_points > 0 then
    insert into public.wallet_transactions(user_id,type,points_delta,coins_delta,description,quest_id)
    values(p_user_id,'earn',q.reward_points,0,'完成任务：' || q.title,q.id);
  end if;
  return jsonb_build_object('success',true,'quest_title',q.title,'points_earned',q.reward_points,'completed_at',now());
end $$;

create or replace function public.exchange_points_to_coins(
  p_points integer, p_user_id uuid default '94dd24be-e136-45bb-836b-6820c09c4292'::uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare points bigint; coins numeric;
begin
  if p_user_id is null or (current_user <> 'service_role' and auth.uid() is distinct from p_user_id) then
    raise exception '无权操作这个钱包' using errcode = '42501';
  end if;
  if p_points is null or p_points < 100 then return jsonb_build_object('success',false,'error','最少兑换100积分'); end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet:' || p_user_id::text, 0));
  select coalesce(sum(points_delta),0) into points from public.wallet_transactions where user_id = p_user_id;
  if points < p_points then return jsonb_build_object('success',false,'error','积分不足','current_points',points); end if;
  coins := p_points::numeric / 100;
  insert into public.wallet_transactions(user_id,type,points_delta,coins_delta,description)
    values(p_user_id,'exchange',-p_points,coins,p_points || '积分 → ' || coins || '金币');
  return jsonb_build_object('success',true,'exchanged_points',p_points,'gained_coins',coins,'remaining_points',points-p_points);
end $$;

create or replace function public.spend_coins(
  p_amount numeric, p_description text,
  p_user_id uuid default '94dd24be-e136-45bb-836b-6820c09c4292'::uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare coins numeric;
begin
  if p_user_id is null or (current_user <> 'service_role' and auth.uid() is distinct from p_user_id) then
    raise exception '无权操作这个钱包' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount::text in ('NaN','Infinity','-Infinity')
     or p_amount <> round(p_amount,2) or nullif(btrim(p_description),'') is null then
    return jsonb_build_object('success',false,'error','请填写正数金额（最多两位小数）和用途');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet:' || p_user_id::text, 0));
  select coalesce(sum(coins_delta),0) into coins from public.wallet_transactions where user_id = p_user_id;
  if coins < p_amount then return jsonb_build_object('success',false,'error','金币不足','current_coins',coins); end if;
  insert into public.wallet_transactions(user_id,type,points_delta,coins_delta,description)
    values(p_user_id,'spend',0,-p_amount,btrim(p_description));
  return jsonb_build_object('success',true,'spent',p_amount,'remaining_coins',coins-p_amount,'description',btrim(p_description));
end $$;

-- One statement snapshot: counts, detail, history and balance describe the same instant.
-- JSON aggregation avoids PostgREST's per-table 1000-row truncation.
create function public.wallet_app_read() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'points', (select coalesce(sum(points_delta),0) from public.wallet_transactions where user_id = auth.uid()),
    'coins', (select coalesce(sum(coins_delta),0) from public.wallet_transactions where user_id = auth.uid()),
    'quests', (select coalesce(jsonb_agg(to_jsonb(q) order by coalesce(q.completed_at,q.created_at) desc,q.id desc),'[]'::jsonb)
      from public.quests q where q.user_id = auth.uid() and q.status in ('open','completed')),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc),'[]'::jsonb)
      from public.wallet_transactions t where t.user_id = auth.uid())
  ) where auth.uid() is not null;
$$;

create function public.wallet_app_mutate(p_request_id uuid, p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  old_payload jsonb;
  q public.quests%rowtype;
  expected public.quests%rowtype;
  action text := p_payload->>'action';
  v_title text := btrim(p_payload->>'title');
  reward integer;
  result jsonb;
begin
  if owner_id is null then raise exception '请重新登录' using errcode='42501'; end if;
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception '请求不完整' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet:' || owner_id::text,0));
  select payload into old_payload from wallet_private.requests where user_id=owner_id and request_id=p_request_id;
  if found then
    if old_payload <> p_payload then raise exception '同一请求不能改变内容' using errcode='22023'; end if;
    return public.wallet_app_read();
  end if;
  if action in ('create','edit') then
    if v_title is null or v_title = '' or coalesce(p_payload->>'reward_points','') !~ '^\d+$' then
      raise exception '请填写心愿名称和非负整数积分' using errcode='22023';
    end if;
    reward := (p_payload->>'reward_points')::integer;
  end if;
  if action in ('edit','delete','complete') then
    select * into q from public.quests where id=(p_payload->>'id')::uuid and user_id=owner_id for update;
    if not found then raise exception '心愿已删除，请刷新后重试' using errcode='P0001'; end if;
    expected := jsonb_populate_record(null::public.quests,p_payload->'expected');
    if p_payload->'expected' is null or q is distinct from expected then
      raise exception '心愿已在其他地方更新，请关闭编辑页刷新后重试' using errcode='P0001';
    end if;
    if q.status <> 'open' then raise exception '只有未完成心愿可以修改、完成或删除' using errcode='P0001'; end if;
  end if;
  case action
    when 'create' then
      if coalesce(p_payload->>'created_by','') not in ('chuanchuan','syzygy') then
        raise exception '请选择创建者' using errcode='22023';
      end if;
      insert into public.quests(id,user_id,created_by,title,description,reward_points,status)
      values((p_payload->>'id')::uuid,owner_id,p_payload->>'created_by',v_title,nullif(btrim(p_payload->>'description'),''),reward,'open');
    when 'edit' then
      update public.quests set title=v_title, description=nullif(btrim(p_payload->>'description'),''),reward_points=reward
        where id=q.id and user_id=owner_id;
    when 'delete' then
      delete from public.quests where id=q.id and user_id=owner_id and status='open';
    when 'complete' then
      result := public.complete_quest(q.id,p_payload->>'note',owner_id);
      if not (result->>'success')::boolean then raise exception '%',result->>'error'; end if;
    when 'exchange' then
      if coalesce(p_payload->>'points','') !~ '^\d+$' then raise exception '请填写整数积分' using errcode='22023'; end if;
      result := public.exchange_points_to_coins((p_payload->>'points')::integer,owner_id);
      if not (result->>'success')::boolean then raise exception '%',result->>'error'; end if;
    else raise exception '不支持的钱包操作' using errcode='22023';
  end case;
  insert into wallet_private.requests(user_id,request_id,payload) values(owner_id,p_request_id,p_payload);
  return public.wallet_app_read();
end $$;

revoke all on function public.wallet_app_read() from public,anon;
revoke all on function public.wallet_app_mutate(uuid,jsonb) from public,anon;
grant execute on function public.wallet_app_read(),public.wallet_app_mutate(uuid,jsonb) to authenticated;
revoke all on function public.complete_quest(uuid,text,uuid),public.exchange_points_to_coins(integer,uuid),public.spend_coins(numeric,text,uuid) from public,anon;
grant execute on function public.complete_quest(uuid,text,uuid),public.exchange_points_to_coins(integer,uuid),public.spend_coins(numeric,text,uuid) to authenticated,service_role;
