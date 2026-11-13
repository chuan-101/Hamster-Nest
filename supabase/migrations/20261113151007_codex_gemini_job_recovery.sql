-- One durable recovery command per failed Gemini fixed job. Mini calls this during
-- its regular scheduler tick; a disconnect or restart cannot lose the failure.
create function public.enqueue_gemini_job_recoveries(p_user uuid)
returns void language sql set search_path='' as $$
 insert into public.syzygy_commands(user_id,command_type,status,idempotency_key,payload)
 select p_user,'run_task','pending','gemini-recovery:'||c.id,
   jsonb_build_object('target_role','codex_cli_syzygy','source','gemini_job_recovery',
    'task_type','gemini_job_recovery','task_content','核对 Gemini 固定任务失败并补齐缺项','original_command_id',c.id)
 from public.syzygy_commands c
 join (values ('morning_share','claude-morning-share'),('daily_maintenance','claude-daily-maintenance'),
      ('weekly_digest','claude-weekly-digest')) j(kind,job)
 on c.payload->>'task_type'=j.kind and c.payload->>'scheduler_job'=j.job
 where c.user_id=p_user and c.status='failed' and c.command_type='run_task'
 and c.payload->>'target_role'='gemini_cli_syzygy' and c.payload->>'source'='scheduled'
 and c.payload#>>'{scheduled_trigger,name}'=j.job
 and c.payload#>>'{scheduled_trigger,local_date}' ~ '^\d{4}-\d{2}-\d{2}$'
 and c.idempotency_key='cli-runtime:'||j.job||':'||(c.payload#>>'{scheduled_trigger,local_date}')
 and not exists(select 1 from public.syzygy_commands handled where handled.user_id=p_user and handled.idempotency_key='gemini-recovery:'||c.id)
 and not exists(select 1 from public.agent_settings where user_id=p_user and agent_mode='paused')
 on conflict (user_id,idempotency_key) where idempotency_key is not null do nothing;
$$;

-- Read the actual products (including legacy date conventions) under their owner.
create function public.gemini_job_products(p_user uuid,p_kind text,p_date date)
returns jsonb language plpgsql stable set search_path='' as $$
declare
 d public.daily_status_digest; w public.weekly_digest; f public.agent_feed_items; o public.agent_feed_items;
 monday date:=p_date-(extract(isodow from p_date)::integer-1); month_key text:=to_char(p_date,'YYYY-MM');
 missing text[]:='{}'; digest uuid;
begin
 if p_kind not in ('daily_maintenance','morning_share','weekly_digest') then raise exception 'unsupported fixed job';end if;
 if p_kind='daily_maintenance' then
  begin
   select * into strict d from public.daily_status_digest where user_id=p_user and date=p_date and period_of_day='night';
  exception when no_data_found then null;end;
  digest:=d.id;
 elsif p_kind='weekly_digest' then
  begin
   select * into strict w from public.weekly_digest where user_id=p_user and week_start=monday and week_end=monday+6;
  exception when no_data_found then null;end;
  digest:=w.id;
 end if;
 begin
  select * into strict f from public.agent_feed_items where user_id=p_user and status in ('unread','read') and (
    (p_kind='morning_share' and type='morning_share' and (coalesce(metadata->>'local_date',(created_at at time zone 'Asia/Shanghai')::date::text)=p_date::text))
    or (p_kind='daily_maintenance' and type='daily_card' and p_date::text in (metadata->>'local_date',metadata->>'daily_date',metadata->>'date'))
    or (p_kind='weekly_digest' and type='weekly_card' and (related_id=digest or metadata->>'week_start'=monday::text or metadata->>'local_date'=p_date::text)));
 exception when no_data_found then null;end;
 begin
  select * into strict o from public.agent_feed_items where user_id=p_user and type='monthly_overview' and metadata->>'month'=month_key
    and metadata->>'status'='active' and status in ('read','unread');
 exception when no_data_found then null;end;
 if p_kind<>'morning_share' and digest is null then missing:=array_append(missing,'digest');end if;
 if f.id is null then missing:=array_append(missing,'card');
 elsif p_kind='daily_maintenance' and (digest is null or f.metadata->>'digest_id' is distinct from digest::text)
    or p_kind='weekly_digest' and (digest is null or f.related_id is distinct from digest or f.related_table is distinct from 'weekly_digest') then
    missing:=array_append(missing,'card_link');
 end if;
 if f.id is null or not coalesce(o.metadata->'source_feed_ids' ? f.id::text,false) or
   (p_kind='weekly_digest' and (digest is null or not coalesce(o.metadata->'source_weekly_digest_ids' ? digest::text,false))) then missing:=array_append(missing,'overview');end if;
 return jsonb_build_object('missing',missing,'card',case when f.id is not null then to_jsonb(f)-'user_id' end,
   'digest',case when digest is not null then (case when p_kind='daily_maintenance' then to_jsonb(d) else to_jsonb(w) end)-'user_id' end,
   'overview_id',o.id,'overview_version',o.updated_at);
end $$;

create function public.commit_gemini_job_recovery(p_user uuid,p_command uuid,p_task uuid,p_before jsonb,p_draft jsonb,p_sources uuid[],p_revision text,p_read_at timestamptz)
returns jsonb language plpgsql set search_path='' as $$
declare
 c public.syzygy_commands; orig public.syzygy_commands; state jsonb; missing jsonb;
 d date; k text; monday date; month_key text; card uuid; digest uuid; o public.agent_feed_items;
 care text; meta jsonb; covered jsonb; text_body text; highlights text[];
begin
 select * into strict c from public.syzygy_commands where user_id=p_user and id=p_command and status='running' for update;
 select * into strict orig from public.syzygy_commands where user_id=p_user and id=(c.payload->>'original_command_id')::uuid and status='failed' for update;
 if c.idempotency_key is distinct from 'gemini-recovery:'||orig.id or c.payload->>'source' is distinct from 'gemini_job_recovery'
 or orig.payload->>'target_role' is distinct from 'gemini_cli_syzygy' or orig.payload->>'source' is distinct from 'scheduled'
 or not exists(select 1 from public.agent_tasks where id=p_task and user_id=p_user and correlation_id=p_command and executor='codex_cli' and status='running')
 then raise exception 'recovery identity mismatch';end if;
 if exists(select 1 from public.agent_settings where user_id=p_user and agent_mode='paused') then raise exception 'scheduler paused';end if;
 k:=orig.payload->>'task_type';d:=(orig.payload#>>'{scheduled_trigger,local_date}')::date;
 monday:=d-(extract(isodow from d)::integer-1);month_key:=to_char(d,'YYYY-MM');
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||':feed:'||month_key,0));
 perform 1 from public.agent_feed_items where id=(p_before->>'overview_id')::uuid and user_id=p_user for update;
 state:=public.gemini_job_products(p_user,k,d);missing:=state->'missing';
 if missing='[]' then return state-'card'-'digest';end if;
 if state is distinct from p_before then raise exception 'products changed during recovery; inspect again';end if;
 card:=(state#>>'{card,id}')::uuid;digest:=(state#>>'{digest,id}')::uuid;
 care:=coalesce(p_draft->>'care_priority',state#>>'{digest,care_priority}','normal');
 text_body:=coalesce(nullif(state#>>'{card,content}',''),nullif(state#>>'{digest,summary_text}',''),nullif(state#>>'{digest,digest_text}',''),p_draft->>'content');
 if (missing ? 'card' or missing ? 'digest') and coalesce(length(btrim(text_body)),0) not between 1 and 10000 then raise exception 'missing card content';end if;
 if missing ? 'digest' then
  if jsonb_typeof(p_draft->'summary_json') is distinct from 'object' then raise exception 'missing structured digest';end if;
  if k='daily_maintenance' then
   if care not in ('normal','attention','concern') then raise exception 'invalid care priority';end if;
   insert into public.daily_status_digest(user_id,date,period_of_day,summary_json,summary_text,care_priority)
   values(p_user,d,'night',p_draft->'summary_json',text_body,care) returning id into digest;
  else
   select array_agg(value) into highlights from jsonb_array_elements_text(p_draft->'highlights');
   if coalesce(cardinality(highlights),0) not between 1 and 10 then raise exception 'missing weekly highlights';end if;
   insert into public.weekly_digest(user_id,week_start,week_end,digest_json,digest_text,highlights)
   values(p_user,monday,monday+6,p_draft->'summary_json',text_body,highlights) returning id into digest;
  end if;
 end if;
 meta:=jsonb_build_object('local_date',d,'agent_task_id',p_task,'executor','codex_cli_syzygy','recovered_command_id',orig.id);
 if k='daily_maintenance' then meta:=meta||jsonb_build_object('digest_id',digest,'care_priority',care);
 elsif k='weekly_digest' then meta:=meta||jsonb_build_object('week_start',monday,'week_end',monday+6);end if;
 if missing ? 'card' then
  if coalesce(length(btrim(p_draft->>'title')),0) not between 1 and 200 then raise exception 'missing card title';end if;
  insert into public.agent_feed_items(user_id,type,title,summary,content,content_format,priority,source,created_by,metadata,related_table,related_id,created_at,visible_from)
   values(p_user,case k when 'morning_share' then 'morning_share' when 'weekly_digest' then 'weekly_card' else 'daily_card' end,
    p_draft->>'title',p_draft->>'summary',text_body,'markdown',case when k='weekly_digest' or care='concern' then 'high' else 'normal' end,
    case k when 'morning_share' then 'cli_morning_task' when 'weekly_digest' then 'cli_weekly_review' else 'cli_daily_maintenance' end,'syzygy',meta,
    case when k='weekly_digest' then 'weekly_digest' end,case when k='weekly_digest' then digest end,
    case when k='morning_share' then orig.created_at else now() end,orig.created_at) returning id into card;
 elsif missing ? 'card_link' then
  if k='weekly_digest' then update public.agent_feed_items set related_id=digest,related_table='weekly_digest' where id=card and user_id=p_user;
  else update public.agent_feed_items set metadata=metadata||jsonb_build_object('digest_id',digest) where id=card and user_id=p_user;end if;
 end if;
 if missing ? 'overview' then
  if coalesce(length(btrim(p_draft->>'overview')),0) not between 1 and 40000 then raise exception 'missing monthly overview';end if;
  select * into o from public.agent_feed_items where user_id=p_user and id=(state->>'overview_id')::uuid;
  select jsonb_agg(distinct id order by id) into covered from (
    select value id from jsonb_array_elements_text(coalesce(o.metadata->'source_feed_ids','[]'))
    union all select unnest(p_sources)::text union all select card::text) ids;
  meta:=coalesce(o.metadata,'{}')||jsonb_build_object('month',month_key,'status','active','source_feed_ids',covered,'source_feed_count',jsonb_array_length(covered),
   'feed_context_revision',p_revision,'feed_context_fetched_at',p_read_at,'last_compacted_at',now(),'updated_by','codex_cli',
   'last_updated_date',d,'theme_count',(select count(*) from regexp_matches(p_draft->>'overview','^##[[:blank:]]+','gm')));
  if k='weekly_digest' and not coalesce(meta->'source_weekly_digest_ids' ? digest::text,false) then
   meta:=meta||jsonb_build_object('source_weekly_digest_ids',coalesce(meta->'source_weekly_digest_ids','[]')||to_jsonb(digest::text));end if;
  if o.id is null then
   insert into public.agent_feed_items(user_id,type,title,content,content_format,source,created_by,metadata)
   values(p_user,'monthly_overview',to_char(d,'YYYY年FMMM月')||' 月度概览',p_draft->>'overview','markdown','cli_monthly_overview','syzygy',meta);
  else update public.agent_feed_items set content=p_draft->>'overview',metadata=meta where id=o.id and user_id=p_user;end if;
 end if;
 state:=public.gemini_job_products(p_user,k,d);
 if state->'missing'<>'[]' then raise exception 'incomplete recovery';end if;
 return jsonb_build_object('filled',missing,'missing',state->'missing','feed_id',card,'digest_id',digest,'overview_id',state->>'overview_id');
end $$;

revoke all on function public.enqueue_gemini_job_recoveries(uuid),public.gemini_job_products(uuid,text,date),
 public.commit_gemini_job_recovery(uuid,uuid,uuid,jsonb,jsonb,uuid[],text,timestamptz) from public,anon,authenticated;
grant execute on function public.enqueue_gemini_job_recoveries(uuid),public.gemini_job_products(uuid,text,date),
 public.commit_gemini_job_recovery(uuid,uuid,uuid,jsonb,jsonb,uuid[],text,timestamptz) to service_role;
