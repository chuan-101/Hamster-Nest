-- Preserve reserved spacing despite polling drift, without weakening actual
-- start spacing, the two-minute expiry, fixed-job priority or manual controls.
-- Existing signatures/privileges, owner/day advisory lock and history remain.

create or replace function public.cli_wake_slot_available(p_user uuid,p_role text,p_at timestamptz,p_kind text,p_exclude uuid default null)
returns boolean language sql stable set search_path='' as $$
 select date_trunc('minute',p_at at time zone 'Asia/Shanghai')::time between
   case when p_kind='random' then time '13:00' else time '09:00' end and
   case when p_kind='random' then time '19:00' else time '21:00' end
 and not exists(select 1 from public.cli_wake_schedule w
   left join public.cli_wake_schedule current_wake on current_wake.id=p_exclude
     and current_wake.user_id=p_user and current_wake.role=p_role
     and current_wake.status in ('planned','queued')
   where w.user_id=p_user
   and w.local_date=(p_at at time zone 'Asia/Shanghai')::date and w.id is distinct from p_exclude
   and (w.status not in ('skipped','cancelled') or w.started_at is not null)
   and abs(extract(epoch from (coalesce(w.started_at,w.wake_at)-case
     -- Only dispatch rechecks within the existing two-minute start window use
     -- the reserved spacing against a later, unstarted plan. Actual starts
     -- always retain strict spacing; the later plan waits in dispatch below.
     when w.started_at is null and w.wake_at>current_wake.wake_at
       and p_at between current_wake.wake_at and current_wake.wake_at+interval '2 minutes'
     then current_wake.wake_at else p_at end))) < case when w.role=p_role then 3600 else 1800 end)
 and not exists(select 1 from public.prompt_templates t
   where t.user_id=p_user and t.active and t.name like 'machine_job_%'
   and t.content::jsonb->>'targetRole'=p_role
   and (t.content::jsonb->'daysOfWeek'='null'::jsonb or t.content::jsonb->'daysOfWeek' @> to_jsonb(extract(dow from p_at at time zone 'Asia/Shanghai')::int))
   and abs(extract(epoch from (p_at-(((p_at at time zone 'Asia/Shanghai')::date + make_time((t.content::jsonb->>'hour')::int,coalesce((t.content::jsonb->>'minute')::int,0),0)) at time zone 'Asia/Shanghai'))))<3600);
$$;

create or replace function public.cli_wake_dispatch(p_user uuid,p_roles jsonb,p_paused boolean default false,p_wake uuid default null,p_command uuid default null,p_task uuid default null)
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
  elsif not public.cli_wake_slot_available(p_user,w.role,now(),w.kind,w.id) then
   -- A preceding activity can start a few seconds after its reservation.
   -- Keep this plan pending until the next tick only if the real separation
   -- fits inside its original start window. Do not move wake_at or consume
   -- the separate 30-minute chat postponement, and never replay expired work.
   select max(other.started_at+case when other.role=w.role then interval '1 hour' else interval '30 minutes' end)
     into next_at from public.cli_wake_schedule other
     where other.user_id=p_user and other.local_date=d and other.id<>w.id
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

