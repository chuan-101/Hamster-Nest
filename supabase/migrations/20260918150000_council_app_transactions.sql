-- App writes are owner-scoped, atomic and retryable. Existing Web/MCP contracts stay intact.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
create table app_private.council_app_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table app_private.council_app_requests enable row level security;
revoke all on app_private.council_app_requests from public, anon, authenticated;

create or replace function public.council_app_mutate(p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  action text := p_payload->>'action';
  speaker text := coalesce(p_payload->>'speaker', 'chuanchuan');
  body text := btrim(coalesce(p_payload->>'message', ''));
  category_key text := coalesce(p_payload->>'category', 'other');
  next_status text := p_payload->>'status';
  next_executor text := nullif(p_payload->>'executor', '');
  parent public.agent_council%rowtype;
  request_row app_private.council_app_requests%rowtype;
  created_id uuid;
  answer jsonb;
  old_label text;
  next_metadata jsonb;
begin
  if owner_id is null or p_request_id is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception '请重新登录后再操作。';
  end if;
  if action is null or action not in ('proposal','review','decision','report','category','rename_category','delete','delete_legacy','confirm') then
    raise exception '不支持的议事厅操作。';
  end if;
  -- INSERT conflict waits for the first transaction. Replays return its exact receipt.
  insert into app_private.council_app_requests (user_id, request_id, payload)
    values (owner_id, p_request_id, p_payload) on conflict do nothing;
  select * into request_row from app_private.council_app_requests
    where user_id = owner_id and request_id = p_request_id for update;
  if request_row.payload <> p_payload then raise exception '这次操作内容已改变，请重新提交。'; end if;
  if request_row.response is not null then return request_row.response; end if;

  if speaker not in ('chuanchuan','claude','gpt','gemini','codex_cli','claude_code_cli') then
    raise exception '发言身份无效。';
  end if;
  if action in ('proposal','review','report') and body = '' then raise exception '正文不能为空。'; end if;
  if action in ('proposal','category','rename_category') then
    select label into old_label from public.council_categories where key = category_key for update;
    if not found then raise exception '分类不存在，请刷新后重试。'; end if;
  end if;
  if action = 'proposal' then
    if btrim(coalesce(p_payload->>'topic','')) = '' then raise exception '请填写提案标题。'; end if;
    insert into public.agent_council (user_id,speaker,topic,message,entry_type,proposal_status,category,metadata)
      values (owner_id,speaker,btrim(p_payload->>'topic'),body,'proposal','open',category_key,
        jsonb_strip_nulls(jsonb_build_object('risk_level',nullif(btrim(p_payload->>'risk_level'),''),'target_module',nullif(btrim(p_payload->>'target_module'),''))))
      returning id into created_id;
    answer := jsonb_build_object('proposal_id',created_id,'entry_id',created_id);
  elsif action = 'rename_category' then
    if btrim(coalesce(p_payload->>'label','')) = '' then raise exception '分类名称不能为空。'; end if;
    if old_label is distinct from p_payload->>'previous_label' then raise exception '分类名称已变化，请刷新后再修改。'; end if;
    update public.council_categories set label = btrim(p_payload->>'label') where key = category_key;
    answer := jsonb_build_object('category',category_key);
  else
    select * into parent from public.agent_council
      where id = (p_payload->>'proposal_id')::uuid and user_id = owner_id and parent_id is null for update;
    if not found then raise exception '这条提案已不存在，或不属于当前账号。'; end if;
    if action = 'delete_legacy' then
      if parent.entry_type = 'proposal' then raise exception '正式提案不能按旧记录删除。'; end if;
      delete from public.agent_council where user_id = owner_id and topic = parent.topic and parent_id is null
        and entry_type is distinct from 'proposal'
        and id in (select value::uuid from jsonb_array_elements_text(p_payload->'ids'));
      answer := jsonb_build_object('proposal_id',parent.id,'deleted',true);
    else
      if parent.entry_type is distinct from 'proposal' then raise exception '这条记录不是正式提案。'; end if;
      if action in ('decision','category','report','delete','confirm') then
        if parent.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz
          or parent.proposal_status is distinct from p_payload->>'expected_status' then
          raise exception '提案已有新进展，请刷新后重新操作。';
        end if;
      end if;
      if action in ('decision','report','delete','confirm') and nullif(parent.metadata->>'claimed_by','') is not null then
        raise exception '执行方正在处理这条任务，完成后再操作。';
      end if;
      if action = 'review' then
        if nullif(p_payload->>'vote','') is not null and p_payload->>'vote' not in ('support','neutral','against') then raise exception '表态无效。'; end if;
        insert into public.agent_council (user_id,parent_id,speaker,topic,message,entry_type,vote,category)
          values (owner_id,parent.id,speaker,parent.topic,body,'review',nullif(p_payload->>'vote',''),parent.category)
          returning id into created_id;
      elsif action = 'decision' then
        if next_status is null or next_status not in ('approved','rejected','deferred') then raise exception '拍板状态无效。'; end if;
        if next_executor is not null and next_executor not in ('codex_cli','claude_code_cli','client','chuanchuan') then raise exception '执行方无效。'; end if;
        if next_status <> 'approved' then next_executor := null; end if;
        next_metadata := coalesce(parent.metadata,'{}'::jsonb) - 'execution_plan' - 'generated_plan_path' - 'claimed_by' - 'claimed_at' - 'claim_executor' - 'council_stage' - 'confirmed_plan_id';
        update public.agent_council set proposal_status=next_status, executor=next_executor, metadata=next_metadata, updated_at=clock_timestamp()
          where id=parent.id and user_id=owner_id;
        insert into public.agent_council (user_id,parent_id,speaker,topic,message,entry_type,proposal_status,category,metadata)
          values (owner_id,parent.id,'chuanchuan',parent.topic,coalesce(nullif(body,''),'串串已记录这次拍板。'),'decision',next_status,parent.category,
            jsonb_strip_nulls(jsonb_build_object('decision_status',next_status,'executor',next_executor,'previous_execution_plan',parent.metadata->'execution_plan')))
          returning id into created_id;
      elsif action = 'confirm' then
        if parent.proposal_status <> 'plan_generated'
          or parent.metadata->'execution_plan'->>'entry_id' is distinct from p_payload->>'plan_id'
          or not exists (select 1 from public.agent_council where id=(p_payload->>'plan_id')::uuid
            and parent_id=parent.id and user_id=owner_id and metadata->>'kind'='execution_plan') then
          raise exception '方案已变化或尚未就绪，请重新阅读后确认。';
        end if;
        if parent.executor not in ('codex_cli','claude_code_cli') then raise exception '请先指派 CLI 执行方。'; end if;
        update public.agent_council set proposal_status='approved', updated_at=clock_timestamp(),
          metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('council_stage','execution_confirmed','confirmed_plan_id',p_payload->>'plan_id')
          where id=parent.id;
        insert into public.agent_council(user_id,parent_id,speaker,topic,message,entry_type,proposal_status,category,metadata)
          values(owner_id,parent.id,'chuanchuan',parent.topic,'串串已确认这一版方案，允许按方案执行。','decision','approved',parent.category,
            jsonb_build_object('kind','execution_confirmation','plan_id',p_payload->>'plan_id','executor',parent.executor)) returning id into created_id;
      elsif action = 'category' then
        update public.agent_council set category=category_key, updated_at=clock_timestamp()
          where user_id=owner_id and (id=parent.id or parent_id=parent.id);
      elsif action = 'report' then
        if coalesce(parent.proposal_status,'open') not in ('approved','plan_generated','failed','done') then raise exception '拍板后才能提交执行回执。'; end if;
        -- Single source of truth for report + status + notification. No manual report writes.
        answer := public.council_submit_report(parent.id,speaker,body,p_payload->>'result',
          array(select jsonb_array_elements_text(coalesce(p_payload->'artifacts','[]'::jsonb))),
          array(select jsonb_array_elements_text(coalesce(p_payload->'follow_ups','[]'::jsonb))));
        created_id := (answer->>'report_id')::uuid;
      elsif action = 'delete' then
        delete from public.agent_council where id=parent.id and user_id=owner_id;
      end if;
      answer := coalesce(answer,'{}'::jsonb) || jsonb_build_object('proposal_id',parent.id,'entry_id',created_id,'deleted',action='delete');
    end if;
  end if;
  answer := answer || jsonb_build_object('request_id',p_request_id,'ok',true);
  update app_private.council_app_requests set response=answer where user_id=owner_id and request_id=p_request_id;
  return answer;
end;
$$;
revoke all on function public.council_app_mutate(uuid,jsonb) from public, anon;
grant execute on function public.council_app_mutate(uuid,jsonb) to authenticated;

-- Worker-only completion: plan stays in Council; execution requires an exact confirmed plan.
create or replace function public.council_worker_finish(
  p_proposal_id uuid, p_command_id uuid, p_claimed_by text, p_executor text,
  p_mode text, p_message text, p_result text default null,
  p_artifacts text[] default '{}', p_follow_ups text[] default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  parent public.agent_council%rowtype;
  request_row app_private.council_app_requests%rowtype;
  request_payload jsonb := jsonb_build_object('proposal',p_proposal_id,'executor',p_executor,'mode',p_mode,'message',p_message,'result',p_result,'artifacts',p_artifacts,'follow_ups',p_follow_ups);
  entry_id uuid;
  answer jsonb;
begin
  select * into parent from public.agent_council where id=p_proposal_id and entry_type='proposal' for update;
  if not found or parent.user_id is null or p_command_id is null then raise exception 'Council proposal/command missing'; end if;
  insert into app_private.council_app_requests(user_id,request_id,payload) values(parent.user_id,p_command_id,request_payload) on conflict do nothing;
  select * into request_row from app_private.council_app_requests where user_id=parent.user_id and request_id=p_command_id for update;
  if request_row.payload <> request_payload then raise exception 'Council command replay payload mismatch'; end if;
  if request_row.response is not null then return request_row.response; end if;
  if parent.executor is distinct from p_executor or parent.proposal_status <> 'approved'
    or nullif(p_claimed_by,'') is null or parent.metadata->>'claimed_by' is distinct from p_claimed_by then
    raise exception 'Council assignment or claim changed';
  end if;
  if btrim(coalesce(p_message,''))='' then raise exception 'Council body is empty'; end if;
  if p_mode='write_plan_only' then
    if parent.metadata->>'council_stage'='execution_confirmed' then raise exception 'Council execution already confirmed'; end if;
    insert into public.agent_council(user_id,parent_id,speaker,topic,message,entry_type,category,metadata)
      values(parent.user_id,parent.id,p_executor,parent.topic,p_message,'review',parent.category,
        jsonb_build_object('kind','execution_plan','command_id',p_command_id)) returning id into entry_id;
    update public.agent_council set proposal_status='plan_generated',updated_at=clock_timestamp(),
      metadata=(coalesce(metadata,'{}'::jsonb)-'claimed_by'-'claimed_at'-'claim_executor'-'confirmed_plan_id') ||
        jsonb_build_object('council_stage','awaiting_confirmation','execution_plan',jsonb_build_object('entry_id',entry_id,'command_id',p_command_id,'mode','council_inline','generated_at',clock_timestamp())) where id=parent.id;
    answer:=jsonb_build_object('proposal_id',parent.id,'entry_id',entry_id,'stage','awaiting_confirmation');
  elsif p_mode='execute_confirmed' then
    if parent.metadata->>'council_stage' is distinct from 'execution_confirmed'
      or parent.metadata->>'confirmed_plan_id' is distinct from parent.metadata->'execution_plan'->>'entry_id' then
      raise exception 'Council plan was not confirmed';
    end if;
    answer:=public.council_submit_report(parent.id,p_executor,p_message,p_result,p_artifacts,p_follow_ups);
    update public.agent_council set metadata=(coalesce(metadata,'{}'::jsonb)-'claimed_by'-'claimed_at'-'claim_executor') || jsonb_build_object('council_stage','reported') where id=parent.id;
  else raise exception 'Unknown Council worker mode'; end if;
  update app_private.council_app_requests set response=answer where user_id=parent.user_id and request_id=p_command_id;
  return answer;
end;
$$;
revoke all on function public.council_worker_finish(uuid,uuid,text,text,text,text,text,text[],text[]) from public,anon,authenticated;
grant execute on function public.council_worker_finish(uuid,uuid,text,text,text,text,text,text[],text[]) to service_role;

create or replace function public.council_submit_report(
  p_proposal_id uuid,
  p_speaker text,
  p_message text,
  p_result text,
  p_artifacts text[] default null,
  p_follow_ups text[] default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_proposal public.agent_council%rowtype;
  v_report_id uuid;
  v_next_status text;
  v_event_id bigint;
  v_title text;
begin
  if p_result is null or p_result not in ('succeeded', 'partial', 'failed') then
    raise exception 'council_submit_report: result 必须是 succeeded / partial / failed，收到 %', coalesce(p_result, 'null');
  end if;
  if p_message is null or btrim(p_message) = '' then
    raise exception 'council_submit_report: message 不能为空（三五句人话：干了什么/怎么验证/遗留什么）';
  end if;

  select * into v_proposal
    from public.agent_council
   where id = p_proposal_id and entry_type = 'proposal'
     for update;
  if not found then
    raise exception 'council_submit_report: 主提案不存在或不是 proposal: %', p_proposal_id;
  end if;

  -- succeeded / partial → done（partial 的遗留项建议另开提案，写进 follow_ups）；
  -- failed → failed（完成是事实不是愿望；卡点写在回执里，等串串改派或重试）。
  v_next_status := case when p_result = 'failed' then 'failed' else 'done' end;

  insert into public.agent_council
    (user_id, parent_id, speaker, topic, message, entry_type, category, metadata)
  values
    (v_proposal.user_id, v_proposal.id, p_speaker, v_proposal.topic, p_message, 'report',
     v_proposal.category,
     jsonb_strip_nulls(jsonb_build_object(
       'result', p_result,
       'artifacts', case when p_artifacts is null or cardinality(p_artifacts) = 0
                         then null else to_jsonb(p_artifacts) end,
       'follow_ups', case when p_follow_ups is null or cardinality(p_follow_ups) = 0
                          then null else to_jsonb(p_follow_ups) end
     )))
  returning id into v_report_id;

  update public.agent_council
     set proposal_status = v_next_status, updated_at = now()
   where id = v_proposal.id;

  v_title := case p_result
    when 'succeeded' then '✅ 议事厅回执：' || v_proposal.topic
    when 'partial'   then '🟡 议事厅回执（部分完成）：' || v_proposal.topic
    else                  '❌ 议事厅回执（失败）：' || v_proposal.topic
  end;

  -- Route report receipts directly to their Council detail.
  insert into public.agent_events
    (user_id, actor, event_type, entity_type, entity_id, title, payload, importance)
  values
    (v_proposal.user_id, p_speaker, 'council_report', 'council_proposal', v_proposal.id,
     v_title,
     jsonb_build_object('screen', 'council_detail', 'params', jsonb_build_object('id',p_proposal_id), 'result', p_result, 'topic', v_proposal.topic),
     'normal')
  returning id into v_event_id;

  return jsonb_build_object(
    'proposal_id', v_proposal.id,
    'proposal_status', v_next_status,
    'report_id', v_report_id,
    'agent_event_id', v_event_id
  );
end;
$$;

comment on function public.council_submit_report(uuid, text, text, text, text[], text[]) is
  '议事厅执行回执的唯一写回入口（写回标准见 hamster-nest-app docs/council-report-standard.md）。谁执行谁执笔；回执写错不改写，再发一条修正。';

revoke all on function public.council_submit_report(uuid, text, text, text, text[], text[]) from public, anon;
grant execute on function public.council_submit_report(uuid, text, text, text, text[], text[]) to authenticated, service_role;
