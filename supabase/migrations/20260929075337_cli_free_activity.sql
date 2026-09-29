-- Free activity reuses run_task. All mutations are machine-only and serialize owner/day.
create table public.cli_wake_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('codex_cli_syzygy','claude_code_cli_syzygy')),
  local_date date not null,
  kind text not null check (kind in ('random','alarm')),
  wake_at timestamptz not null,
  note text not null default '',
  status text not null default 'planned' check (status in ('planned','queued','running','completed','failed','cancelled','skipped')),
  skip_reason text,
  delayed boolean not null default false,
  created_by_task_id uuid references public.agent_tasks(id),
  command_id uuid references public.syzygy_commands(id),
  task_id uuid references public.agent_tasks(id),
  started_at timestamptz,
  deadline timestamptz,
  completed_at timestamptz,
  diary_missing boolean,
  created_at timestamptz not null default now(),
  unique(user_id,role,local_date,kind)
);
alter table public.cli_wake_schedule enable row level security;
revoke all on public.cli_wake_schedule from public,anon,authenticated;
grant select on public.cli_wake_schedule to authenticated;
grant all on public.cli_wake_schedule to service_role;
create policy cli_wake_read_own on public.cli_wake_schedule for select to authenticated using ((select auth.uid())=user_id);
create index cli_wake_due on public.cli_wake_schedule(user_id,wake_at) where status in ('planned','queued');
create index cli_wake_missing_diary on public.cli_wake_schedule(user_id,role,local_date desc) where diary_missing;

create function public.cli_wake_slot_available(p_user uuid,p_role text,p_at timestamptz,p_kind text,p_exclude uuid default null)
returns boolean language sql stable set search_path='' as $$
 select date_trunc('minute',p_at at time zone 'Asia/Shanghai')::time between
   case when p_kind='random' then time '13:00' else time '09:00' end and
   case when p_kind='random' then time '19:00' else time '21:00' end
 and not exists(select 1 from public.cli_wake_schedule w where w.user_id=p_user
   and w.local_date=(p_at at time zone 'Asia/Shanghai')::date and w.id is distinct from p_exclude
   and (w.status not in ('skipped','cancelled') or w.started_at is not null)
   and abs(extract(epoch from (coalesce(w.started_at,w.wake_at)-p_at))) < case when w.role=p_role then 3600 else 1800 end)
 and not exists(select 1 from public.prompt_templates t
   where t.user_id=p_user and t.active and t.name like 'machine_job_%'
   and t.content::jsonb->>'targetRole'=p_role
   and (t.content::jsonb->'daysOfWeek'='null'::jsonb or t.content::jsonb->'daysOfWeek' @> to_jsonb(extract(dow from p_at at time zone 'Asia/Shanghai')::int))
   and abs(extract(epoch from (p_at-(((p_at at time zone 'Asia/Shanghai')::date + make_time((t.content::jsonb->>'hour')::int,coalesce((t.content::jsonb->>'minute')::int,0),0)) at time zone 'Asia/Shanghai'))))<3600);
$$;

create function public.cli_wake_plan_day(p_user uuid,p_date date)
returns void language plpgsql set search_path='' as $$
declare r text; candidate timestamptz; offset_min integer; i integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_date::text,0));
 foreach r in array array['codex_cli_syzygy','claude_code_cli_syzygy'] loop
  if exists(select 1 from public.cli_wake_schedule where user_id=p_user and role=r and local_date=p_date and kind='random') then continue; end if;
  offset_min := (('x'||substr(md5(p_user::text||r||p_date::text),1,8))::bit(32)::bigint % 361)::int;
  for i in 0..360 loop
   candidate := (p_date+time '13:00'+make_interval(mins=>(offset_min+i)%361)) at time zone 'Asia/Shanghai';
   if public.cli_wake_slot_available(p_user,r,candidate,'random') then
    insert into public.cli_wake_schedule(user_id,role,local_date,kind,wake_at) values(p_user,r,p_date,'random',candidate);
    exit;
   end if;
  end loop;
 end loop;
end; $$;

