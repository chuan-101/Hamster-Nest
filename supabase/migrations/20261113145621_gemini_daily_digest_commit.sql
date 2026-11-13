-- The unattended writer binds all three records to one running Gemini daily task.
create function public.commit_gemini_daily_digest(p_task uuid, p_date date, p_draft jsonb,
 p_overview_id uuid, p_overview_version timestamptz, p_sources uuid[], p_revision text, p_read_at timestamptz)
returns jsonb language plpgsql set search_path='' as $$
declare
 owner_id uuid; month_key text:=to_char(p_date,'YYYY-MM'); digest uuid; card uuid;
 overview public.agent_feed_items; covered jsonb; meta jsonb; receipt jsonb;
 care text:=p_draft->>'care_priority'; priority_value text;
begin
 select user_id into strict owner_id from public.agent_tasks where id=p_task and executor='gemini_cli'
 and status='running' and payload_json->>'task_type'='daily_maintenance'
 and payload_json#>>'{runtime_time_context,scheduled_trigger,local_date}'=p_date::text
 and payload_json->>'target_role'='gemini_cli_syzygy' for update;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':feed:'||month_key,0));
 select payload_json->'daily_digest_receipt' into receipt from public.agent_tasks where id=p_task;
 if receipt is not null then return receipt; end if;
 if coalesce(care,'') not in ('normal','attention','concern')
 or jsonb_typeof(p_draft->'summary_json') is distinct from 'object'
 or coalesce(length(btrim(p_draft->>'content')),0) not between 1 and 6000
 or coalesce(length(btrim(p_draft->>'overview')),0) not between 1 and 40000
 or coalesce(length(btrim(p_draft->>'summary')),0) not between 1 and 1000 then raise exception 'invalid daily draft'; end if;
 begin
  select * into strict overview from public.agent_feed_items where user_id=owner_id and type='monthly_overview'
   and metadata->>'month'=month_key and metadata->>'status'='active' and status in ('read','unread') for update;
 exception when no_data_found then null;
 end;
 if overview.id is distinct from p_overview_id or overview.updated_at is distinct from p_overview_version then
   raise exception 'monthly overview changed; refresh before writing';
 end if;
 priority_value:=case when care='concern' then 'high' else 'normal' end;
 begin
  select id into strict digest from public.daily_status_digest where user_id=owner_id and date=p_date and period_of_day='night' for update;
 exception when no_data_found then null;
 end;
 if digest is null then
  insert into public.daily_status_digest(user_id,date,period_of_day,summary_json,summary_text,care_priority)
  values(owner_id,p_date,'night',p_draft->'summary_json',p_draft->>'content',care) returning id into digest;
 else
  update public.daily_status_digest set summary_json=p_draft->'summary_json',summary_text=p_draft->>'content',care_priority=care where id=digest;
 end if;
 select id into card from public.agent_feed_items where user_id=owner_id and type='daily_card' and status<>'archived'
 and p_date::text in (metadata->>'local_date',metadata->>'daily_date',metadata->>'date')
 order by exists(select 1 from public.agent_tasks t where t.user_id=owner_id and t.payload_json->>'feed_id'=agent_feed_items.id::text) desc,created_at desc,id limit 1 for update;
 meta:=jsonb_build_object('local_date',p_date,'digest_id',digest,'care_priority',care,'agent_task_id',p_task,'executor','gemini_cli_syzygy');
 if card is null then
  insert into public.agent_feed_items(user_id,type,title,content,summary,content_format,priority,source,created_by,metadata)
  values(owner_id,'daily_card',to_char(p_date,'FMMM月FMDD日')||' 今日状态',p_draft->>'content',p_draft->>'summary','markdown',priority_value,'cli_daily_maintenance','syzygy',meta)
  returning id into card;
 else
  update public.agent_feed_items set metadata=coalesce(metadata,'{}')||meta,summary=p_draft->>'summary',content=p_draft->>'content',priority=priority_value where id=card;
  update public.agent_feed_items set status='archived',metadata=metadata||jsonb_build_object('duplicate_of',card)
   where user_id=owner_id and type='daily_card' and id<>card and status<>'archived'
   and p_date::text in (metadata->>'local_date',metadata->>'daily_date',metadata->>'date');
 end if;
 select jsonb_agg(distinct id order by id) into covered from (
  select value as id from jsonb_array_elements_text(coalesce(overview.metadata->'source_feed_ids','[]'))
  union all select unnest(p_sources)::text union all select card::text
 ) ids;
 meta:=coalesce(overview.metadata,'{}')||jsonb_build_object('month',month_key,'status','active',
   'source_feed_ids',covered,'source_feed_count',jsonb_array_length(covered),'last_daily_update',p_date,'last_updated_date',p_date,
   'theme_count',(select count(*) from regexp_matches(p_draft->>'overview','^##[[:blank:]]+','gm')),
   'last_compacted_at',now(),'feed_context_revision',p_revision,'feed_context_fetched_at',p_read_at,
   'updated_by','gemini_cli','source_types',jsonb_build_array('morning_share','daily_card','reading_assist','weekly_card','dev_log'));
 if overview.id is null then
  insert into public.agent_feed_items(user_id,type,title,content,content_format,source,created_by,metadata)
   values(owner_id,'monthly_overview',to_char(p_date,'YYYY年FMMM月')||' 月度概览',p_draft->>'overview','markdown','cli_daily_maintenance','syzygy',meta) returning * into overview;
 else
  update public.agent_feed_items set content=p_draft->>'overview',metadata=meta where id=overview.id returning * into overview;
 end if;
 receipt:=jsonb_build_object('date',p_date,'digest_id',digest,'feed_id',card,'overview_id',overview.id,'source_feed_count',jsonb_array_length(covered));
 update public.agent_tasks set payload_json=payload_json||jsonb_build_object('daily_digest_receipt',receipt,'feed_id',card) where id=p_task;
 return receipt;
end $$;
revoke all on function public.commit_gemini_daily_digest(uuid,date,jsonb,uuid,timestamptz,uuid[],text,timestamptz) from public,anon,authenticated;
grant execute on function public.commit_gemini_daily_digest(uuid,date,jsonb,uuid,timestamptz,uuid[],text,timestamptz) to service_role;
