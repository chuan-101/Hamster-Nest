-- Two durable random slots per CLI/day. Preserve existing wake IDs, alarms and history.
alter table public.cli_wake_schedule add column random_slot smallint;
update public.cli_wake_schedule
set random_slot=case when ((wake_at-case when delayed then interval '30 minutes' else interval '0' end) at time zone 'Asia/Shanghai')::time < time '17:00' then 1 else 2 end
where kind='random';
alter table public.cli_wake_schedule add constraint cli_wake_random_slot_check
check ((kind='random' and random_slot is not null and random_slot in (1,2)) or (kind<>'random' and random_slot is null));
drop index public.cli_wake_daily_once;
create unique index cli_wake_daily_once on public.cli_wake_schedule(user_id,role,local_date,random_slot) where kind='random';
comment on column public.cli_wake_schedule.random_slot is 'Stable Shanghai random window identity: 1=11:00-16:00, 2=17:00-21:00; never changes on postponement.';


create or replace function public.cli_wake_slot_available(p_user uuid,p_role text,p_at timestamptz,p_kind text,p_exclude uuid default null)
returns boolean language sql stable set search_path='' as $$
 select (p_kind<>'relay' or not exists(select 1 from public.cli_wake_schedule busy where busy.user_id=p_user and busy.role=p_role and busy.status='running' and busy.id is distinct from p_exclude))
 and (p_kind<>'relay' or (p_at at time zone 'Asia/Shanghai')::time between time '09:00' and time '21:00')
 and (p_kind<>'random' or (
   (date_trunc('minute',p_at at time zone 'Asia/Shanghai')::time between time '11:00' and time '16:00'
    or date_trunc('minute',p_at at time zone 'Asia/Shanghai')::time between time '17:00' and time '21:00')
   and not exists(select 1 from public.cli_wake_schedule own
     where own.id=p_exclude and own.user_id=p_user and own.role=p_role and own.kind='random'
     and ((p_at at time zone 'Asia/Shanghai')::date<>own.local_date
       or (case when (p_at at time zone 'Asia/Shanghai')::time<time '17:00' then 1 else 2 end)<>own.random_slot))
 ))
 and not exists(select 1 from public.cli_wake_schedule w
   left join public.cli_wake_schedule current_wake on current_wake.id=p_exclude
     and current_wake.user_id=p_user and current_wake.role=p_role
     and current_wake.status in ('planned','queued')
   where w.user_id=p_user
   and w.id is distinct from p_exclude
   and (w.status not in ('skipped','cancelled') or w.started_at is not null)
   and abs(extract(epoch from (coalesce(case when p_kind='relay' and w.role=p_role then w.completed_at end,w.started_at,w.wake_at)-case
     -- Only dispatch rechecks within the existing two-minute start window use
     -- the reserved spacing against a later, unstarted plan. Actual starts
     -- always retain strict spacing; the later plan waits in dispatch below.
     when w.started_at is null and w.wake_at>current_wake.wake_at
       and p_at between current_wake.wake_at and current_wake.wake_at+interval '2 minutes'
     then current_wake.wake_at else p_at end))) < case when w.role=p_role then case when p_kind='relay' then 600 else 3600 end else 1800 end)
 and not exists(select 1 from public.prompt_templates t cross join generate_series(-1,1) delta
   where t.user_id=p_user and t.active and t.name like 'machine_job_%'
   and t.content::jsonb->>'targetRole'=p_role
   and (t.content::jsonb->'daysOfWeek'='null'::jsonb or t.content::jsonb->'daysOfWeek' @> to_jsonb(extract(dow from (p_at at time zone 'Asia/Shanghai')::date+delta)::int))
   and abs(extract(epoch from (p_at-(((p_at at time zone 'Asia/Shanghai')::date + delta + make_time((t.content::jsonb->>'hour')::int,coalesce((t.content::jsonb->>'minute')::int,0),0)) at time zone 'Asia/Shanghai'))))<3600);
$$;