-- Role is derived from the live task, never from an MCP caller-supplied target role.
create function public.cli_set_self_alarm(p_user uuid,p_task uuid,p_at timestamptz,p_note text default '')
returns jsonb language plpgsql set search_path='' as $$
declare r text; d date := (now() at time zone 'Asia/Shanghai')::date; w public.cli_wake_schedule; nearby jsonb;
begin
 select payload_json->>'target_role' into r from public.agent_tasks where id=p_task and user_id=p_user and status='running';
 if r is null or r not in ('codex_cli_syzygy','claude_code_cli_syzygy') then raise exception 'current running CLI task required'; end if;
 perform public.cli_wake_plan_day(p_user,d);
 select * into w from public.cli_wake_schedule where user_id=p_user and role=r and local_date=d and kind='alarm';
 if found then return jsonb_build_object('ok',w.created_by_task_id=p_task and w.wake_at=p_at,'reason','daily_alarm_exists','alarm',to_jsonb(w)); end if;
 if (p_at at time zone 'Asia/Shanghai')::date<>d or p_at<=now() or not public.cli_wake_slot_available(p_user,r,p_at,'alarm') then
  select coalesce(jsonb_agg(s),'[]'::jsonb) into nearby from (
   select s from generate_series((d+time '09:00') at time zone 'Asia/Shanghai',(d+time '21:00') at time zone 'Asia/Shanghai',interval '5 minutes') s
   where s>now() and public.cli_wake_slot_available(p_user,r,s,'alarm') order by abs(extract(epoch from s-p_at)) limit 3
  ) choices;
  return jsonb_build_object('ok',false,'reason','time_conflict','available_times',nearby);
 end if;
 insert into public.cli_wake_schedule(user_id,role,local_date,kind,wake_at,note,created_by_task_id)
 values(p_user,r,d,'alarm',p_at,left(p_note,2000),p_task) returning * into w;
 return jsonb_build_object('ok',true,'alarm',to_jsonb(w));
end; $$;

