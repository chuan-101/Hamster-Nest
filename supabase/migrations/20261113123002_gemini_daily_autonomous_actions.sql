-- Gemini takes the two daily windows for owners with its independent port enabled.
alter table public.cli_wake_schedule drop constraint cli_wake_schedule_role_check,
  add constraint cli_wake_schedule_role_check check (role in ('codex_cli_syzygy','claude_code_cli_syzygy','gemini_cli_syzygy'));
alter table public.diary_entries drop constraint diary_entries_author_check,
  add constraint diary_entries_author_check check (author in ('claude','gpt','gemini','codex_cli','claude_code_cli','gemini_cli'));
alter table public.diary_locks drop constraint diary_locks_author_check,
  add constraint diary_locks_author_check check (author in ('claude','gpt','gemini','codex_cli','claude_code_cli','gemini_cli'));
alter table public.diary_unlocks drop constraint diary_unlocks_author_check,
  add constraint diary_unlocks_author_check check (author in ('claude','gpt','gemini','codex_cli','claude_code_cli','gemini_cli'));
alter table public.diary_comments drop constraint diary_comments_author_check,
  add constraint diary_comments_author_check check (author in ('chuanchuan','claude','gpt','gemini','codex_cli','claude_code_cli','gemini_cli'));

CREATE OR REPLACE FUNCTION public.cli_action_append_diary(p_user uuid, p_task uuid, p_actions jsonb, p_diary text DEFAULT NULL::text, p_allow_shared boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w public.cli_wake_schedule; page public.diary_entries; segment jsonb; body text;
begin
 select * into w from public.cli_wake_schedule where user_id=p_user and task_id=p_task and role in ('codex_cli_syzygy','claude_code_cli_syzygy','gemini_cli_syzygy');
 if not found then raise exception 'matching action task required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||w.role||w.local_date::text,0));
 select * into page from public.diary_entries where user_id=p_user and author=replace(w.role,'_syzygy','') and entry_date=w.local_date and activity_type='free_activity' order by id limit 1 for update;
 if page.metadata->'action_segments' @> jsonb_build_array(jsonb_build_object('task_id',p_task)) then return jsonb_build_object('id',page.id,'replayed',true); end if;
 if w.status<>'running' or not exists(select 1 from public.agent_tasks where id=p_task and user_id=p_user and status='running' and payload_json->>'target_role'=w.role) then raise exception 'running action required'; end if;
 if page.visibility='shared' and not p_allow_shared then raise exception 'today diary is shared; allow_shared is required to append publicly'; end if;
 if jsonb_typeof(p_actions) is distinct from 'array' then raise exception 'actions must be an array'; end if;
 if jsonb_array_length(p_actions) not between 1 and 40 or exists(select 1 from jsonb_array_elements(p_actions) a where jsonb_typeof(a)<>'string' or nullif(btrim(a#>>'{}'),'') is null or length(a#>>'{}')>1000) then raise exception 'at least one concrete action required'; end if;
 if length(coalesce(p_diary,''))>12000 then raise exception 'diary too long'; end if;
 select E'## 行动记录\n'||string_agg('- '||to_char(now() at time zone 'Asia/Shanghai','HH24:MI')||' '||a,E'\n') into body from jsonb_array_elements_text(p_actions) a;
 if nullif(btrim(p_diary),'') is not null then body:=body||E'\n\n## 日记\n'||p_diary; end if;
 segment:=jsonb_build_object('task_id',p_task,'wake_id',w.id,'at',now(),'actions',p_actions);
 if page.id is null then
  insert into public.diary_entries(user_id,author,entry_date,activity_type,title,content,metadata)
  values(p_user,replace(w.role,'_syzygy',''),w.local_date,'free_activity','自主行动',body,
    jsonb_build_object('task_id',p_task,'wake_id',w.id,'relay',true,'autonomous_action',true,'segments',jsonb_build_array(segment),'action_segments',jsonb_build_array(segment))) returning * into page;
 else
  update public.diary_entries set content=content||E'\n\n---\n\n'||body,
    metadata=metadata||jsonb_build_object('autonomous_action',true,'action_segments',coalesce(metadata->'action_segments','[]'::jsonb)||jsonb_build_array(segment))
  where id=page.id returning * into page;
 end if;
 update public.cli_wake_schedule set diary_missing=false where user_id=p_user and role=w.role and local_date=w.local_date and diary_missing;
 update public.agent_tasks t set payload_json=jsonb_set(t.payload_json,'{free_activity,diary_missing}','false'::jsonb)
 where t.user_id=p_user and t.payload_json ? 'free_activity' and t.id in(select task_id from public.cli_wake_schedule where user_id=p_user and role=w.role and local_date=w.local_date);
 update public.cli_wake_schedule set summary_missing=false where id=w.id;
 return jsonb_build_object('id',page.id,'entry_date',page.entry_date,'replayed',false);
end; $function$;

CREATE OR REPLACE FUNCTION public.cli_diary_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.author not in ('codex_cli','claude_code_cli','gemini_cli') then return new; end if;
 insert into public.agent_events(user_id,actor,event_type,entity_type,entity_id,title,payload,importance)
 values(new.user_id,'system','cli_diary_created','diary_entry',new.id,
 case when new.author='codex_cli' then 'Codex CLI 写了一篇日记' when new.author='gemini_cli' then 'Gemini CLI 写了一篇日记' else 'Claude CLI 写了一篇日记' end,
 jsonb_build_object('screen','diary','params',jsonb_build_object('date',new.entry_date::text),'url','/#/diary/'||new.entry_date::text),'high');
 if new.activity_type='free_activity' then
  update public.cli_wake_schedule set diary_missing=false where user_id=new.user_id and task_id=(new.metadata->>'task_id')::uuid;
  update public.agent_tasks set payload_json=jsonb_set(payload_json,'{free_activity,diary_missing}','false'::jsonb) where user_id=new.user_id and id=(new.metadata->>'task_id')::uuid and payload_json ? 'free_activity';
 end if;
 return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.cli_diary_receipt_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w public.cli_wake_schedule;
begin
 if new.activity_type<>'free_activity' or new.author not in ('codex_cli','claude_code_cli','gemini_cli') then return new; end if;
 if new.metadata->>'task_id' is null then raise exception 'free activity receipt requires original task_id'; end if;
 select * into w from public.cli_wake_schedule where user_id=new.user_id and task_id=(new.metadata->>'task_id')::uuid and role=new.author||'_syzygy';
 if not found then raise exception 'receipt must link to original activity task and author'; end if;
 if w.kind='relay' and (new.metadata->>'relay' is distinct from 'true' or jsonb_typeof(new.metadata->'segments') is distinct from 'array') then raise exception 'relay diary requires append_relay_diary'; end if;
 new.metadata:=new.metadata||jsonb_build_object('wake_id',w.id);
 return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.cli_relay_share(p_user uuid, p_task uuid, p_wake uuid, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w public.cli_wake_schedule; sid uuid; mid uuid; sender text;
begin
 select * into w from public.cli_wake_schedule where user_id=p_user and id=p_wake and task_id=p_task and role in ('claude_code_cli_syzygy','codex_cli_syzygy','gemini_cli_syzygy') for update;
 if not found then raise exception 'matching relay task required'; end if;
 if w.share_message_id is not null then return jsonb_build_object('message_id',w.share_message_id,'replayed',true); end if;
 if w.status<>'running' or not exists(select 1 from public.agent_tasks where id=p_task and user_id=p_user and status='running' and payload_json->>'target_role'=w.role) then raise exception 'running relay required'; end if;
 if nullif(btrim(p_content),'') is null or length(p_content)>4000 then raise exception 'share must contain 1 to 4000 characters'; end if;
 sender:=case w.role when 'codex_cli_syzygy' then 'codex_cli' when 'gemini_cli_syzygy' then 'gemini_cli' else 'claude_cli' end;
 select id into strict sid from public.sessions where user_id=p_user and session_key='syzygy_'||sender and conversation_profile_key=sender and conversation_kind='direct' and handler='cli' and not is_archived;
 insert into public.messages(user_id,session_id,role,sender_key,content,client_id,client_created_at,meta)
 values(p_user,sid,'assistant',sender,p_content,w.id,now(),jsonb_build_object('schema_version',1,'source',case when w.kind='relay' then 'cli_relay' else 'cli_autonomous_action' end,'delivery_state','completed','wake_id',w.id,'task_id',p_task)) returning id into mid;
 insert into public.agent_events(user_id,actor,event_type,entity_type,entity_id,title,payload,importance)
 values(p_user,sender,'cli_relay_shared','conversation_message',mid,'Syzygy 来找你啦',jsonb_build_object('schema_version',1,'screen','conversation_detail','params',jsonb_build_object('id',sid),'url','/#/chat?session='||sid,'session_id',sid,'message_id',mid,'sender_key',sender,'wake_id',w.id,'task_id',p_task),'high');
 update public.cli_wake_schedule set share_message_id=mid where id=w.id;
 return jsonb_build_object('message_id',mid,'session_id',sid,'replayed',false);
end; $function$;

CREATE OR REPLACE FUNCTION public.cli_schedule_action_alarm(p_user uuid, p_task uuid, p_at timestamp with time zone, p_note text DEFAULT ''::text, p_target_role text DEFAULT NULL::text, p_reason text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r text; target text; d date; w public.cli_wake_schedule; nearby jsonb;
begin
 select payload_json->>'target_role' into r from public.agent_tasks where id=p_task and user_id=p_user and status='running';
 if r is null or r not in ('codex_cli_syzygy','claude_code_cli_syzygy','gemini_cli_syzygy') then raise exception 'current running CLI task required'; end if;
 target:=coalesce(p_target_role,r);
 if target='claude_code_cli_syzygy' and exists(select 1 from public.generation_ports where user_id=p_user and port_key='gemini_cli' and active) then
  return jsonb_build_object('ok',false,'reason','target_offline');
 end if;
 if target not in ('codex_cli_syzygy','claude_code_cli_syzygy','gemini_cli_syzygy') then raise exception 'unsupported CLI role'; end if;
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
end; $function$;

CREATE OR REPLACE FUNCTION public.cli_wake_dispatch(p_user uuid, p_roles jsonb, p_paused boolean DEFAULT false, p_wake uuid DEFAULT NULL::uuid, p_command uuid DEFAULT NULL::uuid, p_task uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    (s.conversation_kind='direct' and s.conversation_profile_key=case w.role when 'codex_cli_syzygy' then 'codex_cli' when 'gemini_cli_syzygy' then 'gemini_cli' else 'claude_cli' end)
    or (s.conversation_kind='group' and s.handler='router' and m.sender_key='chuanchuan'
      and m.target_sender_keys @> array[case w.role when 'codex_cli_syzygy' then 'codex_cli' when 'gemini_cli_syzygy' then 'gemini_cli' else 'claude_cli' end])
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
end; $function$;

CREATE OR REPLACE FUNCTION public.cli_wake_plan_day(p_user uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r text; slot integer; first_min integer; minutes integer; candidate timestamptz;
 offset_min integer; i integer; chosen timestamptz; why text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||':action',0));
 foreach r in array array['codex_cli_syzygy',case when exists(select 1 from public.generation_ports where user_id=p_user and port_key='gemini_cli' and active)
   then 'gemini_cli_syzygy' else 'claude_code_cli_syzygy' end] loop
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
end; $function$;

CREATE OR REPLACE FUNCTION public.cli_wake_slot_available(p_user uuid, p_role text, p_at timestamp with time zone, p_kind text, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
   and (case when t.name in ('machine_job_claude_morning_share','machine_job_claude_daily_maintenance','machine_job_claude_weekly_digest')
     and t.content::jsonb->>'targetRole'='claude_code_cli_syzygy' and exists(select 1 from public.generation_ports where user_id=p_user and port_key='gemini_cli' and active)
     then 'gemini_cli_syzygy' else t.content::jsonb->>'targetRole' end)=p_role
   and (t.content::jsonb->'daysOfWeek'='null'::jsonb or t.content::jsonb->'daysOfWeek' @> to_jsonb(extract(dow from (p_at at time zone 'Asia/Shanghai')::date+delta)::int))
   and abs(extract(epoch from (p_at-(((p_at at time zone 'Asia/Shanghai')::date + delta + make_time((t.content::jsonb->>'hour')::int,coalesce((t.content::jsonb->>'minute')::int,0),0)) at time zone 'Asia/Shanghai'))))<3600);
$function$;

-- Retire only unstarted Claude reservations. Keep completed and running receipts intact.
with retired as (
 update public.cli_wake_schedule w set status='cancelled',skip_reason='gemini_handoff',completed_at=now()
 where w.role='claude_code_cli_syzygy' and w.status in ('planned','queued')
   and exists(select 1 from public.generation_ports p where p.user_id=w.user_id and p.port_key='gemini_cli' and p.active)
 returning w.user_id,w.command_id
)
update public.syzygy_commands c set status='failed',completed_at=now(),error_message='gemini_handoff'
from retired where c.user_id=retired.user_id and c.id=retired.command_id and c.status in ('pending','running');