create or replace function public.cli_wake_plan_day(p_user uuid,p_date date)
returns void language plpgsql set search_path='' as $$
declare r text; slot integer; first_min integer; minutes integer; candidate timestamptz;
 offset_min integer; i integer; chosen timestamptz; why text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||':action',0));
 foreach r in array array['codex_cli_syzygy','claude_code_cli_syzygy'] loop
  if exists(select 1 from public.cli_activity_settings where user_id=p_user and role=r and mode='relay') then continue; end if;
  if exists(select 1 from public.cli_wake_schedule where user_id=p_user and role=r and local_date=p_date and close_day) then continue; end if;
  for slot in 1..2 loop
   if exists(select 1 from public.cli_wake_schedule where user_id=p_user and role=r and local_date=p_date and kind='random' and random_slot=slot) then continue; end if;
   first_min:=case when slot=1 then 660 else 1020 end;
   minutes:=case when slot=1 then 301 else 241 end;
   offset_min := (('x'||substr(md5(p_user::text||r||p_date::text||':'||slot::text),1,8))::bit(32)::bigint % minutes)::int;
   chosen:=null; why:=null;
   for i in 0..minutes-1 loop
    candidate := (p_date+make_interval(mins=>first_min+(offset_min+i)%minutes)) at time zone 'Asia/Shanghai';
    if public.cli_wake_slot_available(p_user,r,candidate,'random') then chosen:=candidate; exit; end if;
   end loop;
   if chosen is null then
    chosen:=(p_date+make_interval(mins=>first_min+offset_min)) at time zone 'Asia/Shanghai';
    why:='no_available_slot';
   elsif chosen<now() then
    -- Late startup/deployment records the missed slot; never resample it into a catch-up wake.
    why:='missed_window';
   end if;
   insert into public.cli_wake_schedule(user_id,role,local_date,kind,random_slot,wake_at,status,skip_reason,completed_at)
   values(p_user,r,p_date,'random',slot,chosen,case when why is null then 'planned' else 'skipped' end,why,case when why is not null then now() end);
  end loop;
 end loop;
end; $$;