-- Tick and execution both validate: queue delays must never turn into missed-wake catch-up.
create function public.cli_wake_dispatch(p_user uuid,p_roles jsonb,p_paused boolean default false,p_wake uuid default null,p_command uuid default null,p_task uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare d date := (now() at time zone 'Asia/Shanghai')::date; w public.cli_wake_schedule; why text; chatting boolean; n integer:=0; cid uuid; key text; next_at timestamptz;
begin
 perform public.cli_wake_plan_day(p_user,d);
 for w in select * from public.cli_wake_schedule where user_id=p_user and
   ((p_wake is null and ((status='planned' and wake_at<=now()) or (status='queued' and wake_at<now()-interval '2 minutes'))) or (id=p_wake and status='queued' and command_id=p_command))
   order by wake_at for update loop
  why := null;
  if w.local_date<>d or now()>w.wake_at+interval '2 minutes' then why:='missed_window';
  elsif p_paused then why:='paused';
  elsif coalesce((p_roles->w.role->>'enabled')::boolean,false)=false then why:='runtime_offline';
  elsif not public.cli_wake_slot_available(p_user,w.role,now(),w.kind,w.id) then why:='time_conflict';
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
   if not w.delayed and public.cli_wake_slot_available(p_user,w.role,next_at,w.kind,w.id) then
    update public.cli_wake_schedule set wake_at=next_at,delayed=true,status='planned',command_id=null where id=w.id;
    continue;
   end if;
   why := case when w.delayed then 'chatting_after_delay' else 'delay_conflict' end;
  end if;
  if why is not null then
   update public.cli_wake_schedule set status='skipped',skip_reason=why,completed_at=now() where id=w.id;
   update public.syzygy_commands set status='failed',completed_at=now(),error_message=why where id=w.command_id and user_id=p_user and status in ('pending','running');
   continue;
  end if;
  if p_wake is not null then
   if not exists(select 1 from public.agent_tasks where id=p_task and user_id=p_user and status='running' and payload_json->>'target_role'=w.role) then raise exception 'matching running task required'; end if;
   update public.cli_wake_schedule set status='running',task_id=p_task,started_at=now(),deadline=least(now()+interval '1 hour',(d+case when w.kind='random' then time '20:00' else time '22:00' end) at time zone 'Asia/Shanghai') where id=w.id returning * into w;
   return to_jsonb(w);
  end if;
  key := 'free-activity:'||w.id::text||':'||w.delayed::text;
  insert into public.syzygy_commands(user_id,command_type,status,idempotency_key,payload)
  values(p_user,'run_task','pending',key,jsonb_build_object('target_role',w.role,'source','free_activity','task_type','free_activity','wake_id',w.id,'wake_kind',w.kind,'auto_wake',false,'task_content','自由活动：按云端指南和菜单自主选择，结束前写日记。','idempotency_key',key))
  on conflict(user_id,idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key returning id into cid;
  update public.cli_wake_schedule set status='queued',command_id=cid where id=w.id;
  n:=n+1;
 end loop;
 return case when p_wake is null then jsonb_build_object('scheduled',n) else null end;
end; $$;

create function public.cli_wake_finish(p_user uuid,p_wake uuid,p_task uuid,p_status text,p_reason text default null)
returns jsonb language plpgsql set search_path='' as $$
declare w public.cli_wake_schedule; missing boolean;
begin
 if p_status not in ('completed','failed','cancelled') then raise exception 'invalid finish status'; end if;
 select * into w from public.cli_wake_schedule where user_id=p_user and id=p_wake and task_id=p_task for update;
 if not found then return null; end if;
 select not exists(select 1 from public.diary_entries where user_id=p_user and author=replace(w.role,'_syzygy','') and metadata->>'task_id'=p_task::text) into missing;
 update public.cli_wake_schedule set status=p_status,skip_reason=p_reason,diary_missing=missing,completed_at=now() where id=w.id;
 return jsonb_build_object('source',w.kind,'wake_id',w.id,'started_at',w.started_at,'deadline',w.deadline,'ended_at',now(),'duration_seconds',extract(epoch from now()-w.started_at),'end_reason',coalesce(p_reason,p_status),'diary_missing',missing);
end; $$;

-- Called once on Mini startup: don't replay a crashed activity.
create function public.cli_wake_recover(p_user uuid,p_before timestamptz)
returns integer language plpgsql set search_path='' as $$
declare w public.cli_wake_schedule; receipt jsonb; n integer:=0; ending text; reason text;
begin
 for w in select * from public.cli_wake_schedule where user_id=p_user and status='running'
   and (started_at<p_before or deadline<now()-interval '5 minutes') for update loop
  select case when status in ('completed','cancelled') then status else 'failed' end into ending from public.agent_tasks where id=w.task_id and user_id=p_user;
  ending:=coalesce(ending,'failed');
  reason:=case when ending='completed' then 'completed' when w.started_at<p_before then 'runtime_restarted' else 'deadline_expired' end;
  receipt:=public.cli_wake_finish(p_user,w.id,w.task_id,ending,reason);
  update public.agent_tasks set status=ending,completed_at=coalesce(completed_at,now()),error=case when ending='completed' then null else reason end,payload_json=payload_json||jsonb_build_object('free_activity',receipt) where id=w.task_id and user_id=p_user;
  update public.syzygy_commands set status=case when ending='completed' then 'done' else 'failed' end,completed_at=now(),error_message=case when ending='completed' then null else reason||'; activity will not replay' end where id=w.command_id and user_id=p_user;
  n:=n+1;
 end loop;
 return n;
end; $$;

create unique index diary_activity_task_once on public.diary_entries(user_id,author,(metadata->>'task_id'))
 where activity_type='free_activity' and metadata->>'task_id' is not null;

create function public.cli_diary_receipt_guard() returns trigger language plpgsql set search_path='' as $$
declare w public.cli_wake_schedule;
begin
 if new.activity_type<>'free_activity' or new.author not in ('codex_cli','claude_code_cli') then return new; end if;
 if new.metadata->>'task_id' is null then raise exception 'free activity receipt requires original task_id'; end if;
 select * into w from public.cli_wake_schedule where user_id=new.user_id and task_id=(new.metadata->>'task_id')::uuid and role=new.author||'_syzygy';
 if not found then raise exception 'receipt must link to original activity task and author'; end if;
 new.metadata:=new.metadata||jsonb_build_object('wake_id',w.id);
 return new;
end; $$;
create trigger cli_diary_receipt_guard before insert or update on public.diary_entries for each row execute function public.cli_diary_receipt_guard();

create function public.cli_diary_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.author not in ('codex_cli','claude_code_cli') then return new; end if;
 insert into public.agent_events(user_id,actor,event_type,entity_type,entity_id,title,payload,importance)
 values(new.user_id,'system','cli_diary_created','diary_entry',new.id,
 case when new.author='codex_cli' then 'Codex CLI 写了一篇日记' else 'Claude CLI 写了一篇日记' end,
 jsonb_build_object('screen','diary','params',jsonb_build_object('date',new.entry_date::text),'url','/#/diary/'||new.entry_date::text),'high');
 if new.activity_type='free_activity' then
  update public.cli_wake_schedule set diary_missing=false where user_id=new.user_id and task_id=(new.metadata->>'task_id')::uuid;
  update public.agent_tasks set payload_json=jsonb_set(payload_json,'{free_activity,diary_missing}','false'::jsonb) where user_id=new.user_id and id=(new.metadata->>'task_id')::uuid and payload_json ? 'free_activity';
 end if;
 return new;
end; $$;
create trigger cli_diary_notification after insert on public.diary_entries for each row execute function public.cli_diary_notification();

revoke all on function public.cli_wake_slot_available(uuid,text,timestamptz,text,uuid),public.cli_wake_plan_day(uuid,date),public.cli_set_self_alarm(uuid,uuid,timestamptz,text),public.cli_wake_dispatch(uuid,jsonb,boolean,uuid,uuid,uuid),public.cli_wake_finish(uuid,uuid,uuid,text,text),public.cli_wake_recover(uuid,timestamptz),public.cli_diary_receipt_guard(),public.cli_diary_notification() from public,anon,authenticated;
grant execute on function public.cli_wake_slot_available(uuid,text,timestamptz,text,uuid),public.cli_wake_plan_day(uuid,date),public.cli_set_self_alarm(uuid,uuid,timestamptz,text),public.cli_wake_dispatch(uuid,jsonb,boolean,uuid,uuid,uuid),public.cli_wake_finish(uuid,uuid,uuid,text,text),public.cli_wake_recover(uuid,timestamptz) to service_role;