create or replace function public.cli_wake_dispatch(p_user uuid,p_roles jsonb,p_paused boolean default false,p_wake uuid default null,p_command uuid default null,p_task uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare d date := (now() at time zone 'Asia/Shanghai')::date; w public.cli_wake_schedule; why text; chatting boolean; n integer:=0; cid uuid; key text; next_at timestamptz;
begin
 perform public.cli_wake_plan_day(p_user,d);
 for w in select * from public.cli_wake_schedule where user_id=p_user and
   ((p_wake is null and ((status='planned' and wake_at<=now()) or (status='queued' and wake_at<now()-interval '2 minutes'))) or (id=p_wake and status='queued' and command_id=p_command))
   order by wake_at for update loop
  why := null;
  if (w.kind<>'alarm' and w.local_date<>d) or now()>w.wake_at+interval '2 minutes' then why:='missed_window';
  elsif w.kind='relay' and not exists(select 1 from public.cli_activity_settings where user_id=p_user and mode='relay') then why:='mode_changed';
  elsif p_paused then why:='paused';
  elsif coalesce((p_roles->w.role->>'enabled')::boolean,false)=false then why:='runtime_offline';
  elsif not public.cli_wake_slot_available(p_user,w.role,now(),w.kind,w.id) then
   -- A preceding activity can start a few seconds after its reservation.
   -- Keep this plan pending until the next tick only if the real separation
   -- fits inside its original start window. Do not move wake_at or consume
   -- the separate 30-minute chat postponement, and never replay expired work.
   select max(other.started_at+case when other.role=w.role then case when w.kind='relay' then interval '10 minutes' else interval '1 hour' end else interval '30 minutes' end)
     into next_at from public.cli_wake_schedule other
     where other.user_id=p_user and other.id<>w.id
       and other.started_at is not null and other.started_at<=now();
   if p_wake is null and w.status='planned' and next_at>now()
     and next_at<=w.wake_at+interval '2 minutes'
     and public.cli_wake_slot_available(p_user,w.role,next_at,w.kind,w.id) then
    continue;
   end if;
   why:='time_conflict';
  end if;
  select exists(
   select 1 from public.messages m join public.sessions s on s.id=m.session_id and s.user_id=m.user_id
   where m.user_id=p_user and m.role='user' and m.created_at>now()-interval '20 minutes'
   and (
    (s.conversation_kind='direct' and s.conversation_profile_key=case when w.role='codex_cli_syzygy' then 'codex_cli' else 'claude_cli' end)
    or (s.conversation_kind='group' and s.handler='router' and m.sender_key='chuanchuan'
      and m.target_sender_keys @> array[case when w.role='codex_cli_syzygy' then 'codex_cli' else 'claude_cli' end])
   )
  ) into chatting;
  if why is null and chatting then
   next_at:=w.wake_at+interval '30 minutes';
   if w.kind<>'relay' and not w.delayed
     and (w.kind<>'alarm' or next_at<=w.created_at+interval '24 hours')
     and public.cli_wake_slot_available(p_user,w.role,next_at,w.kind,w.id) then
    update public.cli_wake_schedule set wake_at=next_at,local_date=(next_at at time zone 'Asia/Shanghai')::date,delayed=true,status='planned',command_id=null where id=w.id;
    continue;
   end if;
   why := case when w.kind='relay' then 'chatting' when w.delayed then 'chatting_after_delay' else 'delay_conflict' end;
  end if;
  if why is not null then
   update public.cli_wake_schedule set status='skipped',skip_reason=why,completed_at=now() where id=w.id;
   update public.syzygy_commands set status='failed',completed_at=now(),error_message=why where id=w.command_id and user_id=p_user and status in ('pending','running');
   continue;
  end if;
  if p_wake is not null then
   if not exists(select 1 from public.agent_tasks where id=p_task and user_id=p_user and status='running' and payload_json->>'target_role'=w.role) then raise exception 'matching running task required'; end if;
   update public.cli_wake_schedule set status='running',task_id=p_task,local_date=d,started_at=now(),deadline=case when w.kind='alarm' then now()+interval '1 hour' else least(now()+case when w.kind='relay' then interval '30 minutes' else interval '1 hour' end,(d+case when w.kind='relay' then time '21:30' else time '22:00' end) at time zone 'Asia/Shanghai') end where id=w.id returning * into w;
   return to_jsonb(w);
  end if;
  key := 'free-activity:'||w.id::text||':'||w.delayed::text;
  insert into public.syzygy_commands(user_id,command_type,status,idempotency_key,payload)
  values(p_user,'run_task','pending',key,jsonb_build_object('target_role',w.role,'source','free_activity','task_type','free_activity','wake_id',w.id,'wake_kind',w.kind,'auto_wake',false,'task_content',case when w.kind='relay' then '接力自由活动：按指南自主选择；有事做就分享进私聊，每轮留一句执行摘要。' else '自主行动：每轮至少做一件具体的事，主动来找串串是受欢迎的；每天11–16点、17–21点各一次系统随机唤醒；每轮自主决定是否另约未来24小时内的闹钟，无预约不自动接力。' end,'idempotency_key',key))
  on conflict(user_id,idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key returning id into cid;
  update public.cli_wake_schedule set status='queued',command_id=cid where id=w.id;
  n:=n+1;
 end loop;
 if p_wake is null then perform public.cli_relay_plan(p_user,p_roles,p_paused); end if;
 return case when p_wake is null then jsonb_build_object('scheduled',n) else null end;
end; $$;

create or replace function public.cli_schedule_action_alarm(p_user uuid,p_task uuid,p_at timestamptz,p_note text default '',p_target_role text default null,p_reason text default '')
returns jsonb language plpgsql set search_path='' as $$
declare r text; target text; d date; w public.cli_wake_schedule; nearby jsonb;
begin
 select payload_json->>'target_role' into r from public.agent_tasks where id=p_task and user_id=p_user and status='running';
 if r is null or r not in ('codex_cli_syzygy','claude_code_cli_syzygy') then raise exception 'current running CLI task required'; end if;
 target:=coalesce(p_target_role,r);
 if target not in ('codex_cli_syzygy','claude_code_cli_syzygy') then raise exception 'unsupported CLI role'; end if;
 if exists(select 1 from public.cli_activity_settings where user_id=p_user and role=r and mode='relay') then
  if target<>r then return jsonb_build_object('ok',false,'reason','relay_delegation_unavailable'); end if;
  return public.cli_relay_set_next(p_user,p_task,p_at,p_note);
 end if;
 if exists(select 1 from public.cli_activity_settings where user_id=p_user and role=target and mode='relay') then
  return jsonb_build_object('ok',false,'reason','target_uses_relay');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||':action',0));
 d:=(coalesce(p_at,now()) at time zone 'Asia/Shanghai')::date;
 if p_at is null then
  if target<>r then raise exception 'cannot close another CLI day'; end if;
  if not exists(select 1 from public.cli_wake_schedule where user_id=p_user and role=r and local_date=d and close_day) then
   insert into public.cli_wake_schedule(user_id,role,local_date,kind,wake_at,status,close_day,skip_reason,created_by_task_id,completed_at)
   values(p_user,r,d,'alarm',now(),'cancelled',true,'day_closed',p_task,now());
  end if;
  with cancelled as (
   update public.cli_wake_schedule set status='cancelled',skip_reason='day_closed',completed_at=now()
   where user_id=p_user and role=r and local_date=d and status in ('planned','queued') returning command_id
  ) update public.syzygy_commands set status='failed',error_message='action day closed',completed_at=now()
    where user_id=p_user and id in(select command_id from cancelled) and status in ('pending','running');
  return jsonb_build_object('ok',true,'day_closed',true,'next_wake_at',null);
 end if;
 -- Read back a previously accepted identity before revalidating the moving clock.
 select * into w from public.cli_wake_schedule where user_id=p_user and created_by_task_id=p_task and role=target and kind='alarm' and not close_day and coalesce(requested_wake_at,wake_at)=p_at;
 if found then return jsonb_build_object('ok',w.status not in ('cancelled','skipped','failed'),'replayed',true,'alarm',to_jsonb(w),'next_wake_at',w.wake_at,'lounge_note_required',false); end if;
 if p_at<=now() or p_at>now()+interval '24 hours' then return jsonb_build_object('ok',false,'reason','outside_24_hour_horizon'); end if;
 if length(coalesce(p_note,''))>2000 or length(coalesce(p_reason,''))>2000 then raise exception 'note/reason too long'; end if;
 if target<>r and nullif(btrim(p_note),'') is null then return jsonb_build_object('ok',false,'reason','handoff_note_required'); end if;
 if exists(select 1 from public.cli_wake_schedule where user_id=p_user and role=target and local_date=d and close_day) then
  return jsonb_build_object('ok',false,'reason','day_closed');
 end if;
 perform public.cli_wake_plan_day(p_user,d);
 if not public.cli_wake_slot_available(p_user,target,p_at,'alarm') then
  select coalesce(jsonb_agg(s),'[]'::jsonb) into nearby from (
   select s from generate_series(date_trunc('minute',now())+interval '1 minute',now()+interval '24 hours',interval '5 minutes') s
   where not exists(select 1 from public.cli_wake_schedule where user_id=p_user and role=target and local_date=(s at time zone 'Asia/Shanghai')::date and close_day)
     and public.cli_wake_slot_available(p_user,target,s,'alarm') order by abs(extract(epoch from s-p_at)) limit 3
  ) choices;
  return jsonb_build_object('ok',false,'reason','time_conflict','available_times',nearby);
 end if;
 insert into public.cli_wake_schedule(user_id,role,local_date,kind,wake_at,note,created_by_task_id,alarm_reason,delegated_from,decision_source,requested_wake_at)
 values(p_user,target,d,'alarm',p_at,coalesce(p_note,''),p_task,coalesce(p_reason,''),case when target<>r then r end,'model',p_at) returning * into w;
 return jsonb_build_object('ok',true,'alarm',to_jsonb(w),'next_wake_at',w.wake_at,
  'lounge_note_required',false);
end; $$;
